const { app, BrowserWindow, ipcMain, session, dialog, net } = require('electron');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { spawn, exec } = require('child_process');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const { demuxerIntegration } = require('./local-media-demuxer.cjs');
const { getFfmpegPath, getFfprobePath } = require('../core/ffmpegPaths');
const createGoogleVideosModule = require('./googlevideos.com-main.cjs');
const { createSitePolicyHelpers } = require('./media-providers.cjs');
const createGenericCaptureHelpers = require('./generic-capture-main.cjs');
const createMegaProvider = require('./mega.nz-main.cjs');
const { createLocalVideoHelpers } = require('./local-media-demuxer.cjs');
const createHlsMseBackend = require('./hls-mse-backend.cjs');
const createPixelDrainModule = require('./pixeldrain.com-main.cjs');
const pixeldrainModule = createPixelDrainModule();
const {
  pixelDrainCookieStore,
  pixelDrainPlaywrightCache,
  pixelDrainDomainCookies,
  pixeldrainMirrorRegistry,
  isPixeldrainHost,
  getPixelDrainFileId,
  resolvePixelDrainDirectUrl,
  getPixelDrainVariantUrl,
  normalizePixelDrainLocalVariant,
  buildPixelDrainLocalVariantStreamUrl,
  buildPixelDrainLocalPlaybackUrls,
  isPixeldrainRequest,
  getPixelDrainCookieForHost,
  syncPixeldrainCookiesToElectron,
  buildPixelDrainHeaders,
  primePixelDrainCookies,
  startPixelDrainStream,
  clearPixeldrainSessionCookies,
  resolvePixelDrainPlaybackUrlForRenderer,
  fetchPixelDrainWithPlaywright,
  fetchLiveMirrors,
  generateEnhancedCdnLink
} = pixeldrainModule;
const { startStealthHider } = require('./stealth-hider.cjs');
const AdBlockManager = require('./adblock-manager.cjs');

// IGNORE CERTIFICATE ERRORS FOR ALL HTTPS REQUESTS 
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Allow media autoplay without requiring a user gesture, which is important
// for local files and programmatic source switches inside the player.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ssl-version-min', 'tls1');
app.commandLine.appendSwitch('ssl-version-fallback-min', 'tls1');

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

// Enable hardware-accelerated video decoding and proprietary codec support.
// This enables HEVC/H.265, VP9, AV1 hardware decode on systems that support it.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization,PlatformHEVCDecoderSupport,PlatformHEVCEncoder');

// Force audio to run in the main process so screen sharing apps (Discord, Google Meet) can capture it when sharing a specific window
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

const DynamicDownloader = require('./aether-download-manager.cjs');
const { setupCustomPip } = require('./picture-in-picture.cjs');

const playwrightBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)
  : app.isPackaged
    ? path.join(process.resourcesPath, 'ms-playwright')
    : path.join(__dirname, '..', 'ms-playwright');

process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;
console.log('Using Playwright browsers from:', process.env.PLAYWRIGHT_BROWSERS_PATH);

function getPlaywrightExecutablePath() {
  const isWin = process.platform === 'win32';
  const executableName = isWin ? 'chrome.exe' : (process.platform === 'darwin' ? 'Chromium.app/Contents/MacOS/Chromium' : 'chrome');

  if (!fs.existsSync(playwrightBrowsersPath)) return null;
  const dirs = fs.readdirSync(playwrightBrowsersPath);
  for (const dir of dirs) {
    if (dir.startsWith('chromium-')) {
      let candidate;
      if (isWin) {
        candidate = path.join(playwrightBrowsersPath, dir, 'chrome-win64', executableName);
        if (!fs.existsSync(candidate)) candidate = path.join(playwrightBrowsersPath, dir, 'chrome-win', executableName);
      } else if (process.platform === 'darwin') {
        candidate = path.join(playwrightBrowsersPath, dir, 'chrome-mac', executableName);
      } else {
        candidate = path.join(playwrightBrowsersPath, dir, 'chrome-linux', executableName);
      }
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Try to load playwright-extra with stealth plugin
let playwright;
let stealth;
try {
  const { chromium } = require('playwright-extra');
  stealth = require('puppeteer-extra-plugin-stealth')();
  chromium.use(stealth);
  playwright = { chromium };
  console.log('Playwright-extra with stealth loaded');
} catch {
  console.log('Playwright-extra not installed – falling back to basic playwright');
  try {
    playwright = require('playwright');
  } catch {
    console.log('Playwright not installed – skipping browser fallback');
  }
}

// Dynamically resolve yt-dlp path.
const resolveYtDlpPath = () => {
  const candidateNames = process.platform === 'win32'
    ? ['yt-dlp.exe', 'yt-dlp']
    : ['yt-dlp', 'yt-dlp.exe'];

  const candidateRoots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'bin') : null,
    path.join(__dirname, '..', 'bin')
  ].filter(Boolean);

  for (const root of candidateRoots) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(root, candidateName);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
};

const pathToYtdlp = resolveYtDlpPath();
console.log('Using yt-dlp from:', pathToYtdlp);
const youtubedl = createYoutubeDl(pathToYtdlp);

/**
 * Robustly kills a process tree.
 * On Windows, it uses taskkill /F /T /PID to ensure child processes (like ffmpeg) are also terminated.
 */
function killProcessTree(proc) {
  return new Promise((resolve) => {
    if (!proc) return resolve();
    const pid = proc.pid;
    if (!pid) {
      try { proc.kill(); } catch (e) { }
      return resolve();
    }

    if (process.platform === 'win32') {
      exec(`taskkill /F /T /PID ${pid}`, (err) => {
        if (err) {
          console.warn(`[PROCESS] Failed to taskkill ${pid}:`, err.message);
          // Fallback to standard kill
          try { proc.kill(); } catch (e) { }
        } else {
          console.log(`[PROCESS] Taskkill success for PID ${pid}`);
        }
        // Give a short delay to ensure OS has released file handles
        setTimeout(resolve, 500);
      });
    } else {
      try { proc.kill('SIGKILL'); } catch (e) { }
      setTimeout(resolve, 100);
    }
  });
}

/**
 * Remuxes a live recording file using ffmpeg to fix the container.
 * When a live recording is force-stopped, the MP4 container header may not
 * be finalized. Running a quick `ffmpeg -c copy` fixes the container without
 * re-encoding.
 */
async function remuxLiveRecording(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn('[LIVE-REMUX] File does not exist, skipping remux:', filePath);
    return false;
  }

  const fileSize = fs.statSync(filePath).size;
  if (fileSize < 1024) {
    console.warn('[LIVE-REMUX] File too small, skipping remux:', fileSize, 'bytes');
    return false;
  }

  const ffmpegPath = getFfmpegPath();
  const ext = path.extname(filePath) || '.mp4';
  const tempPath = filePath.replace(ext, `_remux${ext}`);

  console.log(`[LIVE-REMUX] Remuxing ${filePath} -> ${tempPath}`);

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-y',
      '-i', filePath,
      '-c', 'copy',
      '-movflags', '+faststart',
      tempPath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempPath)) {
        const remuxedSize = fs.statSync(tempPath).size;
        if (remuxedSize > 1024) {
          try {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            console.log(`[LIVE-REMUX] Success: ${filePath} (${remuxedSize} bytes)`);
            resolve(true);
          } catch (e) {
            console.warn('[LIVE-REMUX] Failed to replace original:', e.message);
            // Keep the original file
            try { fs.unlinkSync(tempPath); } catch { }
            resolve(false);
          }
        } else {
          console.warn('[LIVE-REMUX] Remuxed file too small, keeping original');
          try { fs.unlinkSync(tempPath); } catch { }
          resolve(false);
        }
      } else {
        console.warn(`[LIVE-REMUX] ffmpeg failed (code ${code}):`, stderr.slice(-300));
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { }
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      console.warn('[LIVE-REMUX] ffmpeg spawn error:', err.message);
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { }
      resolve(false);
    });

    // Safety timeout: 60 seconds max for remux
    setTimeout(() => {
      try { proc.kill(); } catch { }
    }, 60000);
  });
}

/**
 * Deletes a file and all related temporary files (like .part, .ytdl, etc.)
 * Scans the directory for any files matching the base filename prefix.
 */
function deleteRelatedFiles(filePath) {
  if (!filePath) return;
  try {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    const base = path.basename(resolvedPath);
    // Strip the extension to catch files like filename.f137.mp4.part
    const nameWithoutExt = path.parse(base).name;

    if (!fs.existsSync(dir)) return;

    // 1. Direct delete of the main file
    if (fs.existsSync(resolvedPath)) {
      try { fs.unlinkSync(resolvedPath); } catch (e) {
        console.warn(`[CLEANUP] Failed to delete main file: ${resolvedPath}`, e.message);
      }
    }

    // 2. Pattern based delete (any file starting with the same name, ignoring extension)
    // This catches .part, .ytdl, .f137.mp4.part, .part0 etc.
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith(nameWithoutExt)) {
        // Additional safety: don't delete files that are exactly another tracked download
        // (This is unlikely but good for robustness)
        if (f === base) continue;

        const fullPath = path.join(dir, f);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            fs.unlinkSync(fullPath);
            console.log(`[CLEANUP] Deleted related file: ${f}`);
          }
        } catch (e) {
          // File might be locked or already gone
        }
      }
    }
  } catch (err) {
    console.error(`[CLEANUP] Error during cleanup for ${filePath}:`, err.message);
  }
}


const PRIMARY_FORMAT = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
const STANDARD_HEIGHTS = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sitePolicyHelpers = createSitePolicyHelpers({
  DESKTOP_USER_AGENT,
  PRIMARY_FORMAT
});

const {
  shouldBypassProxyForDirectMediaHost,
  getExtractorProfiles
} = sitePolicyHelpers;

let youtubeSession = {
  title: '',
  bestAudioUrl: null,
  qualities: [],
  qualityMap: {},
  pageUrl: null,   // original YouTube watch URL — needed for POT resolution
};

// In-flight POT resolution promises keyed by audioTrackId, so rapid double-clicks
// don't launch two Playwright instances for the same track.
const potResolutionInFlight = new Map();

let mediaProxyServer = null;
let mediaProxyBaseUrl = null;
let mediaServerOrigin = null;
const hlsMseBackend = createHlsMseBackend();

const proxyRequestHeaderStore = new Map();

const genericPlaywrightCache = new Map();               // cache for generic webpage extraction

const MAX_RETRIES = 3;
const BASE_DELAY = 500;
const proxyHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 24, timeout: 0 });
const proxyHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 24, timeout: 0, rejectUnauthorized: false });
const demuxTempDir = path.join(require('os').tmpdir(), 'aether-player-demux');
const adBlockManager = new AdBlockManager(app.getPath('userData'));

// Chromium blocks a list of unsafe ports (for example 2049), so the local
// media proxy must bind only to explicitly safe localhost ports.
const SAFE_MEDIA_PROXY_PORTS = [18652, 18653, 18654, 18655, 18656, 18657, 18658, 18659];



// Helper to filter out hop-by-hop headers
const hopByHopHeaders = [
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'
];
function filterHopByHop(headers) {
  const result = { ...headers };
  for (const h of hopByHopHeaders) {
    delete result[h];
  }
  return result;
}

const scoreByQuality = (a, b) => {
  const aHeight = Number(a?.height || 0);
  const bHeight = Number(b?.height || 0);
  if (bHeight !== aHeight) return bHeight - aHeight;

  const aFps = Number(a?.fps || 0);
  const bFps = Number(b?.fps || 0);
  if (bFps !== aFps) return bFps - aFps;

  return Number(b?.tbr || 0) - Number(a?.tbr || 0);
};

const getNormalizedHeight = (format) => {
  const note = String(format?.format_note || format?.resolution || '').toLowerCase();
  const noteP = note.match(/(\d{3,4})p/);
  const noteRes = note.match(/(\d{3,4})x(\d{3,4})/);
  const width = Number(format?.width || 0);
  const height = Number(format?.height || 0);

  const rawHeight =
    (noteP ? Number(noteP[1]) : 0) ||
    (noteRes ? Math.min(Number(noteRes[1]), Number(noteRes[2])) : 0) ||
    (width > 0 && height > 0 ? Math.min(width, height) : 0) ||
    height;

  if (rawHeight <= 0) return 0;
  const nearest = STANDARD_HEIGHTS.find((value) => Math.abs(rawHeight - value) <= 140);
  return nearest || rawHeight;
};

const makeQualityLabel = (format) => {
  if (!format) return 'undefined';
  const height = getNormalizedHeight(format);
  const fps = Number(format?.fps || 0);
  const fpsText = (fps && fps >= 50) ? ` ${Math.round(fps)}fps` : '';
  if (!height) return `undefined${fpsText}`;
  return `${height}p${fpsText}`;
};

const getFormatId = (format) => {
  const explicitId = String(format?.format_id || '').trim();
  if (explicitId) return explicitId;

  const height = getNormalizedHeight(format) || 'auto';
  const fps = Math.round(Number(format?.fps || 0));
  const ext = String(format?.ext || 'unknown');
  const abr = Math.round(Number(format?.abr || 0));
  const tbr = Math.round(Number(format?.tbr || 0));
  return `${height}-${fps}-${ext}-${abr}-${tbr}`;
};

const isSupportedVideoCodec = (codec) => {
  const value = String(codec || '').toLowerCase();
  if (!value || value === 'none') return false;
  return (
    value.startsWith('avc1') || value.includes('h264') ||
    value.startsWith('hev1') || value.startsWith('hvc1') ||
    value.includes('h265') || value.includes('hevc')
  );
};

const isExtendedVideoCodec = (codec) => {
  const value = String(codec || '').toLowerCase();
  if (!value || value === 'none') return false;
  return (
    value.startsWith('avc1') ||
    value.includes('h264') ||
    value.startsWith('hev1') || value.startsWith('hvc1') ||
    value.includes('h265') || value.includes('hevc') ||
    value.startsWith('vp9') ||
    value.startsWith('vp09') ||
    value.startsWith('vp8') || value.startsWith('vp08') ||
    value.startsWith('av01') ||
    value.includes('theora') ||
    value.includes('mpeg4') || value.includes('mp4v') ||
    value.includes('mpeg2') || value.includes('mpeg1')
  );
};

const isSupportedAudioCodec = (codec) => {
  const value = String(codec || '').toLowerCase();
  if (!value || value === 'none') return false;
  return (
    value.startsWith('mp4a') || value.includes('aac') ||
    value.includes('opus') || value.includes('vorbis') ||
    value.includes('flac') || value.includes('mp3') || value.includes('mp4a') ||
    value.includes('ac-3') || value.includes('ac3') ||
    value.includes('ec-3') || value.includes('eac3') ||
    value.includes('pcm')
  );
};

const isDirectHttpProtocol = (protocol) => {
  const value = String(protocol || '').toLowerCase();
  if (!value) return false;
  // Exclude manifest protocols – they are handled separately
  if (value.includes('m3u8') || value.includes('dash') || value.includes('ism')) return false;
  return value.includes('http');
};

const isHlsProtocol = (protocol) => String(protocol || '').toLowerCase().includes('m3u8');
const isDashProtocol = (protocol) => String(protocol || '').toLowerCase().includes('mpd');
const isDirectBinaryMediaPath = (value) => /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m4a|aac|ts|m4s)(?:\/)?(?:$|\?|#)/i.test(String(value || '').toLowerCase());







const pickSafeProxyHeaders = (headers) => {
  if (!headers || typeof headers !== 'object') return null;

  const result = {};
  const allowed = [
    'user-agent',
    'referer',
    'origin',
    'cookie',
    'authorization',
    'accept-language',
    'accept',
    'range'
  ];

  Object.entries(headers).forEach(([key, value]) => {
    if (!key || value == null) return;
    const normalizedKey = String(key).toLowerCase();
    if (!allowed.includes(normalizedKey) && !normalizedKey.startsWith('x-') && !normalizedKey.startsWith('sec-')) return;
    result[normalizedKey] = String(value);
  });

  return Object.keys(result).length > 0 ? result : null;
};

const createProxyRequestId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const storeProxyHeaders = (headers) => {
  const safeHeaders = pickSafeProxyHeaders(headers);
  if (!safeHeaders) return null;

  const id = createProxyRequestId();
  proxyRequestHeaderStore.set(id, {
    headers: safeHeaders,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000 // Increased to 6 hours for long pauses
  });
  return id;
};

const mergeProxyHeaders = (...headerValues) => {
  const merged = {};

  headerValues
    .filter((headers) => headers && typeof headers === 'object')
    .forEach((headers) => {
      Object.entries(headers).forEach(([key, value]) => {
        if (!key || value == null) return;
        merged[String(key).toLowerCase()] = String(value);
      });
    });

  const safe = pickSafeProxyHeaders(merged);
  return safe && Object.keys(safe).length > 0 ? safe : null;
};

const buildProxyHeadersWithCookies = (baseHeaders, cookieString) => {
  const normalizedCookie = String(cookieString || '').trim();
  if (!normalizedCookie) return pickSafeProxyHeaders(baseHeaders) || null;
  return mergeProxyHeaders(baseHeaders, {
    cookie: normalizedCookie
  });
};

const isLikelyAv1Url = (rawUrl) => /(?:^|[\/_\-.,])(?:av1|av01)(?:[\/_\-.,]|$)/i.test(String(rawUrl || ''));
const isLikelyManifestUrl = (rawUrl) => /\.(m3u8|mpd)(?:$|\?|#)/i.test(String(rawUrl || ''));
const isLikelyDirectMp4Url = (rawUrl) => /\.mp4(?:$|\?|#)/i.test(String(rawUrl || ''));

const pickPreferredPlayableUrlFromPlaywrightResult = (playwrightResult) => {
  const candidates = [];
  if (playwrightResult?.url) {
    candidates.push({
      url: String(playwrightResult.url),
      source: 'primary',
      headers: playwrightResult.proxyHeaders || null
    });
  }

  if (Array.isArray(playwrightResult?.qualities)) {
    playwrightResult.qualities.forEach((entry) => {
      const value = String(entry?.value || entry?.videoUrl || entry?.url || '').trim();
      if (!value) return;
      candidates.push({
        url: value,
        source: String(entry?.label || 'quality'),
        headers: (playwrightResult.qualityHeaders && playwrightResult.qualityHeaders[value]) || playwrightResult.proxyHeaders || null
      });
    });
  }

  const uniqueCandidates = Array.from(new Map(
    candidates
      .filter((entry) => entry.url)
      .map((entry) => [entry.url, entry])
  ).values());

  const parseQualityScore = (entry) => {
    const text = `${String(entry?.source || '')} ${String(entry?.url || '')}`.toLowerCase();
    if (/2160p|\b4k\b/.test(text)) return 2160;
    if (/1440p|\b2k\b/.test(text)) return 1440;
    if (/1080p/.test(text)) return 1080;
    if (/720p/.test(text)) return 720;
    if (/480p/.test(text)) return 480;
    if (/360p/.test(text)) return 360;
    if (/240p/.test(text)) return 240;
    return 0;
  };

  const getBucket = (entry) => {
    const url = String(entry?.url || '');
    const isManifest = isLikelyManifestUrl(url);
    const isMp4 = isLikelyDirectMp4Url(url);
    const isAv1 = isLikelyAv1Url(url);
    if (isMp4 && !isAv1) return 'mp4';
    if (isManifest && !isAv1) return 'manifest';
    if (isMp4 && isAv1) return 'mp4-av1';
    if (isManifest && isAv1) return 'manifest-av1';
    return 'other';
  };

  const bucketPriority = (bucket) => {
    if (bucket === 'manifest-av1') return 6;
    if (bucket === 'mp4-av1') return 5;
    if (bucket === 'manifest') return 4;
    if (bucket === 'mp4') return 3;
    return 1;
  };

  const bucketGroups = new Map();
  uniqueCandidates.forEach((entry) => {
    const bucket = getBucket(entry);
    const list = bucketGroups.get(bucket) || [];
    list.push({ ...entry, _quality: parseQualityScore(entry) });
    bucketGroups.set(bucket, list);
  });

  const bestPerBucket = Array.from(bucketGroups.entries()).map(([bucket, list]) => {
    const concrete = list.filter((entry) => entry._quality > 0);
    const pool = concrete.length > 0 ? concrete : list;
    const selected = [...pool].sort((left, right) => {
      if (right._quality !== left._quality) return right._quality - left._quality;
      const leftAuto = /\bauto\b/i.test(String(left.source || '')) ? 1 : 0;
      const rightAuto = /\bauto\b/i.test(String(right.source || '')) ? 1 : 0;
      if (leftAuto !== rightAuto) return leftAuto - rightAuto;
      return 0;
    })[0];
    return {
      ...selected,
      _bucket: bucket,
      _bucketPriority: bucketPriority(bucket)
    };
  });

  return bestPerBucket
    .sort((left, right) => {
      if (right._bucketPriority !== left._bucketPriority) {
        return right._bucketPriority - left._bucketPriority;
      }
      if (right._quality !== left._quality) return right._quality - left._quality;
      const leftAuto = /\bauto\b/i.test(String(left.source || '')) ? 1 : 0;
      const rightAuto = /\bauto\b/i.test(String(right.source || '')) ? 1 : 0;
      if (leftAuto !== rightAuto) return leftAuto - rightAuto;
      return 0;
    })[0] || null;
};

const getStoredProxyHeaders = (id) => {
  if (!id) return null;
  const entry = proxyRequestHeaderStore.get(id);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    proxyRequestHeaderStore.delete(id);
    return null;
  }
  // Sliding expiration: Extend life by another 2 hours on every use
  entry.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
  return entry.headers;
};

const withTimeout = (promise, timeoutMs, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message || 'Operation timed out')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const cleanupDemuxTempFiles = () => {
  try {
    if (fs.existsSync(demuxTempDir)) {
      fs.rmSync(demuxTempDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn('Failed to clean demux temp files:', error?.message || error);
  }
};

const listenOnSafeLocalPort = async (server, host = '127.0.0.1') => {
  let lastError = null;

  for (const port of SAFE_MEDIA_PROXY_PORTS) {
    try {
      await new Promise((resolve, reject) => {
        const handleError = (error) => {
          server.off('listening', handleListening);
          reject(error);
        };
        const handleListening = () => {
          server.off('error', handleError);
          resolve();
        };

        server.once('error', handleError);
        server.once('listening', handleListening);
        server.listen(port, host);
      });

      return port;
    } catch (error) {
      lastError = error;
      if (server.listening) {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }

  throw lastError || new Error('Unable to bind media proxy to a safe local port');
};

const parsePotentialJsonOutput = (rawValue) => {
  const text = String(rawValue || '').trim();
  if (!text) return null;

  const candidates = [];
  candidates.push(text);

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0) {
    candidates.push(lines[lines.length - 1]);
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};


const extractWithRetries = async (url) => {
  const profiles = getExtractorProfiles(url);
  let lastError = null;

  for (const profile of profiles) {
    try {
      console.log(`YT-DLP attempt: ${profile.name}`);
      return await withTimeout(
        youtubedl(url, profile.options),
        45000,
        `Extractor timeout on profile ${profile.name}`
      );
    } catch (error) {
      lastError = error;
      const stderr = String(error?.stderr || '').split('\n')[0];
      const reason = stderr || String(error?.message || 'unknown error');
      console.warn(`YT-DLP attempt failed (${profile.name}): ${reason}`);
    }
  }

  const lowerUrl = String(url || '').toLowerCase();
  if (lowerUrl.includes('pixeldrain.com')) {
    const pixelDrainFallbackProfiles = ['firefox', 'chrome', 'edge', 'brave'].map((browser) => ({
      name: `pixeldrain-direct-cookies-${browser}`,
      options: {
        dumpSingleJson: true,
        noCheckCertificates: true,
        format: 'best',
        cookiesFromBrowser: browser,
        referer: 'https://pixeldrain.com/',
        addHeader: [
          `User-Agent: ${DESKTOP_USER_AGENT}`,
          'Accept-Language: en-US,en;q=0.9',
          'Origin: https://pixeldrain.com'
        ]
      }
    }));

    for (const profile of pixelDrainFallbackProfiles) {
      try {
        console.log(`YT-DLP attempt: ${profile.name}`);
        return await withTimeout(
          youtubedl(url, profile.options),
          45000,
          `Extractor timeout on profile ${profile.name}`
        );
      } catch (error) {
        lastError = error;
        const stderr = String(error?.stderr || '').split('\n')[0];
        const reason = stderr || String(error?.message || 'unknown error');
        console.warn(`YT-DLP attempt failed (${profile.name}): ${reason}`);
      }
    }
  }

  throw lastError;
};

const scoreYoutubeExtractionOutput = (output) => {
  const formats = Array.isArray(output?.formats) ? output.formats : [];
  const playableVideoFormats = formats.filter(
    (format) =>
      !!format?.url &&
      format.vcodec &&
      format.vcodec !== 'none' &&
      typeof format.protocol === 'string' &&
      (isDirectHttpProtocol(format.protocol) || isHlsProtocol(format.protocol) || isDashProtocol(format.protocol)) &&
      (isSupportedVideoCodec(format.vcodec) || isExtendedVideoCodec(format.vcodec))
  );

  const heights = Array.from(
    new Set(playableVideoFormats.map((format) => getNormalizedHeight(format)).filter((value) => value > 0))
  ).sort((a, b) => b - a);

  return {
    maxHeight: heights[0] || 0,
    heightCount: heights.length,
    formatCount: playableVideoFormats.length,
    avcCount: playableVideoFormats.filter((format) => isSupportedVideoCodec(format.vcodec)).length,
    extendedCount: playableVideoFormats.filter((format) => isExtendedVideoCodec(format.vcodec)).length,
    muxedCount: playableVideoFormats.filter((format) => format.acodec && format.acodec !== 'none').length,
    adaptiveCount: playableVideoFormats.filter((format) => !format.acodec || format.acodec === 'none').length,
    smoothCount: playableVideoFormats.filter((format) => !format.fps || Number(format.fps) <= 30).length,
    labels: heights.map((height) => `${height}p`)
  };
};

const compareYoutubeExtractionScores = (left, right) => {
  const a = left || {};
  const b = right || {};
  const keys = [
    'maxHeight',
    'heightCount',
    'formatCount',
    'avcCount',
    'adaptiveCount',
    'muxedCount',
    'smoothCount',
    'extendedCount'
  ];

  for (const key of keys) {
    const diff = Number(a[key] || 0) - Number(b[key] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
};

const extractYoutubeInfo = async (url) => {
  const output = await extractWithRetries(url);
  const score = scoreYoutubeExtractionOutput(output);
  console.log(
    `YouTube profile summary (windows-generic): max=${score.maxHeight || 0}p heights=${score.labels.join(', ') || 'none'} formats=${score.formatCount}`
  );
  return output;
};

const pickMediaNode = (output) => {
  if (!output || typeof output !== 'object') return output;
  if (!Array.isArray(output.entries)) return output;

  const firstEntry = output.entries.find((entry) => entry && typeof entry === 'object');
  if (!firstEntry) return output;

  return {
    ...firstEntry,
    title: firstEntry.title || output.title || 'Online Video'
  };
};

// =======================================================================
//  Google Videos module (YouTube + Google Drive logic)
// =======================================================================
const googleVideosModule = createGoogleVideosModule({
  DESKTOP_USER_AGENT,
  STANDARD_HEIGHTS,
  scoreByQuality,
  getNormalizedHeight,
  makeQualityLabel,
  getFormatId,
  isSupportedVideoCodec,
  isExtendedVideoCodec,
  isSupportedAudioCodec,
  isDirectHttpProtocol,
  pickMediaNode,
  pickSafeProxyHeaders,
});
const {
  buildYoutubeSession,
  generateYoutubeDashMpd,
  parseYoutubeiPlayerResponse,
  isMissingPotFormat,
  isDriveMediaHost,
  isDriveLikeUrl,
  isDrivePlaybackLike,
  extractDriveIdFromUrl,
  getDriveFallbackUrl,
  isDriveRequest,
  buildDriveStreamPayload,
  buildDriveQualities,
} = googleVideosModule;
// MODIFIED: include .mpd as a playable media extension
const isLikelyDirectMediaUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const pathname = parsed.pathname.toLowerCase();
    const mimeType = String(parsed.searchParams.get('mime') || '').toLowerCase();
    return (
      /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m3u8|mpd)(?:\/)?$/i.test(pathname) ||
      mimeType.startsWith('video/') ||
      mimeType.includes('mpegurl') ||
      mimeType.includes('dash') ||
      mimeType.includes('mpd')
    );
  } catch {
    return false;
  }
};

const YTDLP_SUPPORTED_KEYWORDS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'facebook.com',
  'fb.watch', 'twitter.com', 'x.com', 'tiktok.com', 'instagram.com'
];

const isYtdlpSupportedSiteUrl = (url) => {
  const lowerUrl = String(url || '').toLowerCase();
  // Exclude Google Drive URLs so they continue to go through the dedicated Google Drive extraction logic first
  if (lowerUrl.includes('drive.google.com') || lowerUrl.includes('drive.usercontent.google.com') || lowerUrl.includes('.c.drive.google.com')) {
    return false;
  }
  try {
    const parsed = new URL(lowerUrl);
    return YTDLP_SUPPORTED_KEYWORDS.some(kw => parsed.hostname === kw || parsed.hostname.endsWith('.' + kw));
  } catch (e) {
    return YTDLP_SUPPORTED_KEYWORDS.some(kw => lowerUrl.includes(kw));
  }
};

const buildOnlineQualities = (rawOutput) => {
  const output = pickMediaNode(rawOutput);
  const formats = Array.isArray(output?.formats) ? output.formats : [];
  const qualities = [];
  const seenUrls = new Set();

  const addQuality = (label, url, audioUrl, formatName) => {
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    qualities.push({
      label,
      value: url,
      videoUrl: url,
      audioUrl: audioUrl || null,
      format: formatName
    });
  };

  const manifests = formats.filter(
    (f) => f.url && (isHlsProtocol(f.protocol) || isDashProtocol(f.protocol))
  );

  const masterManifest = manifests.find(f => !f.height && !f.vcodec || f.format_id?.includes('manifest') || f.url.includes('master'));
  if (masterManifest) {
    const formatName = isHlsProtocol(masterManifest.protocol) ? 'HLS' : 'DASH';
    addQuality('Auto', masterManifest.url, null, formatName);
  }

  const progressive = formats.filter(
    (f) => f.url && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && isDirectHttpProtocol(f.protocol)
  );
  progressive.sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of progressive) {
    const label = f.height ? `${f.height}p` : (f.format_note || 'Source');
    const formatName = f.ext ? f.ext.toUpperCase() : 'AVC';
    addQuality(label, f.url, null, formatName);
  }

  const videoOnly = formats.filter(
    (f) => f.url && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && isDirectHttpProtocol(f.protocol)
  );
  const audioOnly = formats.filter(
    (f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && isDirectHttpProtocol(f.protocol)
  );

  if (videoOnly.length > 0) {
    videoOnly.sort((a, b) => (b.height || 0) - (a.height || 0));
    audioOnly.sort((a, b) => (b.abr || 0) - (a.abr || 0));
    const bestAudio = audioOnly[0] || null;

    for (const f of videoOnly) {
      const label = f.height ? `${f.height}p` : (f.format_note || 'Video');
      const formatName = f.ext ? f.ext.toUpperCase() : 'AVC';
      addQuality(label, f.url, bestAudio?.url || null, formatName);
    }
  }

  const hlsStreams = formats.filter(
    (f) => f.url && f.vcodec && f.vcodec !== 'none' && isHlsProtocol(f.protocol)
  );
  hlsStreams.sort((a, b) => (b.height || 0) - (a.height || 0));
  for (const f of hlsStreams) {
    const label = f.height ? `${f.height}p` : (f.format_note || 'HLS');
    addQuality(label, f.url, null, 'HLS');
  }

  if (qualities.length === 0 && output?.url) {
    const isManifest = isLikelyManifestUrl(output.url);
    addQuality('Default', output.url, null, isManifest ? 'HLS' : 'WEB');
  }

  return qualities;
};

// MODIFIED: also accept DASH manifests as playable streams
const buildOnlineStreamPayload = (rawOutput) => {
  const output = pickMediaNode(rawOutput);
  const formats = Array.isArray(output?.formats) ? output.formats : [];

  // First, try to find any format that is a manifest (HLS or DASH) – those are playable via the proxy
  const manifestFormat = formats.find(
    (format) =>
      !!format?.url &&
      (isHlsProtocol(format.protocol) || isDashProtocol(format.protocol))
  );
  if (manifestFormat?.url) {
    return {
      url: manifestFormat.url,
      audioUrl: null,
      title: output?.title || 'Online Video',
      format: isHlsProtocol(manifestFormat.protocol) ? 'HLS' : 'DASH',
      proxyHeaders: pickSafeProxyHeaders(manifestFormat.http_headers || output?.http_headers)
    };
  }

  const supportedFormats = formats.filter(
    (format) =>
      isSupportedVideoCodec(format?.vcodec) &&
      (!format?.acodec || format.acodec === 'none' || isSupportedAudioCodec(format.acodec))
  );

  const formatPool = supportedFormats.length > 0 ? supportedFormats : formats;

  const progressiveMp4 =
    formatPool
      .filter(
        (format) =>
          !!format?.url &&
          format.ext === 'mp4' &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          format.acodec &&
          format.acodec !== 'none' &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol)
      )
      .sort(scoreByQuality)[0] || null;

  if (progressiveMp4?.url) {
    return {
      url: progressiveMp4.url,
      audioUrl: null,
      title: output?.title || 'Online Video',
      format: 'AVC',
      proxyHeaders: pickSafeProxyHeaders(progressiveMp4.http_headers || output?.http_headers)
    };
  }

  const videoOnlyMp4 =
    formatPool
      .filter(
        (format) =>
          !!format?.url &&
          format.ext === 'mp4' &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          (!format.acodec || format.acodec === 'none') &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol)
      )
      .sort(scoreByQuality)[0] || null;

  const audioOnly =
    formats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec === 'none' &&
          format.acodec &&
          format.acodec !== 'none' &&
          (format.ext === 'm4a' || format.ext === 'mp4' || format.ext === 'webm') &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol)
      )
      .sort((a, b) => Number(b?.abr || 0) - Number(a?.abr || 0))[0] || null;

  if (videoOnlyMp4?.url) {
    return {
      url: videoOnlyMp4.url,
      audioUrl: audioOnly?.url || null,
      title: output?.title || 'Online Video',
      format: 'AVC',
      proxyHeaders: pickSafeProxyHeaders(videoOnlyMp4.http_headers || output?.http_headers),
      audioProxyHeaders: pickSafeProxyHeaders(audioOnly?.http_headers || output?.http_headers)
    };
  }

  const hlsVideo =
    formats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          typeof format.protocol === 'string' &&
          isHlsProtocol(format.protocol)
      )
      .sort(scoreByQuality)[0] || null;

  if (hlsVideo?.url) {
    return {
      url: hlsVideo.url,
      audioUrl: null,
      title: output?.title || 'Online Video',
      format: 'HLS',
      proxyHeaders: pickSafeProxyHeaders(hlsVideo.http_headers || output?.http_headers)
    };
  }

  if (Array.isArray(output?.requested_formats) && output.requested_formats.length > 0) {
    const videoFormat = output.requested_formats.find(
      (format) => format.vcodec !== 'none' && format.url && isDirectHttpProtocol(format.protocol)
    );
    const audioFormat = output.requested_formats.find(
      (format) => format.acodec !== 'none' && format.url && isDirectHttpProtocol(format.protocol)
    );

    if (videoFormat?.url) {
      return {
        url: videoFormat.url,
        audioUrl: audioFormat && audioFormat !== videoFormat ? audioFormat.url : null,
        title: output?.title || 'Online Video',
        format: videoFormat.vcodec && (videoFormat.vcodec.includes('avc1') || videoFormat.vcodec.includes('h264')) ? 'AVC' : 'WEB',
        proxyHeaders: pickSafeProxyHeaders(videoFormat.http_headers || output?.http_headers),
        audioProxyHeaders: pickSafeProxyHeaders(audioFormat?.http_headers || output?.http_headers)
      };
    }
  }

  const anyVideo = formatPool.find(
    (format) => format.url && format.vcodec && format.vcodec !== 'none' && isDirectHttpProtocol(format.protocol)
  );
  if (anyVideo?.url) {
    return {
      url: anyVideo.url,
      audioUrl: null,
      title: output?.title || 'Online Video',
      format: anyVideo.ext ? anyVideo.ext.toUpperCase() : 'WEB',
      proxyHeaders: pickSafeProxyHeaders(anyVideo.http_headers || output?.http_headers)
    };
  }

  if (output?.url && isLikelyDirectMediaUrl(output.url)) {
    return {
      url: output.url,
      audioUrl: null,
      title: output?.title || 'Online Video',
      format: output.ext ? output.ext.toUpperCase() : (isLikelyManifestUrl(output.url) ? 'HLS' : 'WEB'),
      proxyHeaders: pickSafeProxyHeaders(output?.http_headers)
    };
  }

  return null;
};

const resolveDirectMediaUrl = (rawUrl) => {
  try {
    const parsed = new URL(normalizeManifestQueryUrl(String(rawUrl || '').trim()));
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const mimeType = String(parsed.searchParams.get('mime') || '').toLowerCase();
    const hasDirectExtension = /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m3u8|mpd)(?:\/)?$/i.test(parsed.pathname);
    const isDriveVideoPlayback =
      pathname.includes('videoplayback') ||
      host.endsWith('.c.drive.google.com') ||
      host.includes('googlevideo.com') ||
      (host.includes('drive.google.com') && pathname.includes('videoplayback'));
    const hasVideoMime =
      mimeType.startsWith('video/') || mimeType.includes('mpegurl') || mimeType.includes('x-mpegurl') || mimeType.includes('dash') || mimeType.includes('mpd');

    if (!hasDirectExtension && !isDriveVideoPlayback && !hasVideoMime) return null;

    return {
      url: parsed.toString(),
      audioUrl: null,
      title: parsed.pathname.split('/').filter(Boolean).pop() || 'Online Video',
      proxyHeaders: null
    };
  } catch {
    return null;
  }
};

const sanitizeIncomingUrl = (rawUrl) => {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  const matched = trimmed.match(/https?:\/\/\S+/i);
  const candidate = matched ? matched[0] : trimmed;
  return candidate.replace(/[\])}"'.,;!?\u2026]+$/g, '');
};

const normalizeManifestQueryUrl = (rawUrl) => {
  const value = String(rawUrl || '').trim();
  if (!value) return '';

  return value
    .replace(/(\.mpd)&(?=[a-z0-9_-]+=)/i, '$1?')
    .replace(/(\.m3u8)&(?=[a-z0-9_-]+=)/i, '$1?');
};

const isLocalMediaPath = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return false;
  if (value.startsWith('file://')) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (value.startsWith('/')) return true;
  return false;
};

const stripHeaderCaseInsensitive = (headers, headerName) => {
  const target = String(headerName || '').toLowerCase();
  Object.keys(headers || {}).forEach((key) => {
    if (key.toLowerCase() === target) delete headers[key];
  });
};

const stripUnsafeResponseHeaders = (headers) => {
  stripHeaderCaseInsensitive(headers, 'Cross-Origin-Resource-Policy');
  stripHeaderCaseInsensitive(headers, 'Cross-Origin-Embedder-Policy');
  stripHeaderCaseInsensitive(headers, 'Cross-Origin-Opener-Policy');
  stripHeaderCaseInsensitive(headers, 'X-Frame-Options');
  stripHeaderCaseInsensitive(headers, 'Content-Security-Policy');
  stripHeaderCaseInsensitive(headers, 'Content-Disposition');
};

const getMediaContentType = (filePath) => {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (lower.endsWith('.ts')) return 'video/mp2t';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.m4s')) return 'video/iso.segment';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.vtt')) return 'text/vtt; charset=utf-8';
  if (lower.endsWith('.mpd')) return 'application/dash+xml';
  return 'application/octet-stream';
};

const toLocalMediaUrl = (absolutePath) => {
  if (!mediaServerOrigin || !absolutePath) return '';
  return `${mediaServerOrigin}/local-media?path=${encodeURIComponent(absolutePath)}`;
};

const rewriteM3u8ForLocalServer = (playlistText, absolutePath) => {
  const baseDir = path.dirname(absolutePath);
  return String(playlistText || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      try {
        const candidate = new URL(trimmed);
        if (candidate.protocol === 'http:' || candidate.protocol === 'https:') return trimmed;
      } catch {
        // Resolve as relative local file.
      }
      return toLocalMediaUrl(path.resolve(baseDir, trimmed)) || line;
    })
    .join('\n');
};

const parseSingleEntryMediaPlaylist = (playlistText, absolutePath = '') => {
  const lines = String(playlistText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;
  if (!/^#EXTM3U/i.test(lines[0])) return null;

  const mediaLines = lines.filter((line) => !line.startsWith('#'));
  if (mediaLines.length !== 1) return null;

  const candidate = mediaLines[0];
  const lowerCandidate = candidate.toLowerCase();
  const looksLikeDirectMedia = /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m4a|aac|mp3|flac)(?:$|\?|#)/i.test(candidate);
  const looksLikeRemoteUrl = /^https?:\/\//i.test(candidate);
  const looksLikeLocalPath = /^[a-zA-Z]:[\\/]/.test(candidate) || candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../');
  const looksLikeNestedPlaylist = /\.(m3u8|m3u|mpd)(?:$|\?|#)/i.test(lowerCandidate);

  if (looksLikeNestedPlaylist) return null;
  if (!looksLikeDirectMedia && !looksLikeRemoteUrl && !looksLikeLocalPath) return null;

  try {
    if (looksLikeRemoteUrl) {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return {
          url: parsed.toString(),
          title: path.basename(decodeURIComponent(parsed.pathname || '')) || 'Online Video',
          kind: 'remote-direct-media'
        };
      }
    }
  } catch {
    // Fall through to local path handling.
  }

  if (!absolutePath) return null;

  const resolvedPath = path.resolve(path.dirname(absolutePath), candidate);
  return {
    url: toLocalMediaUrl(resolvedPath) || '',
    title: path.basename(resolvedPath) || 'Local Video',
    kind: 'local-direct-media',
    filePath: resolvedPath
  };
};

const buildManifestProxyUrl = (absoluteUrl, proxyBase, requestId) => {
  const raw = String(absoluteUrl || '').trim();
  if (!raw) return raw;
  try {
    const candidate = new URL(raw);
    if (candidate.hostname === '127.0.0.1' && candidate.pathname === '/proxy') {
      return candidate.toString();
    }
  } catch {
    // Continue and build a proxied URL below.
  }

  if (!proxyBase) return raw;
  const encoded = encodeURIComponent(raw);

  // Extract rid string from object if accidentally passed as {rid: '...'} to be extra safe
  const ridStr = typeof requestId === 'object' && requestId !== null ? requestId.rid : requestId;
  const ridParam = ridStr ? `&rid=${encodeURIComponent(ridStr)}` : '';

  if (proxyBase.endsWith('/proxy?url=')) {
    return `${proxyBase}${encoded}${ridParam}`;
  }
  return `${proxyBase}/proxy?url=${encoded}${ridParam}`;
};

function rewriteDashManifest(manifestText, baseUrl, proxyBase, requestId) {
  const text = String(manifestText || '');
  if (!text) return text;

  const toAbsoluteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  };

  const toProxyUrl = (value) => {
    const absolute = toAbsoluteUrl(value);
    return buildManifestProxyUrl(absolute, proxyBase, requestId);
  };

  const toDashTemplateProxyUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;

    const templateTokens = [];
    const placeholderSafeValue = raw.replace(/\$[^$]+\$/g, (token) => {
      const marker = `__aether_DASH_TOKEN_${templateTokens.length}__`;
      templateTokens.push({ marker, token });
      return marker;
    });

    let proxied = toProxyUrl(placeholderSafeValue);
    for (const entry of templateTokens) {
      proxied = proxied.split(entry.marker).join(entry.token);
    }

    return proxied;
  };

  let rewritten = text;

  // ── DRM ContentProtection fixup for Electron ──
  // Electron doesn't include Widevine/PlayReady CDMs. If the manifest has
  // non-ClearKey ContentProtection, dash.js's CapabilitiesFilter will call
  // requestMediaKeySystemAccess for Widevine, which fails, causing ALL codecs
  // to be rejected ("No streams to play"). Replace with ClearKey so dash.js
  // checks ClearKey support (built into Chromium) and uses our provided keys.

  // ── Step 0: Hoist per-Representation ContentProtection to AdaptationSet ──
  // Some MPDs (e.g. Amazon) put ContentProtection inside each <Representation>
  // instead of at the <AdaptationSet> level. dash.js probes DRM per-Representation
  // when CP is per-rep, which causes it to only keep one quality level.
  // Fix: extract CP from the first Representation and move it to AdaptationSet.
  rewritten = rewritten.replace(
    /(<AdaptationSet\b[^>]*>)([\s\S]*?)(<Representation\b)/gi,
    (fullMatch, asTag, betweenContent, firstRepTag) => {
      // Check if there's already ContentProtection at the AdaptationSet level
      if (/<ContentProtection/i.test(betweenContent)) {
        return fullMatch; // Already has AS-level CP, don't touch
      }
      // Look for ContentProtection inside the first Representation
      const firstRepEnd = rewritten.indexOf('</Representation>', rewritten.indexOf(firstRepTag, rewritten.indexOf(asTag)));
      if (firstRepEnd === -1) return fullMatch;
      const repBlock = rewritten.substring(rewritten.indexOf(firstRepTag, rewritten.indexOf(asTag)), firstRepEnd);
      const cpElements = repBlock.match(/<ContentProtection(?:(?!\/>)[^>])*>[\s\S]*?<\/ContentProtection>|<ContentProtection[^>]*\/>/gi);
      if (!cpElements || cpElements.length === 0) {
        return fullMatch; // No per-rep CP found
      }
      // Hoist: insert the CP elements right after <AdaptationSet ...>
      const hoistedCP = '\n        ' + cpElements.join('\n        ');
      console.log(`[DASH-REWRITE] Hoisted ${cpElements.length} ContentProtection elements from Representation to AdaptationSet level`);
      return asTag + hoistedCP + betweenContent + firstRepTag;
    }
  );

  // Now remove all per-Representation ContentProtection (they've been hoisted)
  rewritten = rewritten.replace(
    /(<Representation\b[^>]*>)([\s\S]*?)(<\/Representation>)/gi,
    (fullMatch, repOpen, repBody, repClose) => {
      const stripped = repBody.replace(
        /<ContentProtection(?:(?!\/>)[^>])*>[\s\S]*?<\/ContentProtection>|<ContentProtection[^>]*\/>/gi,
        ''
      );
      if (stripped !== repBody) {
        return repOpen + stripped + repClose;
      }
      return fullMatch;
    }
  );

  const hasCenc = /<ContentProtection[^>]*mp4protection/i.test(rewritten);
  const hasNonClearKeyDrm = /<ContentProtection[^>]*schemeIdUri\s*=\s*["']urn:uuid:(?!e2719d58|1077efec)[^"']+["']/i.test(rewritten);
  if (hasCenc && hasNonClearKeyDrm) {
    // Remove Widevine, PlayReady, and other non-ClearKey ContentProtection elements
    // but keep the generic CENC mp4protection signaling
    rewritten = rewritten.replace(
      /<ContentProtection(?:(?!\/>)[^>])*schemeIdUri\s*=\s*["']urn:uuid:(?!e2719d58|1077efec)[^"']+["'](?:(?!\/>)[^>])*>[\s\S]*?<\/ContentProtection>|<ContentProtection[^>]*schemeIdUri\s*=\s*["']urn:uuid:(?!e2719d58|1077efec)[^"']+["'][^>]*\/>/gi,
      ''
    );
    // Add ClearKey ContentProtection if not already present
    if (!/<ContentProtection[^>]*(?:e2719d58|1077efec)/i.test(rewritten)) {
      rewritten = rewritten.replace(
        /(<ContentProtection[^>]*mp4protection[^>]*(?:\/>|>[\s\S]*?<\/ContentProtection>))/gi,
        '$1\n            <ContentProtection schemeIdUri="urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"/>'
      );
    }
    console.log('[DASH-REWRITE] Replaced non-ClearKey DRM ContentProtection with ClearKey');
  }

  rewritten = rewritten.replace(/<BaseURL([^>]*)>([^<]*)<\/BaseURL>/gi, (_match, attrs, inner) => {
    const resolved = toDashTemplateProxyUrl(inner);
    return `<BaseURL${attrs || ''}>${resolved}</BaseURL>`;
  });

  const urlAttributes = ['initialization', 'media', 'sourceURL', 'href', 'contentURL'];
  for (const attr of urlAttributes) {
    const attrPattern = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, 'gi');
    rewritten = rewritten.replace(attrPattern, (_match, prefix, url, suffix) => {
      return `${prefix}${toDashTemplateProxyUrl(url)}${suffix}`;
    });
  }

  if (!/<BaseURL[^>]*>[^<]*<\/BaseURL>/i.test(rewritten)) {
    const manifestBaseUrl = (() => {
      try {
        return new URL('./', baseUrl).href;
      } catch {
        return baseUrl;
      }
    })();
    rewritten = rewritten.replace(
      /(<MPD\b[^>]*>)/i,
      `$1<BaseURL>${toDashTemplateProxyUrl(manifestBaseUrl)}</BaseURL>`
    );
  }

  return rewritten;
}

function rewriteHlsManifest(manifestText, baseUrl, proxyBase, requestId) {
  const text = String(manifestText || '');
  if (!text) return text;

  const toAbsoluteUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    try {
      return new URL(raw, baseUrl).href;
    } catch {
      return raw;
    }
  };

  const toProxyUrl = (value) => {
    const absolute = toAbsoluteUrl(value);
    return buildManifestProxyUrl(absolute, proxyBase, requestId);
  };

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${toProxyUrl(uri)}"`);
      }
      return toProxyUrl(trimmed);
    })
    .join('\n');
}

const getExtensionFromName = (name) => {
  const value = String(name || '').toLowerCase();
  const parts = value.split('.');
  return parts.length > 1 ? parts.pop() : '';
};

const isVideoFilename = (name) =>
  ['mp4', 'webm', 'ogg', 'mkv', 'mov', 'avi', 'm4v'].includes(getExtensionFromName(name));


const fetchText = (rawUrl, headers = {}, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    let targetUrl;
    try {
      targetUrl = new URL(String(rawUrl || '').trim());
    } catch {
      reject(new Error('Invalid URL'));
      return;
    }

    const client = targetUrl.protocol === 'http:' ? http : https;
    const req = client.request(
      targetUrl,
      {
        method: 'GET',
        headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'application/vnd.apple.mpegurl,application/x-mpegurl,text/plain,*/*;q=0.8',
          ...headers
        },
        agent: targetUrl.protocol === 'http:' ? proxyHttpAgent : proxyHttpsAgent
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode || 0}`));
            return;
          }
          resolve(body);
        });
      }
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });

const parseSingleEntryRemotePlaylist = (playlistText, playlistUrl = '') => {
  const directEntry = parseSingleEntryMediaPlaylist(String(playlistText || ''), '');
  if (!directEntry) return null;

  const candidate = String(directEntry.url || '').trim();
  if (!candidate) return null;

  try {
    const resolved = /^https?:\/\//i.test(candidate)
      ? new URL(candidate)
      : new URL(candidate, String(playlistUrl || '').trim());

    return {
      url: resolved.toString(),
      title: path.basename(decodeURIComponent(resolved.pathname || '')) || 'Online Video',
      kind: 'remote-direct-media'
    };
  } catch {
    return null;
  }
};
const normalizeCookieHeader = (setCookieHeader) => {
  const values = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return values
    .filter(Boolean)
    .map((value) => String(value).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
};

const mergeCookieStrings = (...cookieValues) => {
  const jar = new Map();

  cookieValues
    .flat()
    .filter(Boolean)
    .forEach((rawValue) => {
      String(rawValue)
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((pair) => {
          const eqIndex = pair.indexOf('=');
          if (eqIndex <= 0) return;
          const name = pair.slice(0, eqIndex).trim();
          const value = pair.slice(eqIndex + 1).trim();
          if (!name) return;
          jar.set(name, value);
        });
    });

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
};


const buildOrderedRetryList = (urls) => Array.from(new Set((urls || []).filter(Boolean)));



const createMediaProxyServer = async () => {
  if (mediaProxyServer && mediaProxyBaseUrl) return mediaProxyBaseUrl;

  const syncCookiesToElectronSession = async (targetUrl, cookieHeader = '') => {
    const rawCookieHeader = String(cookieHeader || '').trim();
    if (!rawCookieHeader || !session?.defaultSession?.cookies) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(String(targetUrl || ''));
    } catch {
      return;
    }

    const pairs = rawCookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const eqIndex = entry.indexOf('=');
        if (eqIndex <= 0) return null;
        return {
          name: entry.slice(0, eqIndex).trim(),
          value: entry.slice(eqIndex + 1).trim()
        };
      })
      .filter(Boolean);

    if (pairs.length === 0) return;

    await Promise.all(
      pairs.map(async (pair) => {
        const hostname = parsedUrl.hostname.toLowerCase();

        // Build a list of candidate domains: exact hostname, .hostname, and parent domain
        const candidateDomains = new Set([hostname, `.${hostname}`]);
        const parts = hostname.split('.');
        if (parts.length >= 2) {
          const baseDomain = parts.slice(-2).join('.');
          candidateDomains.add(baseDomain);
          candidateDomains.add(`.${baseDomain}`);
        }

        for (const domain of candidateDomains) {
          try {
            await session.defaultSession.cookies.set({
              url: `${parsedUrl.protocol}//${parsedUrl.hostname}`,
              name: pair.name,
              value: pair.value,
              domain,
              path: '/',
              secure: parsedUrl.protocol === 'https:',
              httpOnly: false,
              sameSite: 'no_restriction',
              expirationDate: Math.floor(Date.now() / 1000) + 7200 // 2 hours
            });
          } catch (e) {
            // Ignore individual set failures
          }
        }
      })
    );
  };

  const getHeaderCaseInsensitive = (headers, key) => {
    if (!headers || !key) return undefined;
    const lowerKey = key.toLowerCase();
    for (const h in headers) {
      if (h.toLowerCase() === lowerKey) return headers[h];
    }
    return undefined;
  };

  const prepareElectronFetchRequest = (targetUrl, options = {}) => {
    const requestHeaders = { ...(options?.headers || {}) };

    // Extract referer before stripping
    let fetchReferrer = getHeaderCaseInsensitive(requestHeaders, 'referer');
    if (!fetchReferrer) {
      fetchReferrer = `https://${targetUrl.hostname}/`;
    }

    // ── Cross-origin Referer detection ─────────────────────────────────────
    const refererOrigin = (() => { try { return new URL(fetchReferrer).origin; } catch { return ''; } })();
    const targetOrigin = targetUrl.origin || (targetUrl.protocol + '//' + targetUrl.host);
    const isCrossOriginReferer = !!(refererOrigin && targetOrigin && refererOrigin !== targetOrigin);

    // CRITICAL: Strip Origin to bypass CDN/WAF "localhost" rejection
    stripHeaderCaseInsensitive(requestHeaders, 'origin');
    stripHeaderCaseInsensitive(requestHeaders, 'referer'); // Always strip – passed via X-aether-Referer or fetch option

    if (isCrossOriginReferer) {
      // Chromium's fetch and net.request block cross-origin Referer headers directly.
      // We smuggle it using a custom header, and the webRequest.onBeforeSendHeaders
      // hook will transparently swap it back to 'Referer' at the network level.
      requestHeaders['X-aether-Referer'] = fetchReferrer;
      console.log('[PROXY][ElectronFetch] Cross-origin Referer via X-aether-Referer: ' + fetchReferrer);
    }

    stripHeaderCaseInsensitive(requestHeaders, 'host');
    stripHeaderCaseInsensitive(requestHeaders, 'connection');
    stripHeaderCaseInsensitive(requestHeaders, 'content-length');
    stripHeaderCaseInsensitive(requestHeaders, 'transfer-encoding');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-fetch-site');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-fetch-mode');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-fetch-dest');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-ch-ua');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-ch-ua-mobile');
    stripHeaderCaseInsensitive(requestHeaders, 'sec-ch-ua-platform');
    stripHeaderCaseInsensitive(requestHeaders, 'cookie');

    if (!getHeaderCaseInsensitive(requestHeaders, 'user-agent')) {
      requestHeaders['user-agent'] = DESKTOP_USER_AGENT;
    }

    return {
      requestHeaders,
      fetchReferrer: isCrossOriginReferer ? null : fetchReferrer,
      isCrossOriginReferer
    };
  };

  async function streamFromElectronFetch(targetUrl, options, res, redirectCount = 0, fileId = null, retryCount = 0) {
    const targetHost = String(targetUrl.hostname || '').toLowerCase();
    const targetPathname = String(targetUrl.pathname || '').toLowerCase();
    const isPixelDrainTarget = isPixeldrainHost(targetHost);
    const isDirectBinaryTarget = isDirectBinaryMediaPath(targetPathname);
    const isManifestLikeTarget = targetPathname.endsWith('.m3u8') || targetPathname.endsWith('.mpd');
    const isResilientMediaTarget = isManifestLikeTarget || isDirectBinaryTarget;
    const incomingMethod = String(options?.method || 'GET').toUpperCase();
    const requestMethod = incomingMethod === 'HEAD' ? 'GET' : incomingMethod;
    let { requestHeaders, fetchReferrer, isCrossOriginReferer } = prepareElectronFetchRequest(targetUrl, options);
    const upstreamTimeoutMs = isPixelDrainTarget
      ? 30000
      : isDirectBinaryTarget
        ? 180000
        : isManifestLikeTarget
          ? 120000
          : 90000;

    // Use the best available Chromium-backed fetch logic to bypass TLS fingerprinting.
    // session.fetch is preferred for implicit cookie/session isolation, net.fetch as fallback.
    const electronFetch = session?.defaultSession?.fetch
      ? session.defaultSession.fetch.bind(session.defaultSession)
      : net?.fetch
        ? net.fetch.bind(net)
        : null;

    if (!electronFetch) {
      console.warn('[PROXY] No Chromium-backed fetch available, falling back to Node upstream.');
      streamFromUpstream(targetUrl, options, res, redirectCount, fileId, retryCount);
      return;
    }

    if (incomingMethod === 'HEAD' && !requestHeaders.Range) {
      requestHeaders.Range = 'bytes=0-0';
    }

    console.log(`[PROXY][REQ] ${requestMethod} ${targetUrl.toString()}`);
    if (getHeaderCaseInsensitive(options?.headers, 'range')) {
      console.log(`  Range: ${getHeaderCaseInsensitive(options.headers, 'range')}`);
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(new Error('Proxy upstream timeout')), upstreamTimeoutMs);

    let isClientDisconnected = false;
    const onClientDisconnect = () => {
      isClientDisconnected = true;
      console.log(`[PROXY] Client disconnected (seek). Aborting upstream fetch: ${targetUrl.toString()}`);
      abortController.abort();
    };
    res.on('close', onClientDisconnect);
    const fetchRedirectMode = isDirectBinaryTarget ? 'follow' : 'manual';

    try {
      await syncCookiesToElectronSession(
        targetUrl.toString(),
        getHeaderCaseInsensitive(options?.headers, 'cookie') || ''
      );

      const fetchOpts = {
        method: requestMethod,
        headers: requestHeaders,
        credentials: 'include',
        useSessionCookies: true,
        redirect: fetchRedirectMode,
        signal: abortController.signal,
        bypassCustomProtocolHandlers: true
      };
      if (fetchReferrer && !isCrossOriginReferer) {
        fetchOpts.referrer = fetchReferrer;
        fetchOpts.referrerPolicy = 'no-referrer-when-downgrade';
      }

      const response = await electronFetch(targetUrl.toString(), fetchOpts);
      clearTimeout(timeoutHandle);

      const statusCode = response.status || 502;
      const location = response.headers.get('location');
      if (fetchRedirectMode === 'manual' && location && [301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 6) {
        let nextUrl;
        try {
          nextUrl = new URL(location, targetUrl);
        } catch {
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Invalid redirect URL');
          }
          return;
        }
        console.log(`Proxy upstream redirect (${statusCode}): ${targetUrl.toString()} -> ${nextUrl.toString()}`);
        await response.body?.cancel?.().catch(() => { });
        res.removeListener('close', onClientDisconnect);

        // ── Update Referer to full redirect-source URL ─────────────────────
        // CDN auth-gate scripts (remote_control.php) validate that Referer
        // contains the full upstream path (e.g. whoreshub.com/get_file/...),
        // not just the origin.  Mirror what a real browser does on redirect:
        // set Referer = the URL that issued the redirect.
        const redirectSourceUrl = targetUrl.toString();
        const updatedHeaders = { ...(options?.headers || {}), referer: redirectSourceUrl };

        // ── Range deferral for script-gate endpoints ───────────────────────
        const nextPathLower = nextUrl.pathname.toLowerCase();
        const isNextScriptGate = /\.(php|asp|aspx|cgi|pl)(\?|$)/i.test(nextPathLower) && !/\.(mp4|ts|m4s|m3u8|mpd|webm|mkv|mov|m4a|mp3|jpg|png|jpeg)(\?|&|$)/i.test(nextUrl.search);
        const currentRange = getHeaderCaseInsensitive(updatedHeaders, 'range') || (options && options._deferredRange) || '';

        let nextOptions;
        if (isNextScriptGate && currentRange) {
          // Strip Range for script-gate hops (they can't serve byte ranges)
          const stripped = { ...updatedHeaders };
          delete stripped['range'];
          delete stripped['Range'];
          nextOptions = { ...options, headers: stripped, _deferredRange: currentRange };
          console.log('[PROXY][ElectronFetch] Script auth-gate – deferring Range "' + currentRange + '", Referer → ' + redirectSourceUrl);
        } else if (!isNextScriptGate && options?._deferredRange) {
          // Arrived at binary URL – restore deferred Range
          updatedHeaders['range'] = options._deferredRange;
          nextOptions = { ...options, headers: updatedHeaders, _deferredRange: null };
          console.log('[PROXY][ElectronFetch] Restoring deferred Range "' + options._deferredRange + '" for binary hop');
        } else {
          nextOptions = { ...options, headers: updatedHeaders };
        }

        return streamFromElectronFetch(nextUrl, nextOptions, res, redirectCount + 1, fileId, retryCount);
      }

      if (statusCode === 403) {
        const body = await response.text().catch(() => '');
        if (isPixelDrainTarget) {
          const isRateLimited = body.includes('max_concurrent_downloads');
          if (isRateLimited) {
            console.log('PixelDrain rate limit hit, backing off for 60 seconds');
            pixeldrainModule.pixelDrainBackoffUntil = Date.now() + 60000;
            if (!res.headersSent) {
              res.removeListener('close', onClientDisconnect);
              res.writeHead(503, { 'Retry-After': '60' });
              res.end('Service Unavailable');
            }
            return;
          }
        } else if (isDriveMediaHost(targetHost)) {
          console.log('Drive 403 response body:', body.slice(0, 200));
        }
        if (!res.headersSent) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.removeListener('close', onClientDisconnect);
          res.end('Forbidden');
        }
        return;
      }

      if (statusCode >= 400) {
        console.warn(`[PROXY] Upstream error: ${statusCode} for ${targetUrl.toString()}`);
      }

      // ── Misidentified script-gate fallback ────────────────────────────────
      // If we deferred a Range request because we assumed this was a redirector
      // (e.g. remote_control.php), but it actually returned the solid 200 OK 
      // video stream, we must restart the request with the Range header restored.
      // Otherwise, the seek is ignored and it downloads from byte 0.
      if (statusCode === 200 && options?._deferredRange) {
        console.log('[PROXY] Script-gate is actually a streaming endpoint. Restoring deferred Range and retrying: ' + options._deferredRange);
        // Forcefully kill the TCP socket to prevent origin connection starvation
        abortController.abort();
        res.removeListener('close', onClientDisconnect);

        const retryHeaders = { ...(options.headers || {}) };
        retryHeaders['range'] = options._deferredRange;
        return streamFromElectronFetch(targetUrl, { ...options, headers: retryHeaders, _deferredRange: null }, res, redirectCount, fileId, retryCount);
      }

      if (retryCount > 0 && statusCode >= 200 && statusCode < 400) {
        console.log(`Proxy upstream request succeeded after ${retryCount + 1} attempts for ${targetUrl.toString()}`);
      }

      const responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      console.log(`[PROXY][RES] Status: ${statusCode}`);
      console.log(`  Content-Type: ${responseHeaders['content-type']}`);
      console.log(`  Content-Length: ${responseHeaders['content-length']}`);
      if (responseHeaders['content-range']) console.log(`  Content-Range: ${responseHeaders['content-range']}`);
      stripUnsafeResponseHeaders(responseHeaders);
      stripHeaderCaseInsensitive(responseHeaders, 'content-encoding');
      stripHeaderCaseInsensitive(responseHeaders, 'transfer-encoding');
      stripHeaderCaseInsensitive(responseHeaders, 'connection');
      stripHeaderCaseInsensitive(responseHeaders, 'content-disposition');
      responseHeaders['access-control-allow-origin'] = '*';
      responseHeaders['accept-ranges'] = 'bytes';
      const isImmutableSegment = /\.(ts|m4s|aac)(\?|$)/i.test(String(targetUrl.pathname || ''));
      const isProgressiveMediaFile = /\.(mp4|webm|mkv|mov|m4a)(\?|$)/i.test(String(targetUrl.pathname || ''));
      if (isPixelDrainTarget) {
        responseHeaders['cache-control'] = 'public, max-age=5';
      } else if (isImmutableSegment) {
        responseHeaders['cache-control'] = 'public, max-age=7200, immutable';
      } else if (isProgressiveMediaFile) {
        // Progressive files need fresh Range requests for seeking – never cache
        responseHeaders['cache-control'] = 'no-store';
      } else {
        responseHeaders['cache-control'] = 'no-cache, no-store, max-age=0, no-transform';
      }
      responseHeaders['content-type'] = responseHeaders['content-type'] || 'video/mp4';
      responseHeaders['access-control-expose-headers'] = 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag';

      if (responseHeaders['content-type'].includes('text/html')) {
        console.warn(`[PROXY][CHROMIUM] Rejected text/html response from upstream: ${targetUrl.toString()}`);
        if (!res.headersSent) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden: Upstream returned HTML instead of media');
        }
        await response.body?.cancel?.().catch(() => { });
        return;
      }

      if (statusCode === 206 && responseHeaders['content-range']) {
        const contentRange = responseHeaders['content-range'];
        const rangeMatch = /bytes\s+(\d+)-(\d+)\/(\d+)/.exec(contentRange);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          responseHeaders['content-length'] = end - start + 1;
        }
      }

      const outgoingStatusCode = incomingMethod === 'HEAD' && statusCode === 206 ? 200 : statusCode;
      res.writeHead(outgoingStatusCode, responseHeaders);
      if (incomingMethod === 'HEAD') {
        await response.body?.cancel?.().catch(() => { });
        res.removeListener('close', onClientDisconnect);
        res.end();
        return;
      }

      res.on('finish', () => res.removeListener('close', onClientDisconnect));

      if (!response.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(response.body);
      nodeStream.on('error', (error) => {
        if (!isClientDisconnected) {
          console.error('Proxy upstream response stream error:', error);
        }
        if (!res.writableEnded) {
          try { res.destroy(error); } catch { }
        }
      });
      nodeStream.pipe(res);
      return;
    } catch (error) {
      clearTimeout(timeoutHandle);

      if (isClientDisconnected || res.destroyed) {
        return;
      }

      const errorCode = String(error?.code || (error?.name === 'AbortError' ? 'ETIMEDOUT' : ''));
      const errorMessage = String(error?.message || '');
      const isSocketReset = errorCode === 'ECONNRESET' || /socket hang up|econnreset/i.test(errorMessage);
      const isTimeout = errorCode === 'ETIMEDOUT' || error?.name === 'AbortError' || /timed out/i.test(errorMessage);
      const isChromiumValidationFailure = /ERR_BLOCKED_BY_CLIENT|ERR_FAILED|ERR_INVALID_ARGUMENT|invalid referrer|invalid referrer policy/i.test(errorMessage);
      const canRetry =
        retryCount < MAX_RETRIES &&
        redirectCount < 6 &&
        !res.headersSent &&
        !res.writableEnded &&
        !res.destroyed &&
        ['GET', 'HEAD'].includes(incomingMethod) &&
        !isPixelDrainTarget &&
        isResilientMediaTarget &&
        (isSocketReset || isTimeout || isChromiumValidationFailure);

      console.error('Proxy upstream error:', error);

      // ERR_INVALID_ARGUMENT means Chromium rejected the URL itself (e.g.
      // unencoded commas that survived sanitization).  Stripping the referrer
      // won't help – fall back directly to the Node.js http(s) client which
      // is far more permissive with URL characters.
      const isUrlValidationError = /ERR_INVALID_ARGUMENT/i.test(errorMessage);
      if (isUrlValidationError && !res.headersSent && !res.writableEnded) {
        console.warn(`[PROXY] Chromium ERR_INVALID_ARGUMENT – falling back to Node upstream for ${targetUrl.toString()}`);
        res.removeListener('close', onClientDisconnect);
        streamFromUpstream(targetUrl, options, res, redirectCount, fileId, retryCount);
        return;
      }

      if (isChromiumValidationFailure && !isUrlValidationError && fetchReferrer && !res.headersSent && !res.writableEnded) {
        console.warn(`Retrying upstream request without referrer for ${targetUrl.toString()}`);
        const retryOptions = {
          ...(options || {}),
          headers: { ...(options?.headers || {}) }
        };
        stripHeaderCaseInsensitive(retryOptions.headers, 'referer');
        stripHeaderCaseInsensitive(retryOptions.headers, 'origin');
        res.removeListener('close', onClientDisconnect);
        return streamFromElectronFetch(targetUrl, retryOptions, res, redirectCount, fileId, retryCount + 1);
      }

      if (canRetry) {
        const delayMs = isSocketReset ? 50 : BASE_DELAY * (retryCount + 1);
        console.warn(`Retrying upstream request (${retryCount + 1}/${MAX_RETRIES}) in ${delayMs}ms for ${targetUrl.toString()}`);
        setTimeout(() => {
          res.removeListener('close', onClientDisconnect);
          streamFromElectronFetch(targetUrl, options, res, redirectCount, fileId, retryCount + 1);
        }, delayMs);
        return;
      }

      if (!res.headersSent) res.writeHead(isTimeout ? 504 : 502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      if (!res.writableEnded) {
        res.removeListener('close', onClientDisconnect);
        res.end(isTimeout ? 'Upstream timeout' : 'Upstream error');
      }
    }
  }

  async function streamFromUpstream(targetUrl, options, res, redirectCount = 0, fileId = null, retryCount = 0) {
    const requestClient = targetUrl.protocol === 'http:' ? http : https;
    const targetHost = String(targetUrl.hostname || '').toLowerCase();
    const isPixelDrainTarget = isPixeldrainHost(targetHost);
    const targetPathname = String(targetUrl.pathname || '').toLowerCase();
    const isDirectBinaryTarget = isDirectBinaryMediaPath(targetPathname);
    const isManifestLikeTarget = targetPathname.endsWith('.m3u8') || targetPathname.endsWith('.mpd');
    const isResilientMediaTarget = isManifestLikeTarget || isDirectBinaryTarget;
    const upstreamTimeoutMs = isPixelDrainTarget
      ? 120000
      : isDirectBinaryTarget
        ? 180000
        : isManifestLikeTarget
          ? 120000
          : 90000;
    const incomingMethod = String(options?.method || 'GET').toUpperCase();
    const requestMethod = incomingMethod === 'HEAD' ? 'GET' : incomingMethod;
    const requestHeaders = { ...(options?.headers || {}) };
    // Always strip 'host' so Node's http.request sets it from targetUrl.
    // A stale host header (e.g. www.whoreshub.com) on a cross-host redirect
    // causes nginx on the CDN to not find a matching virtual-host and return 404.
    delete requestHeaders['host'];
    delete requestHeaders['Host'];
    // Use shared keep-alive agents – preemptive abort in startPixelDrainStream
    // handles connection re-use safely, so we no longer need the old
    // single-socket-per-request isolation.
    const requestAgent =
      options?.agent ||
      (targetUrl.protocol === 'http:' ? proxyHttpAgent : proxyHttpsAgent);

    if (incomingMethod === 'HEAD' && !requestHeaders.Range) {
      requestHeaders.Range = 'bytes=0-0';
    }

    // Sync cookies from Electron session to Node-native request headers
    try {
      const cookies = await session.defaultSession.cookies.get({ url: targetUrl.toString() });
      if (cookies && cookies.length > 0) {
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        requestHeaders['cookie'] = cookieStr;
      }
    } catch (e) {
      // Ignore cookie extraction errors
    }

    console.log(`[PROXY][REQ][NODE] ${requestMethod} ${targetUrl.toString()}`);
    if (getHeaderCaseInsensitive(options?.headers, 'range')) {
      console.log(`  Range: ${getHeaderCaseInsensitive(options.headers, 'range')}`);
    }

    let upstreamReq;
    let isClientDisconnected = false;
    let clientDisconnectedAt = 0;
    const onClientDisconnect = () => {
      isClientDisconnected = true;
      clientDisconnectedAt = Date.now();
      console.log(`[PROXY] Client disconnected (seek). Destroying upstream socket: ${targetUrl.toString()}`);
      if (upstreamReq) {
        // Grab the socket BEFORE destroying the request so we can nuke it
        // independently.  destroy() alone can return the socket to the
        // keepAlive pool while it still has buffered/in-flight data, which
        // causes ECONNRESET on the very next Range request.
        const sock = upstreamReq.socket;
        upstreamReq.destroy();
        if (sock && !sock.destroyed) sock.destroy();
      }
    };
    res.on('close', onClientDisconnect);

    upstreamReq = requestClient.request(
      targetUrl,
      {
        method: requestMethod,
        headers: requestHeaders,
        agent: requestAgent
      },
      (upstreamRes) => {
        res.on('finish', () => res.removeListener('close', onClientDisconnect));
        const statusCode = upstreamRes.statusCode || 502;
        const location = upstreamRes.headers?.location;

        if (location && [301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 6) {
          let nextUrl;
          try {
            nextUrl = new URL(location, targetUrl);
          } catch {
            res.writeHead(502);
            res.end('Invalid redirect URL');
            return;
          }
          console.log(`Proxy upstream redirect (${statusCode}): ${targetUrl.toString()} -> ${nextUrl.toString()}`);

          // ── Referer update ───────────────────────────────────────────────────
          // A real browser sets Referer on the next hop to the URL that issued
          // the redirect, not to the original page URL.  CDN auth-gate scripts
          // (remote_control.php, etc.) typically validate that Referer comes from
          // the expected upstream host (e.g. whoreshub.com/get_file/...).
          // Sending the Playwright-captured page Referer instead causes 404.
          const redirectSourceStr = targetUrl.toString();
          const redirectSourceOrigin = targetUrl.origin || (targetUrl.protocol + '//' + targetUrl.host);
          const nextOrigin = nextUrl.origin || (nextUrl.protocol + '//' + nextUrl.host);
          const isSameOriginRedirect = redirectSourceOrigin === nextOrigin;
          const nextPathLower = nextUrl.pathname.toLowerCase();
          // A script gate is an auth-gate endpoint (.php, .asp, etc.) that validates
          // tokens/referers and then redirects to the actual CDN binary.  We only
          // check the *pathname* for media extensions (not the query string) because
          // URLs like remote_control.php?file=xxx.mp4 have .mp4 in the query params
          // but are still script gates.
          const isScriptGate = /\.(php|asp|aspx|cgi|pl)(\?|$)/i.test(nextPathLower) && !/\.(mp4|ts|m4s|m3u8|mpd|webm|mkv|mov|m4a|mp3|jpg|png|jpeg)(\?|\/|$)/i.test(nextPathLower);

          // ── Universal media-redirect trust heuristic ─────────────────────────
          // Instead of hardcoding specific domains, we detect whether the
          // redirect source looks like a media delivery URL.  This covers any
          // site whose CDN auth-gate scripts validate the Referer path.
          // Criteria (any match → trusted):
          //   • Path contains common media-delivery segments
          //   • Path ends with a known media extension
          //   • URL has query params typical of CDN token auth
          //   • The redirect target is a script gate (auth endpoint)
          const redirectPathLower = targetUrl.pathname.toLowerCase();
          const redirectSearchLower = (targetUrl.search || '').toLowerCase();
          const isTrustedMediaReferer = (
            /\/(get_file|serve|embed|video|stream|download|media|player|hls|dash|source|content)\//i.test(redirectPathLower) ||
            /\.(mp4|m3u8|mpd|ts|m4s|webm|mkv|mov|flv|avi|wmv|m4a|mp3|aac|ogg)(\/|\?|$)/i.test(redirectPathLower) ||
            /[?&](token|expires|hash|key|sig|signature|hdnts|st|e)=/i.test(redirectSearchLower) ||
            isScriptGate
          );

          // ── Referer update ───────────────────────────────────────────────────
          // CDN auth-gate scripts (remote_control.php) validate that the Referer
          // contains the expected get_file path from the media site.  We MUST
          // send the full redirect source URL — not just the origin — so the
          // PHP script can verify the request is legitimate.
          //
          // For non-trusted / unrelated cross-origin redirects, send origin
          // only (mirrors strict-origin-when-cross-origin browser default).
          let nextReferer;
          if (isSameOriginRedirect || isTrustedMediaReferer) {
            // Same-origin or trusted media delivery chain: full URL (CDN needs the path)
            nextReferer = redirectSourceStr;
          } else {
            // Unrelated cross-origin: origin only
            nextReferer = redirectSourceOrigin + '/';
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Range deferral ───────────────────────────────────────────────────
          // Auth-gate scripts (e.g. remote_control.php, download.php) are pure
          // token-validators — they don't serve byte ranges themselves, they just
          // redirect to the actual CDN file.  Sending Range: bytes=N- to them
          // causes 404 because the PHP script has no idea what to do with it.
          //
          // Strategy: strip Range from script-endpoint hops and stash it in
          // _deferredRange so it is re-applied once we reach the actual binary
          // media URL (detected by a non-script pathname on the next hop).
          // CRITICAL: Check header-range and deferred-range SEPARATELY.
          const headerRange = getHeaderCaseInsensitive(options && options.headers, 'range') || '';
          const deferredRange = (options && options._deferredRange) || '';

          let nextOptions;
          if (isScriptGate && (headerRange || deferredRange)) {
            // Strip Range for this hop, save it for the next binary hop
            const rangeToDefer = headerRange || deferredRange;
            const strippedHeaders = Object.assign({}, options && options.headers, { referer: nextReferer });
            delete strippedHeaders['range'];
            delete strippedHeaders['Range'];
            nextOptions = Object.assign({}, options, { headers: strippedHeaders, _deferredRange: rangeToDefer });
            console.log('[PROXY] Script auth-gate – deferring Range "' + rangeToDefer + '", Referer → ' + nextReferer);
          } else if (!isScriptGate && deferredRange) {
            // Arrived at a binary URL – restore the deferred Range
            const restoredHeaders = Object.assign({}, options && options.headers, { range: deferredRange, referer: nextReferer });
            nextOptions = Object.assign({}, options, { headers: restoredHeaders, _deferredRange: null });
            console.log('[PROXY] Restoring deferred Range "' + deferredRange + '" for binary hop, Referer → ' + nextReferer);
          } else {
            // Standard redirect — just update Referer to redirect source
            const updatedHeaders = Object.assign({}, options && options.headers, { referer: nextReferer });
            nextOptions = Object.assign({}, options, { headers: updatedHeaders });
          }

          // ── Virtual-host Host header fix ─────────────────────────────────────
          // When a media site redirects to its own CDN on a different subdomain,
          // the CDN's nginx may require the Host header to match the original
          // media domain (virtual-host routing).  We detect "related" domains
          // by checking if they share a base domain.
          if (isTrustedMediaReferer && !isSameOriginRedirect && !isScriptGate) {
            try {
              const mediaHost = new URL(redirectSourceStr).host;
              const mediaBaseDomain = mediaHost.replace(/^www\./, '');
              const cdnHost = nextUrl.host.toLowerCase();
              const isRelatedDomain = cdnHost.includes(mediaBaseDomain) || mediaBaseDomain.includes(cdnHost.replace(/^[^.]+\./, ''));
              if (mediaHost && mediaHost !== nextUrl.host && isRelatedDomain) {
                const hostFixedHeaders = Object.assign({}, nextOptions.headers, { host: mediaHost });
                nextOptions = Object.assign({}, nextOptions, { headers: hostFixedHeaders });
                console.log('[PROXY] CDN vhost fix: Host → ' + mediaHost + ' for ' + nextUrl.host);
              }
            } catch (_) { /* ignore malformed referer */ }
          }
          // ─────────────────────────────────────────────────────────────────────

          // ── Cross-origin CDN script gates: prefer Electron fetch ─────────────
          // CDN anti-bot measures (TLS fingerprinting, JA3/JA4 checks) often
          // reject Node.js http(s) connections with 404 because the TLS client
          // hello doesn't match a real browser.  For cross-origin script-gate
          // redirects, try Electron's Chromium-backed fetch first which has a
          // proper browser TLS fingerprint.
          if (isScriptGate && !isSameOriginRedirect) {
            console.log('[PROXY] CDN script-gate – using Electron fetch (browser TLS) for ' + nextUrl.host);
            upstreamRes.resume();
            res.removeListener('close', onClientDisconnect);
            return streamFromElectronFetch(nextUrl, nextOptions, res, redirectCount + 1, fileId, retryCount);
          }

          upstreamRes.resume();
          res.removeListener('close', onClientDisconnect);
          return streamFromUpstream(nextUrl, nextOptions, res, redirectCount + 1, fileId, retryCount);
        }

        // Log body of 4xx responses from CDN/script-gate hosts for debugging.
        // On 404 from CDN endpoints: fall back to Electron's Chromium-backed
        // fetch which has a browser TLS fingerprint that CDN anti-bot systems
        // accept.  This handles cases where Node.js TLS is fingerprinted and
        // rejected by the CDN even with correct headers.
        if (statusCode === 404 && !isPixelDrainTarget) {
          let body404 = '';
          upstreamRes.on('data', (chunk) => { if (body404.length < 512) body404 += Buffer.from(chunk).toString('utf8'); });
          upstreamRes.on('end', () => {
            console.warn('[PROXY] 404 from upstream:', targetUrl.hostname + targetUrl.pathname.slice(0, 80));
            console.warn('[PROXY] 404 body snippet:', body404.replace(/\s+/g, ' ').slice(0, 300));

            if (retryCount < MAX_RETRIES && !res.headersSent && !res.writableEnded) {
              // Build clean retry headers for Electron fetch
              const retryHeaders = Object.assign({}, options && options.headers);
              delete retryHeaders['host'];
              delete retryHeaders['Host'];
              // Restore any deferred Range for the retry
              if (options && options._deferredRange && !getHeaderCaseInsensitive(retryHeaders, 'range')) {
                retryHeaders['range'] = options._deferredRange;
              }
              const retryOptions = Object.assign({}, options, { headers: retryHeaders, _deferredRange: null });

              console.log('[PROXY] 404 – retrying with Electron fetch (browser TLS fingerprint) for ' + targetUrl.hostname);
              res.removeListener('close', onClientDisconnect);
              setTimeout(() => {
                streamFromElectronFetch(targetUrl, retryOptions, res, redirectCount, fileId, retryCount + 1);
              }, 150);
              return;
            }

            if (!res.headersSent) {
              res.removeListener('close', onClientDisconnect);
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
              res.end('Not Found');
            }
          });
          return;
        }

        // Handle 403 specially
        if (statusCode === 403) {
          let body = '';
          upstreamRes.on('data', (chunk) => {
            if (body.length < 2048) {
              body += Buffer.from(chunk).toString('utf8');
            }
          });
          upstreamRes.on('end', () => {
            if (isPixelDrainTarget) {
              console.log('PixelDrain 403 response headers:', upstreamRes.headers);
              console.log('PixelDrain 403 body:', body.slice(0, 200));

              const isRateLimited = body.includes('max_concurrent_downloads');
              if (isRateLimited) {
                console.log('PixelDrain rate limit hit, backing off for 60 seconds');
                pixeldrainModule.pixelDrainBackoffUntil = Date.now() + 60000; // 60 seconds backoff
                if (!res.headersSent) {
                  res.writeHead(503, { 'Retry-After': '60' });
                  res.end('Service Unavailable');
                }
                return;
              }
            } else if (isDriveMediaHost(targetHost)) {
              console.log('Drive 403 response headers:', upstreamRes.headers);
              console.log('Drive 403 body:', body.slice(0, 200));
            }

            upstreamRes.resume();
            if (!res.headersSent) {
              res.removeListener('close', onClientDisconnect);
              res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Forbidden');
            }
          });
          return;
        }

        // ── Misidentified script-gate fallback ────────────────────────────────
        // If we deferred a Range request assuming this was a pure redirector
        // but it actually returned a solid 200 OK stream, we must restart the
        // request with the Range header restored to preserve the seek offset.
        if (statusCode === 200 && options?._deferredRange) {
          console.log('[PROXY][NODE] Script-gate is actually a streaming endpoint. Restoring deferred Range and retrying: ' + options._deferredRange);
          upstreamRes.resume(); // consume any pending data to unblock socket
          if (upstreamReq) {
            const sock = upstreamReq.socket;
            upstreamReq.destroy();
            if (sock && !sock.destroyed) sock.destroy();
          }
          res.removeListener('close', onClientDisconnect);

          const retryHeaders = { ...(options.headers || {}) };
          retryHeaders['range'] = options._deferredRange;
          return streamFromUpstream(targetUrl, { ...options, headers: retryHeaders, _deferredRange: null }, res, redirectCount, fileId, retryCount);
        }

        if (retryCount > 0 && statusCode >= 200 && statusCode < 400) {
          console.log(`Proxy upstream request succeeded after ${retryCount + 1} attempts for ${targetUrl.toString()}`);
        }

        upstreamRes.on('data', () => {
          upstreamReq.setTimeout(upstreamTimeoutMs);
        });

        const responseHeaders = { ...upstreamRes.headers };
        stripUnsafeResponseHeaders(responseHeaders);
        stripHeaderCaseInsensitive(responseHeaders, 'content-encoding');
        stripHeaderCaseInsensitive(responseHeaders, 'transfer-encoding');
        stripHeaderCaseInsensitive(responseHeaders, 'connection');
        stripHeaderCaseInsensitive(responseHeaders, 'content-disposition');
        responseHeaders['access-control-allow-origin'] = '*';
        responseHeaders['accept-ranges'] = 'bytes';
        const isImmutableSegment = /\.(ts|m4s|aac)(\?|$)/i.test(String(targetUrl.pathname || ''));
        const isProgressiveMediaFile = /\.(mp4|webm|mkv|mov|m4a)(\?|$)/i.test(String(targetUrl.pathname || ''));
        if (isPixelDrainTarget) {
          responseHeaders['cache-control'] = 'public, max-age=5';
        } else if (isImmutableSegment) {
          responseHeaders['cache-control'] = 'public, max-age=7200, immutable';
        } else if (isProgressiveMediaFile) {
          // Progressive files need fresh Range requests for seeking – never cache
          responseHeaders['cache-control'] = 'no-store';
        } else {
          responseHeaders['cache-control'] = 'no-cache, no-store, max-age=0, no-transform';
        }

        let proxyContentType = upstreamRes.headers?.['content-type'];

        // Always try to accurately identify the content type, even for 304s, 
        // because browsers will update their cached headers with our response.
        // If we omit Content-Type, hls.js falls back to the file extension, 
        // which crashes if a site serves MP4 data disguised as .ts files.
        const path = String(targetUrl.pathname || '').toLowerCase();

        if (/\.m3u8(?:\?|$)/.test(path)) {
          proxyContentType = 'application/vnd.apple.mpegurl';
        } else if (/\.ts(?:\?|$)/.test(path)) {
          // Many sites serve Fragmented MP4 files disguised as .ts chunks
          // to bypass adblockers or for legacy reasons. We can detect this if the path
          // contains .mp4 or specific codec strings before the .ts segment.
          if (/\.mp4\//i.test(path) || /h264/i.test(path) || /av1/i.test(path)) {
            proxyContentType = 'video/mp4';
          } else if (!proxyContentType) {
            proxyContentType = 'video/mp2t';
          }
        } else if (/\.m4s(?:\?|$)/.test(path)) {
          proxyContentType = 'video/mp4';
        } else if (!proxyContentType) {
          proxyContentType = 'video/mp4';
        }

        if (proxyContentType) {
          responseHeaders['content-type'] = proxyContentType;
        } else {
          delete responseHeaders['content-type'];
        }

        responseHeaders['access-control-expose-headers'] =
          'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag';

        if (responseHeaders['content-type']?.includes('text/html')) {
          console.warn(`[PROXY][NODE] Rejected text/html response from upstream: ${targetUrl.toString()}`);
          if (!res.headersSent) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden: Upstream returned HTML instead of media');
          }
          upstreamRes.resume();
          return;
        }

        if (statusCode === 206 && upstreamRes.headers?.['content-range']) {
          responseHeaders['content-range'] = upstreamRes.headers['content-range'];
        }
        if (upstreamRes.headers?.['content-length']) {
          responseHeaders['content-length'] = upstreamRes.headers['content-length'];
        }
        const outgoingStatusCode = incomingMethod === 'HEAD' && statusCode === 206 ? 200 : statusCode;
        console.log(`[PROXY][RES][NODE] Status: ${statusCode}`);
        console.log(`  Content-Type: ${responseHeaders['content-type']}`);
        console.log(`  Content-Length: ${responseHeaders['content-length']}`);
        if (responseHeaders['content-range']) console.log(`  Content-Range: ${responseHeaders['content-range']}`);

        res.writeHead(outgoingStatusCode, responseHeaders);
        if (incomingMethod === 'HEAD') {
          upstreamRes.resume();
          res.removeListener('close', onClientDisconnect);
          res.end();
          return;
        }

        upstreamRes.on('error', (error) => {
          if (!isClientDisconnected) {
            console.error('Proxy upstream response stream error:', error);
          }
          if (!res.writableEnded) {
            try { res.destroy(error); } catch { }
          }
        });
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.setTimeout(upstreamTimeoutMs, () => upstreamReq.destroy(Object.assign(new Error('Proxy upstream timeout'), { code: 'ETIMEDOUT' })));
    upstreamReq.on('error', (error) => {
      if (isClientDisconnected || res.destroyed) {
        return;
      }

      const errorCode = String(error?.code || '');
      const errorMessage = String(error?.message || '');
      const isSocketReset = errorCode === 'ECONNRESET' || /socket hang up/i.test(errorMessage);
      const isTimeout = errorCode === 'ETIMEDOUT' || /timed out/i.test(errorMessage);
      const canRetry =
        retryCount < MAX_RETRIES &&
        redirectCount < 6 &&
        !res.headersSent &&
        !res.writableEnded &&
        !res.destroyed &&
        ['GET', 'HEAD'].includes(incomingMethod) &&
        !isPixelDrainTarget &&
        isResilientMediaTarget &&
        (isSocketReset || isTimeout);

      console.error('Proxy upstream error:', error);

      if (canRetry) {
        // ECONNRESET means we tried to reuse a dead keepAlive socket.  Retry
        // with agent:false so Node opens a brand-new TCP connection rather than
        // pulling another potentially-dead socket from the pool.
        //
        // If the disconnect happened very recently (< 200 ms ago) the server's
        // own TCP FIN sequence may not have completed yet, which causes the
        // immediate retry to hit ECONNRESET again.  Wait 300 ms in that case;
        // otherwise 50 ms is enough since we're on a fresh socket.
        const msSinceDisconnect = clientDisconnectedAt ? Date.now() - clientDisconnectedAt : 999;
        const delayMs = isSocketReset
          ? (msSinceDisconnect < 200 ? 300 : (retryCount === 0 ? 0 : 50))
          : BASE_DELAY * (retryCount + 1);
        const retryOptions = isSocketReset
          ? { ...options, agent: false }  // fresh TCP connection, no pool reuse
          : options;
        if (delayMs > 0) {
          console.warn(`Retrying upstream request (${retryCount + 1}/${MAX_RETRIES}) in ${delayMs}ms for ${targetUrl.toString()}`);
        }
        setTimeout(() => {
          res.removeListener('close', onClientDisconnect);
          streamFromUpstream(targetUrl, retryOptions, res, redirectCount, fileId, retryCount + 1);
        }, delayMs);
        return;
      }

      if (!res.headersSent) res.writeHead(isTimeout ? 504 : 502, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      if (!res.writableEnded) {
        res.removeListener('close', onClientDisconnect);
        res.end(isTimeout ? 'Upstream timeout' : 'Upstream error');
      }
    });
    // Track the request so preemptive abort (startPixelDrainStream) can kill it
    if (res._pixelDrainEntry) {
      res._pixelDrainEntry.upstreamReq = upstreamReq;
    }
    upstreamReq.end();
  }

  mediaProxyServer = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');

      if (reqUrl.pathname === '/local-audio.wav') {
        const file = reqUrl.searchParams.get('file') || '';
        const duration = parseFloat(reqUrl.searchParams.get('duration') || '0');
        const aindex = reqUrl.searchParams.get('aindex') || '1';

        if (!file || duration <= 0) {
          res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('Missing file or duration');
          return;
        }

        const sampleRate = 48000; // 48kHz — standard for video content
        const numChannels = 2;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8); // 176400
        const dataSize = Math.floor(duration * byteRate);
        const alignedDataSize = dataSize % 2 === 0 ? dataSize : dataSize + 1; // Align to 16-bit boundaries
        const totalFileSize = 44 + alignedDataSize;

        let startByte = 0;
        let endByte = totalFileSize - 1;
        let isPartial = false;

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, "").split("-");
          startByte = parseInt(parts[0], 10) || 0;
          endByte = parts[1] ? parseInt(parts[1], 10) : totalFileSize - 1;
          isPartial = true;
        }

        const chunksize = (endByte - startByte) + 1;
        const headers = {
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'audio/wav',
          'Access-Control-Allow-Origin': '*'
        };

        if (isPartial) {
          headers['Content-Range'] = `bytes ${startByte}-${endByte}/${totalFileSize}`;
          res.writeHead(206, headers);
        } else {
          res.writeHead(200, headers);
        }

        if (req.method === 'HEAD') {
          res.end();
          return;
        }

        const audioStartByte = Math.max(0, startByte - 44);
        const startTimeSeconds = audioStartByte / byteRate;

        if (startByte < 44) {
          const buffer = Buffer.alloc(44);
          buffer.write('RIFF', 0);
          buffer.writeUInt32LE(36 + alignedDataSize, 4);
          buffer.write('WAVE', 8);
          buffer.write('fmt ', 12);
          buffer.writeUInt32LE(16, 16);
          buffer.writeUInt16LE(1, 20);
          buffer.writeUInt16LE(numChannels, 22);
          buffer.writeUInt32LE(sampleRate, 24);
          buffer.writeUInt32LE(byteRate, 28);
          buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
          buffer.writeUInt16LE(bitsPerSample, 34);
          buffer.write('data', 36);
          buffer.writeUInt32LE(alignedDataSize, 40);
          res.write(buffer.slice(startByte));
        }

        const args = [
          '-ss', String(startTimeSeconds),
          '-i', file,
          '-map', `0:${aindex}`,
          '-c:a', 'pcm_s16le',
          '-ar', String(sampleRate),
          '-ac', String(numChannels),
          '-f', 's16le',
          '-threads', '0',
          'pipe:1'
        ];

        const ffmpegPath = getFfmpegPath();
        const child = require('child_process').spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });

        let bytesWritten = 0;
        const maxAudioBytes = chunksize - (startByte < 44 ? 44 - startByte : 0);

        child.stdout.on('data', (chunk) => {
          if (bytesWritten >= maxAudioBytes) return;
          const remaining = maxAudioBytes - bytesWritten;
          const toWrite = chunk.length > remaining ? chunk.slice(0, remaining) : chunk;

          const canContinue = res.write(toWrite);
          bytesWritten += toWrite.length;

          if (bytesWritten >= maxAudioBytes) {
            try { child.kill('SIGKILL'); } catch { }
            res.end();
          } else if (!canContinue) {
            child.stdout.pause();
            res.once('drain', () => child.stdout.resume());
          }
        });

        child.on('close', () => {
          if (!res.writableEnded) res.end();
        });

        req.on('close', () => {
          try { child.kill('SIGKILL'); } catch { }
        });

        return;
      }

      if (reqUrl.pathname === '/hls-load') {
        const sourceUrl = String(reqUrl.searchParams.get('url') || '').trim();
        if (!sourceUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Missing url' }));
          return;
        }

        hlsMseBackend.load(sourceUrl)
          .then((manifest) => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify(manifest));
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/manifest.json') {
        try {
          const manifest = hlsMseBackend.getManifest();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(manifest));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: error.message || String(error) }));
        }
        return;
      }

      if (reqUrl.pathname === '/init-video') {
        const trackId = String(reqUrl.searchParams.get('track') || '').trim();
        hlsMseBackend.getInitVideo(trackId)
          .then(({ body, headers }) => {
            res.writeHead(200, {
              'Content-Type': headers['content-type'] || 'video/mp4',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(body);
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/init-audio') {
        const trackId = String(reqUrl.searchParams.get('track') || '').trim();
        hlsMseBackend.getInitAudio(trackId)
          .then(({ body, headers }) => {
            res.writeHead(200, {
              'Content-Type': headers['content-type'] || 'audio/mp4',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(body);
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/segment-video') {
        const trackId = String(reqUrl.searchParams.get('track') || '').trim();
        const seq = Number(reqUrl.searchParams.get('seq') || '0');
        hlsMseBackend.getVideoSegment(trackId, seq)
          .then(({ meta, response }) => {
            res.writeHead(200, {
              'Content-Type': response.headers['content-type'] || 'video/mp4',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
              'X-Segment-Seq': String(meta.seq),
              'X-Segment-Start': String(meta.start),
              'X-Segment-Duration': String(meta.duration)
            });
            res.end(response.body);
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/segment-audio') {
        const trackId = String(reqUrl.searchParams.get('track') || '').trim();
        const seq = Number(reqUrl.searchParams.get('seq') || '0');
        hlsMseBackend.getAudioSegment(trackId, seq)
          .then(({ meta, response }) => {
            res.writeHead(200, {
              'Content-Type': response.headers['content-type'] || 'audio/mp4',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
              'X-Segment-Seq': String(meta.seq),
              'X-Segment-Start': String(meta.start),
              'X-Segment-Duration': String(meta.duration)
            });
            res.end(response.body);
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/subtitles') {
        const trackId = String(reqUrl.searchParams.get('track') || '').trim();
        hlsMseBackend.getMergedSubtitles(trackId)
          .then((text) => {
            res.writeHead(200, {
              'Content-Type': 'text/vtt; charset=utf-8',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*'
            });
            res.end(text);
          })
          .catch((error) => {
            res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: error.message || String(error) }));
          });
        return;
      }

      if (reqUrl.pathname === '/local-media') {
        const rawPath = reqUrl.searchParams.get('path');
        if (!rawPath) {
          res.writeHead(400);
          res.end('Missing path');
          return;
        }

        const absolutePath = path.resolve(rawPath);
        if (!fs.existsSync(absolutePath)) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }

        const stats = fs.statSync(absolutePath);
        const contentType = getMediaContentType(absolutePath);

        if (absolutePath.toLowerCase().endsWith('.m3u8') || absolutePath.toLowerCase().endsWith('.m3u')) {
          const raw = fs.readFileSync(absolutePath, 'utf8');
          const directEntry = parseSingleEntryMediaPlaylist(raw, absolutePath);
          if (directEntry?.url) {
            res.writeHead(302, {
              Location: directEntry.url,
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store'
            });
            res.end();
            return;
          }

          const rewritten = rewriteM3u8ForLocalServer(raw, absolutePath);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(rewritten);
          return;
        }

        const range = req.headers.range;
        if (range) {
          const match = /bytes=(\d*)-(\d*)/.exec(range);
          const start = match && match[1] ? Number(match[1]) : 0;
          const end = match && match[2] ? Number(match[2]) : stats.size - 1;
          const safeEnd = Math.min(end, stats.size - 1);

          if (Number.isNaN(start) || Number.isNaN(safeEnd) || start > safeEnd) {
            res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
            res.end();
            return;
          }

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${safeEnd}/${stats.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': safeEnd - start + 1,
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
          });
          fs.createReadStream(absolutePath, { start, end: safeEnd }).pipe(res);
          return;
        }

        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(absolutePath).pipe(res);
        return;
      }

      if (reqUrl.pathname === '/pixeldrain-stream') {
        const fileId = String(reqUrl.searchParams.get('fileId') || '').trim();
        const requestedVariant = String(reqUrl.searchParams.get('variant') || 'filesystem').trim();
        const variant = normalizePixelDrainLocalVariant(requestedVariant);
        const seekNonce = String(reqUrl.searchParams.get('aether_seek') || '').trim();
        if (!fileId) {
          res.writeHead(400);
          res.end('Missing fileId');
          return;
        }

        if (pixeldrainModule.pixelDrainBackoffUntil > Date.now()) {
          res.writeHead(503, {
            'Retry-After': String(Math.ceil((pixeldrainModule.pixelDrainBackoffUntil - Date.now()) / 1000)),
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          });
          res.end('Service Unavailable (rate limited)');
          return;
        }

        if (requestedVariant !== variant) {
          console.log(`PixelDrain local variant normalized: ${requestedVariant} -> ${variant} for file ${fileId}`);
        }
        const targetUrl = new URL(getPixelDrainVariantUrl(fileId, variant));
        if (seekNonce) {
          targetUrl.searchParams.set('_aether_seek', seekNonce);
        }

        const headers = buildPixelDrainHeaders({
          fileId,
          targetUrl: targetUrl.toString(),
          accept: req.headers.accept || 'video/*,*/*;q=0.8',
          range: req.headers.range || '',
          existingHeaders: {
            Connection: 'keep-alive'
          }
        });

        startPixelDrainStream(
          targetUrl,
          {
            headers,
            method: req.method || 'GET'
          },
          res,
          fileId,
          streamFromUpstream
        );
        return;
      }

      if (reqUrl.pathname === '/youtube-dash.mpd') {
        const qualityId = reqUrl.searchParams.get('quality') || '';
        if (!youtubeSession) {
          res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('No active session');
          return;
        }

        const videoFormat = youtubeSession.qualityMap[qualityId] || youtubeSession.selected || youtubeSession.qualities[0];
        let audioFormat = youtubeSession.audioFormat;
        const isMuxedVideo = videoFormat && videoFormat.audioCodec && videoFormat.audioCodec !== 'none';

        if (isMuxedVideo) {
          // If the video format already contains audio (muxed), don't inject a duplicate separate audio track
          audioFormat = null;
        }

        if (!videoFormat) {
          res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('Video format not found');
          return;
        }

        // Extract ranges on-the-fly if not already resolved
        if (!videoFormat.initRange || !videoFormat.indexRange) {
          const isWebm = videoFormat.ext === 'webm' || (videoFormat.codec || '').toLowerCase().includes('vp9') || (videoFormat.codec || '').toLowerCase().includes('av01');
          const ranges = await extractFormatRanges(videoFormat.url, isWebm, videoFormat.proxyHeaders);
          if (ranges) {
            videoFormat.initRange = ranges.initRange;
            videoFormat.indexRange = ranges.indexRange;
          }
        }

        if (audioFormat && (!audioFormat.initRange || !audioFormat.indexRange)) {
          const ranges = await extractFormatRanges(audioFormat.url, audioFormat.ext === 'webm', audioFormat.proxyHeaders || videoFormat.proxyHeaders);
          if (ranges) {
            audioFormat.initRange = ranges.initRange;
            audioFormat.indexRange = ranges.indexRange;
          }
        }

        if (!videoFormat.initRange || !videoFormat.indexRange || (audioFormat && (!audioFormat.initRange || !audioFormat.indexRange))) {
          res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
          res.end('Failed to resolve init/index ranges for streaming');
          return;
        }

        const mpd = generateYoutubeDashMpd(videoFormat, audioFormat, youtubeSession.duration || 0);
        res.writeHead(200, {
          'Content-Type': 'application/dash+xml',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(mpd);
        return;
      }

      if (!reqUrl.pathname.startsWith('/proxy')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const target = reqUrl.searchParams.get('url');
      if (!target) {
        res.writeHead(400);
        res.end('Missing url');
        return;
      }

      const targetUrl = new URL(target);
      if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
        res.writeHead(400);
        res.end('Only http/https is supported');
        return;
      }

      const targetHost = targetUrl.hostname.toLowerCase();
      const isPixelDrainTarget = isPixeldrainHost(targetHost);
      const isDriveTarget = isDriveMediaHost(targetHost);
      const requestId = reqUrl.searchParams.get('rid');
      const storedHeaders = getStoredProxyHeaders(requestId);
      const lowerTargetPath = targetUrl.pathname.toLowerCase();
      const isManifestTarget = lowerTargetPath.endsWith('.mpd') || lowerTargetPath.endsWith('.m3u8');
      const isDirectBinaryMediaTarget = isDirectBinaryMediaPath(lowerTargetPath) || isDriveTarget || isPixelDrainTarget || (!!req.headers.range && !isManifestTarget);
      const isGenericManifestOrMedia =
        lowerTargetPath.endsWith('.mpd') ||
        lowerTargetPath.endsWith('.m3u8') ||
        /\.(m4s|mp4|ts|aac|webm|m4a|mkv)(?:\/)?(\?|$)/i.test(lowerTargetPath) ||
        (!!requestId && !!storedHeaders) ||
        isDriveTarget ||
        isPixelDrainTarget;

      if (
        !isPixelDrainTarget &&
        !isDriveTarget &&
        !storedHeaders &&
        !isGenericManifestOrMedia
      ) {
        res.writeHead(302, { Location: targetUrl.toString() });
        res.end();
        return;
      }

      // Start with all original headers, filtered
      let requestHeaders = filterHopByHop(req.headers);

      // Remove headers that might interfere
      delete requestHeaders.host;

      // Override or add necessary headers for each target type
      if (isPixelDrainTarget) {
        const pixelDrainFileId = getPixelDrainFileId(targetUrl.toString());
        requestHeaders = buildPixelDrainHeaders({
          fileId: pixelDrainFileId,
          targetUrl: targetUrl.toString(),
          accept: requestHeaders.accept || requestHeaders.Accept || '',
          range: req.headers.range || requestHeaders.range || requestHeaders.Range || '',
          existingHeaders: requestHeaders
        });
      }

      if (isDriveTarget) {
        requestHeaders.origin = 'https://drive.google.com';
        requestHeaders.referer = 'https://drive.google.com/';
      }

      if (storedHeaders) Object.assign(requestHeaders, storedHeaders);

      // CRITICAL: Re-apply the browser's Range header AFTER stored headers
      // to prevent Playwright-captured range from overwriting seek requests
      if (req.headers.range) {
        requestHeaders.range = req.headers.range;
      }

      if (isGenericManifestOrMedia) {
        if (!requestHeaders['user-agent']) requestHeaders['user-agent'] = DESKTOP_USER_AGENT;
        if (!requestHeaders['accept-language']) requestHeaders['accept-language'] = 'en-US,en;q=0.9';
        if (!requestHeaders.accept) {
          requestHeaders.accept = isDirectBinaryMediaTarget
            ? 'video/webm,video/ogg,video/mp4,application/octet-stream;q=0.9,*/*;q=0.5'
            : 'application/dash+xml,application/vnd.apple.mpegurl,application/x-mpegurl,text/plain,*/*;q=0.8';
        }
        requestHeaders['accept-encoding'] = 'identity';
        if (!requestHeaders['cache-control']) requestHeaders['cache-control'] = 'no-cache, no-store, max-age=0, no-transform';
        if (!requestHeaders.pragma) requestHeaders.pragma = 'no-cache';
        const isSegmentFetch = isGenericManifestOrMedia && !isManifestTarget && !!requestId;
        if (!requestHeaders['sec-fetch-dest']) requestHeaders['sec-fetch-dest'] = (isManifestTarget || isSegmentFetch) ? 'empty' : 'video';
        if (!requestHeaders['sec-fetch-mode']) requestHeaders['sec-fetch-mode'] = (isDirectBinaryMediaTarget && !isSegmentFetch) ? 'no-cors' : 'cors';
        if (!requestHeaders['sec-fetch-site']) requestHeaders['sec-fetch-site'] = 'cross-site';
        if (isDirectBinaryMediaTarget) {
          requestHeaders['accept-ranges'] = 'bytes';
        }
      }

      const forwardRequest = () => {
        const forwardOptions = {
          headers: requestHeaders,
          method: req.method || 'GET'
        };
        // Always use Electron fetch for generic manifests and media to share cookies
        // Hybrid proxy: Use Node-native stream for binary media (more reliable seeking)
        // while keeping Electron's Chromium-backed fetch for manifests.
        if (isGenericManifestOrMedia && !isPixelDrainTarget) {
          if (isDirectBinaryMediaTarget || (requestId && storedHeaders && !isManifestTarget)) {
            // Use Node native stream for binary media and disguised segments (.jpg etc)
            streamFromUpstream(targetUrl, forwardOptions, res);
          } else {
            streamFromElectronFetch(targetUrl, forwardOptions, res);
          }
          return;
        }
        streamFromUpstream(targetUrl, forwardOptions, res);
      };

      if (isPixelDrainTarget) {
        const pixelDrainFileId = getPixelDrainFileId(targetUrl.toString());
        startPixelDrainStream(
          targetUrl,
          {
            headers: requestHeaders,
            method: req.method || 'GET'
          },
          res,
          pixelDrainFileId,
          streamFromUpstream
        );
        return;
      }
      // For DASH/HLS manifests, we need to intercept and rewrite
      // We'll do this by buffering the response if it's a manifest
      const shouldRewriteManifest =
        lowerTargetPath.endsWith('.mpd') ||
        lowerTargetPath.endsWith('.m3u8') ||
        (lowerTargetPath.includes('/manifest') && (lowerTargetPath.includes('.mpd') || lowerTargetPath.includes('.m3u8')));

      if (shouldRewriteManifest) {
        const fetchAndRewriteManifest = async (manifestUrl, redirectCount = 0, requestOverride = null) => {
          const abortController = new AbortController();
          const manifestTimeout = setTimeout(
            () => abortController.abort(new Error('Manifest upstream timeout')),
            45000
          );
          let {
            requestHeaders: manifestRequestHeaders,
            fetchReferrer: manifestFetchReferrer,
            isCrossOriginReferer: manifestCrossOriginReferer
          } = prepareElectronFetchRequest(manifestUrl, requestOverride || { headers: requestHeaders, method: 'GET' });

          try {
            await syncCookiesToElectronSession(
              manifestUrl.toString(),
              getHeaderCaseInsensitive(requestOverride?.headers || requestHeaders, 'cookie') || ''
            );

            const manifestFetchOpts = {
              method: 'GET',
              headers: manifestRequestHeaders,
              credentials: 'include',
              useSessionCookies: true,
              redirect: 'manual',
              signal: abortController.signal,
              bypassCustomProtocolHandlers: true
            };
            if (manifestFetchReferrer && !manifestCrossOriginReferer) {
              manifestFetchOpts.referrer = manifestFetchReferrer;
              manifestFetchOpts.referrerPolicy = 'no-referrer-when-downgrade';
            }
            const manifestResponse = await session.defaultSession.fetch(manifestUrl.toString(), manifestFetchOpts);
            clearTimeout(manifestTimeout);

            const statusCode = manifestResponse.status || 500;
            const location = manifestResponse.headers.get('location');

            if (location && [301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 6) {
              let nextUrl;
              try {
                nextUrl = new URL(location, manifestUrl);
              } catch {
                streamFromElectronFetch(targetUrl, { headers: requestHeaders, method: 'GET' }, res);
                return;
              }
              console.log(`Proxy upstream redirect (${statusCode}): ${manifestUrl.toString()} -> ${nextUrl.toString()}`);
              await manifestResponse.body?.cancel?.().catch(() => { });
              return fetchAndRewriteManifest(nextUrl, redirectCount + 1);
            }

            const contentType = String(manifestResponse.headers.get('content-type') || '');
            const loweredContentType = contentType.toLowerCase();
            const manifestPath = manifestUrl.pathname.toLowerCase();
            const looksLikeManifest =
              manifestPath.endsWith('.mpd') ||
              manifestPath.endsWith('.m3u8') ||
              loweredContentType.includes('dash+xml') ||
              loweredContentType.includes('mpegurl') ||
              loweredContentType.includes('application/vnd.apple.mpegurl') ||
              loweredContentType.includes('application/x-mpegurl') ||
              loweredContentType.includes('application/xml') ||
              loweredContentType.includes('text/xml');

            if (statusCode < 200 || statusCode >= 300 || !looksLikeManifest) {
              await manifestResponse.body?.cancel?.().catch(() => { });
              streamFromElectronFetch(targetUrl, { headers: requestHeaders, method: 'GET' }, res);
              return;
            }

            const body = await manifestResponse.text();
            const requestId = reqUrl.searchParams.get('rid') || storeProxyHeaders(requestHeaders);
            const isHlsManifest = loweredContentType.includes('mpegurl') || manifestPath.endsWith('.m3u8');

            if (isHlsManifest) {
              const directEntry = parseSingleEntryRemotePlaylist(body, manifestUrl.toString());
              if (directEntry?.url) {
                res.writeHead(302, {
                  Location: directEntry.url,
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-store'
                });
                res.end();
                return;
              }
            }

            const rewritten = isHlsManifest
              ? rewriteHlsManifest(body, manifestUrl.toString(), mediaProxyBaseUrl, requestId)
              : rewriteDashManifest(body, manifestUrl.toString(), mediaProxyBaseUrl, requestId);

            res.writeHead(200, {
              'Content-Type': contentType || (isHlsManifest ? 'application/vnd.apple.mpegurl' : 'application/dash+xml'),
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'no-store',
              'Accept-Ranges': 'bytes'
            });
            res.end(rewritten);
          } catch (error) {
            clearTimeout(manifestTimeout);
            const manifestErrorMessage = String(error?.message || '');
            const isChromiumValidationFailure = /ERR_BLOCKED_BY_CLIENT|ERR_FAILED|ERR_INVALID_ARGUMENT|invalid referrer|invalid referrer policy/i.test(manifestErrorMessage);
            const isUrlValidationError = /ERR_INVALID_ARGUMENT/i.test(manifestErrorMessage);
            // URL validation errors can't be fixed by stripping referrer – fall back to Node
            if (isUrlValidationError) {
              console.warn(`[PROXY] Chromium ERR_INVALID_ARGUMENT on manifest – falling back to Node upstream for ${manifestUrl.toString()}`);
              streamFromUpstream(targetUrl, { headers: requestHeaders, method: 'GET' }, res);
              return;
            }
            if (isChromiumValidationFailure && manifestFetchReferrer) {
              console.warn(`Retrying manifest fetch without referrer for ${manifestUrl.toString()}`);
              const retryOverride = {
                headers: { ...(requestHeaders || {}) },
                method: 'GET'
              };
              stripHeaderCaseInsensitive(retryOverride.headers, 'referer');
              stripHeaderCaseInsensitive(retryOverride.headers, 'origin');
              return fetchAndRewriteManifest(manifestUrl, redirectCount, retryOverride);
            }
            streamFromElectronFetch(targetUrl, { headers: requestHeaders, method: 'GET' }, res);
          }
        };

        fetchAndRewriteManifest(targetUrl);
        return;
      }

      forwardRequest();
    } catch (error) {
      console.error('Proxy request error:', error);
      res.writeHead(500);
      res.end('Proxy error');
    }
  });

  const port = await listenOnSafeLocalPort(mediaProxyServer, '127.0.0.1');
  mediaServerOrigin = `http://127.0.0.1:${port}`;
  mediaProxyBaseUrl = `${mediaServerOrigin}/proxy?url=`;
  console.log('Media proxy started at:', mediaProxyBaseUrl);
  return mediaProxyBaseUrl;
};

const proxifyMediaUrl = (rawUrl, proxyHeaders) => {
  if (!mediaProxyBaseUrl) return rawUrl;
  const rid = storeProxyHeaders(proxyHeaders);
  if (!rid) return `${mediaProxyBaseUrl}${encodeURIComponent(rawUrl)}`;
  return `${mediaProxyBaseUrl}${encodeURIComponent(rawUrl)}&rid=${encodeURIComponent(rid)}`;
};



const shouldProxyMediaUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || ''));
    const host = parsed.hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost') {
      return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    const isManifest = pathname.endsWith('.mpd') || pathname.endsWith('.m3u8');

    return (
      isManifest ||
      isPixeldrainHost(host) ||
      isDriveMediaHost(host)
    );
  } catch {
    return false;
  }
};

const maybeProxifyUrl = (rawUrl, proxyHeaders) => {
  if (!rawUrl) return rawUrl;

  const pixelDrainLocalUrl = resolvePixelDrainPlaybackUrlForRenderer(rawUrl);
  if (pixelDrainLocalUrl) return pixelDrainLocalUrl;

  try {
    const parsed = new URL(String(rawUrl));
    const host = parsed.hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost') {
      return parsed.toString();
    }
    if (host.endsWith('.googlevideo.com') || host === 'googlevideo.com') {
      return parsed.toString();
    }
    const pathname = parsed.pathname.toLowerCase();

    if (shouldBypassProxyForDirectMediaHost(host) && isDirectBinaryMediaPath(pathname)) {
      return parsed.toString();
    }
  } catch {
    // fall through to normal proxy logic
  }


  // If it's Pixeldrain, we always prefer direct playback because our 
  // onBeforeSendHeaders injector handles Referer/User-Agent automatically.
  if (isPixeldrainRequest(rawUrl)) {
    return rawUrl;
  }

  const hasExplicitProxyHeaders = !!(proxyHeaders && Object.keys(proxyHeaders).length > 0);

  // IPTV streams (.m3u8/.m3u) without custom auth headers should NOT be proxied.
  // They must go directly to hls.js in the renderer so that Chromium's
  // onBeforeSendHeaders hook can apply User-Agent spoofing (the Node.js proxy
  // bypasses Chromium's network stack entirely, so UA spoofing doesn't apply there).
  if (!hasExplicitProxyHeaders) {
    try {
      const pathname = new URL(String(rawUrl)).pathname.toLowerCase();
      if (pathname.endsWith('.m3u8') || pathname.endsWith('.m3u')) {
        return rawUrl;
      }
    } catch { }
  }

  return (hasExplicitProxyHeaders || shouldProxyMediaUrl(rawUrl))
    ? proxifyMediaUrl(rawUrl, proxyHeaders)
    : rawUrl;
};

const maybeProxifyPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    url: maybeProxifyUrl(payload.url, payload.proxyHeaders),
    audioUrl: maybeProxifyUrl(payload.audioUrl, payload.audioProxyHeaders || payload.proxyHeaders)
  };
};

// Wire late-bound dependencies into the Google Videos module
googleVideosModule.setDeps({ maybeProxifyUrl, buildOnlineStreamPayload });


const isLikelyThumbnailUrl = (url) => {
  const lower = String(url || '').toLowerCase();
  return (
    lower.includes('thumb') ||
    lower.includes('thumbnail') ||
    lower.includes('sprite') ||
    lower.includes('preview') ||
    lower.includes('seek') ||
    lower.includes('/thumbs/') ||
    lower.endsWith('thumbs.vtt') ||
    lower.includes('tile') ||
    lower.includes('storyboard')
  );
};

const extractLanguageFromUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const haystack = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    const matches = [
      haystack.match(/(?:^|[\/_\-.])(en|eng|english)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(es|spa|spanish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(fr|fra|fre|french)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(de|ger|deu|german)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(it|ita|italian)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(pt|por|pt-br|ptbr|portuguese)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(br|brazilian)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(ja|jpn|jp|japanese)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(ko|kor|kr|korean)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(zh|chi|zho|cn|chs|cht|chinese)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(ru|rus|russian)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(ar|ara|arabic)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(hi|hin|hindi)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(tr|tur|turkish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(pl|pol|polish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(nl|dut|nld|dutch)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(sv|swe|swedish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(da|dan|danish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(fi|fin|finnish)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(no|nor|norwegian)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(cs|cze|ces|czech)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(el|gre|ell|greek)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(he|heb|hebrew)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(th|tha|thai)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(vi|vie|vietnamese)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(id|ind|indonesian)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])(ms|may|msa|malay)(?:$|[\/_\-.])/i),
      haystack.match(/(?:^|[\/_\-.])([a-z]{2})(?:$|[\/_\-.])/i)
    ].find(Boolean);

    if (!matches || !matches[1]) return null;
    const value = String(matches[1]).toLowerCase();
    const map = {
      eng: 'en', english: 'en', spa: 'es', spanish: 'es', fra: 'fr', fre: 'fr', french: 'fr',
      ger: 'de', deu: 'de', german: 'de', ita: 'it', italian: 'it', por: 'pt', portuguese: 'pt',
      brazilian: 'pt-br', ptbr: 'pt-br', jpn: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko',
      chi: 'zh', zho: 'zh', chinese: 'zh', chs: 'zh-cn', cht: 'zh-tw', rus: 'ru', russian: 'ru',
      ara: 'ar', arabic: 'ar', hin: 'hi', hindi: 'hi', tur: 'tr', turkish: 'tr', pol: 'pl', polish: 'pl',
      dut: 'nl', nld: 'nl', dutch: 'nl', swe: 'sv', swedish: 'sv', dan: 'da', danish: 'da',
      fin: 'fi', finnish: 'fi', nor: 'no', norwegian: 'no', cze: 'cs', ces: 'cs', czech: 'cs',
      gre: 'el', ell: 'el', greek: 'el', heb: 'he', hebrew: 'he', tha: 'th', thai: 'th',
      vie: 'vi', vietnamese: 'vi', ind: 'id', indonesian: 'id', may: 'ms', msa: 'ms', malay: 'ms',
      br: 'pt-br', jp: 'ja', kr: 'ko', cn: 'zh-cn'
    };
    return map[value] || value;
  } catch {
    return null;
  }
};

const getReadableLanguageName = (language) => {
  const value = String(language || '').trim().toLowerCase();
  const map = {
    en: 'English',
    ja: 'Japanese',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    'pt-br': 'Portuguese (BR)',
    ko: 'Korean',
    zh: 'Chinese',
    'zh-cn': 'Chinese (Simplified)',
    'zh-tw': 'Chinese (Traditional)',
    ru: 'Russian',
    ar: 'Arabic',
    hi: 'Hindi',
    tr: 'Turkish'
  };
  return map[value] || (value ? value.toUpperCase() : 'Unknown');
};

const extractLanguageFromLabel = (rawLabel) => {
  const value = String(rawLabel || '').trim().toLowerCase();
  if (!value) return null;

  const patterns = [
    [/\benglish\b|\beng\b|\ben\b/i, 'en'],
    [/\bjapanese\b|\bjpn\b|\bja\b|\bjp\b/i, 'ja'],
    [/\bspanish\b|\bspa\b|\bes\b/i, 'es'],
    [/\bfrench\b|\bfra\b|\bfre\b|\bfr\b/i, 'fr'],
    [/\bgerman\b|\bger\b|\bdeu\b|\bde\b/i, 'de'],
    [/\bitalian\b|\bita\b|\bit\b/i, 'it'],
    [/\bportuguese\b|\bpor\b|\bpt\b/i, 'pt'],
    [/\bportuguese\s*\(br\)|\bbrazilian\b|\bpt-br\b|\bptbr\b/i, 'pt-br'],
    [/\bkorean\b|\bkor\b|\bko\b|\bkr\b/i, 'ko'],
    [/\bchinese\b|\bzho\b|\bchi\b|\bzh\b|\bcn\b/i, 'zh'],
    [/\brussian\b|\brus\b|\bru\b/i, 'ru'],
    [/\barabic\b|\bara\b|\bar\b/i, 'ar'],
    [/\bhindi\b|\bhin\b|\bhi\b/i, 'hi'],
    [/\bturkish\b|\btur\b|\btr\b/i, 'tr']
  ];

  const matched = patterns.find(([pattern]) => pattern.test(value));
  return matched ? matched[1] : null;
};

const getSubtitleFormatFromUrl = (rawUrl) => {
  const matched = String(rawUrl || '').match(/\.([a-z0-9]+)(?:$|\?)/i);
  const ext = String(matched?.[1] || '').toLowerCase();
  if (['vtt', 'srt', 'ass', 'ssa'].includes(ext)) return ext.toUpperCase();
  return 'SUB';
};

const buildCapturedSubtitleDescriptor = ({
  url,
  language,
  label,
  kind,
  isDefault = false
}) => {
  const confirmedLanguage =
    extractLanguageFromLabel(label) ||
    (String(language || '').trim() ? String(language || '').trim().toLowerCase() : null) ||
    extractLanguageFromUrl(url) ||
    null;

  return {
    url,
    language: confirmedLanguage,
    label: getReadableLanguageName(confirmedLanguage),
    format: getSubtitleFormatFromUrl(url),
    kind: kind || 'subtitles',
    isDefault: !!isDefault
  };
};


const isKnownPlayableStreamUrl = (rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const mimeType = String(parsed.searchParams.get('mime') || '').toLowerCase();

    if (
      host === '127.0.0.1' &&
      (pathname === '/proxy' || pathname === '/local-media' || pathname === '/pixeldrain-stream' || pathname === '/' || pathname === '/mega-stream')
    ) {
      return true;
    }
    if (isPixeldrainHost(host) && (pathname.startsWith('/api/file/') || pathname.startsWith('/api/filesystem/') || pathname.startsWith('/u/') || pathname.startsWith('/d/'))) return true;
    if (
      isDriveMediaHost(host) &&
      (pathname.includes('videoplayback') || pathname.startsWith('/uc') || pathname.startsWith('/download'))
    ) {
      return true;
    }
    // Generic fallback will handle other hosts

    return (
      /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m3u8|mpd)(?:\/)?$/i.test(pathname) ||
      mimeType.startsWith('video/') ||
      mimeType.includes('mpegurl') ||
      mimeType.includes('dash') ||
      mimeType.includes('mpd')
    );
  } catch {
    return false;
  }
};

const sanitizeMediaStreamPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const normalized = { ...payload };

  normalized.url = isKnownPlayableStreamUrl(normalized.url) ? normalized.url : '';
  if (!normalized.url) return null;

  if (normalized.audioUrl && !isKnownPlayableStreamUrl(normalized.audioUrl)) {
    normalized.audioUrl = null;
  }

  normalized.retryUrls = Array.isArray(normalized.retryUrls)
    ? normalized.retryUrls.filter((candidate) => isKnownPlayableStreamUrl(candidate) && candidate !== normalized.url)
    : [];

  if (normalized.fallbackUrl && !isKnownPlayableStreamUrl(normalized.fallbackUrl)) {
    normalized.fallbackUrl = null;
  }

  return normalized;
};

const toIpcSerializable = (value, seen = new WeakSet()) => {
  if (value == null) return value;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'bigint') {
    return String(value);
  }

  if (valueType === 'function' || valueType === 'symbol' || valueType === 'undefined') {
    return undefined;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => toIpcSerializable(entry, seen))
      .filter((entry) => entry !== undefined);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (valueType === 'object') {
    if (seen.has(value)) return undefined;
    seen.add(value);

    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const serialized = toIpcSerializable(entry, seen);
      if (serialized !== undefined) {
        result[key] = serialized;
      }
    }
    return result;
  }

  return undefined;
};

const sendMediaReady = (event, payload) => {
  const normalized = sanitizeMediaStreamPayload(payload);
  if (!normalized?.url) {
    event.reply('stream-error', {
      message: 'No playable media stream could be resolved for this URL.'
    });
    return;
  }

  const finalSubtitles = Array.isArray(payload?.subtitles)
    ? payload.subtitles
      .filter((sub) => sub && typeof sub.url === 'string' && sub.url.trim())
      .map((sub) => ({
        ...sub,
        url: maybeProxifyUrl(sub.url, sub?.proxyHeaders || payload?.proxyHeaders || null)
      }))
    : [];

  const resolvedDefaultSubtitleUrl = (() => {
    const requestedDefault = String(payload?.defaultSubtitleUrl || '').trim();
    if (!requestedDefault) return null;
    const matched = finalSubtitles.find((sub) => String(sub.url || '').trim() === maybeProxifyUrl(requestedDefault, sub?.proxyHeaders || payload?.proxyHeaders || null));
    if (matched?.url) return matched.url;
    const directMatch = finalSubtitles.find((sub) => String(sub.url || '').trim() === requestedDefault);
    return directMatch?.url || null;
  })();

  const finalPayload = toIpcSerializable({
    ...normalized,
    subtitles: finalSubtitles,
    defaultSubtitleUrl: resolvedDefaultSubtitleUrl,
    proxyConfig: payload?.proxyConfig || null,
    qualityHeaders: payload?.qualityHeaders || null,
    segmentHeaders: payload?.segmentHeaders || null,
    cookies: payload?.cookies || null,
    cookieString: payload?.cookieString || null,
    isStreamingManifest: !!payload?.isStreamingManifest,
    isHls: !!payload?.isHls,
    isDash: !!payload?.isDash,
    isLive: !!payload?.isLive,
    sourcePageUrl: payload?.sourcePageUrl || null,
    mediaOrigin: payload?.mediaOrigin || null,
    baseMediaUrl: payload?.baseMediaUrl || null,
    drmKeys: payload?.drmKeys || null
  });

  console.log('>>> PLAYING URL:', finalPayload.url);

  event.reply('media-stream-ready', finalPayload);
};

pixeldrainModule.setDeps({
  session,
  playwright,
  DESKTOP_USER_AGENT,
  getPlaywrightExecutablePath,
  startStealthHider,
  extractLanguageFromUrl,
  isLikelyThumbnailUrl,
  proxifyMediaUrl,
  buildOrderedRetryList,
  getMediaServerOrigin: () => mediaServerOrigin,
  mergeCookieStrings,
  normalizeCookieHeader,
  isDirectBinaryMediaPath,
  proxyHttpsAgent,
  proxyHttpAgent
});

// ── Direct provider instantiation (flattened architecture) ──
const megaProvider = createMegaProvider({
  http,
  https,
  DESKTOP_USER_AGENT,
  proxyHttpAgent,
  proxyHttpsAgent
});
console.log(`[providers] Loaded: ${megaProvider.id}`);

const genericCaptureHelpers = createGenericCaptureHelpers({
  playwright,
  playwrightExecutablePath: getPlaywrightExecutablePath(),
  session,
  DESKTOP_USER_AGENT,
  genericPlaywrightCache,
  parsePotentialJsonOutput,
  extractLanguageFromUrl,
  buildCapturedSubtitleDescriptor,
  isLikelyThumbnailUrl,
  isDirectBinaryMediaPath,
  providerRegistry: null,
  adBlockManager
});

const { fetchMainPlayableVideoUrl, abortActiveCapture } = genericCaptureHelpers;



function parseSubtitleTimecode(value) {
  const parts = String(value || '').replace(/\r\n/g, '\n').trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(parts[0] || 0);
}

function parseSubtitleTextToCues(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length > 0 && /^\d+$/.test(lines[0].trim())) {
      lines.shift();
    }

    const timingLine = lines.find((line) => line.includes('-->'));
    if (!timingLine) continue;

    const [startRaw, endRaw] = timingLine.split('-->');
    if (!startRaw || !endRaw) continue;

    const timingIndex = lines.indexOf(timingLine);
    const cueText = lines.slice(timingIndex + 1).join('\n').trim();
    if (!cueText) continue;

    cues.push({
      start: parseSubtitleTimecode(startRaw),
      end: parseSubtitleTimecode(endRaw),
      text: cueText
    });
  }

  return cues;
}

function mapDemuxTracksForRenderer(tracks) {
  const audioTracks = Array.isArray(tracks?.audio)
    ? tracks.audio.map((track) => ({
      index: Number(track.index),
      id: String(track.index),
      label: track.title || track.language || `Audio Track ${track.trackNumber || track.index}`
    }))
    : [];

  const subtitleTracks = Array.isArray(tracks?.subtitles)
    ? tracks.subtitles.map((track) => ({
      index: Number(track.index),
      id: String(track.index),
      label: track.title || track.language || `Subtitle ${track.trackNumber || track.index}`
    }))
    : [];

  return { audioTracks, subtitleTracks };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
      userAgent: DESKTOP_USER_AGENT
    }
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let url;
    try {
      url = new URL(details.url);
    } catch (e) {
      return callback({ requestHeaders: details.requestHeaders });
    }
    const host = url.hostname.toLowerCase();

    const isKnownPixeldrainHost = Array.from(pixeldrainMirrorRegistry).some(d =>
      host === d || host.endsWith('.' + d)
    );

    if (host.includes('pixeldrain') || isKnownPixeldrainHost) {
      const pixelDrainFileId = getPixelDrainFileId(details.url);
      console.log(`[PIXELDRAIN][HEADERS] Injecting for ${host} (fileId: ${pixelDrainFileId})`);
      details.requestHeaders = buildPixelDrainHeaders({
        fileId: pixelDrainFileId,
        targetUrl: details.url,
        accept: details.requestHeaders['Accept'] || details.requestHeaders['accept'] || '',
        range: details.requestHeaders['Range'] || details.requestHeaders['range'] || '',
        existingHeaders: details.requestHeaders,
        refererUrl: details.requestHeaders['Referer'] || details.requestHeaders['referer'] || '',
        originUrl: details.requestHeaders['Origin'] || details.requestHeaders['origin'] || 'https://pixeldrain.com'
      });

      // Ensure we track this host
      if (!isKnownPixeldrainHost && (host.includes('pixeldrain') || host.includes('pd.'))) {
        console.log(`[PIXELDRAIN][REGISTRY] Adding newly discovered host: ${host}`);
        pixeldrainMirrorRegistry.add(host);
      }
    }

    let XaetherReferer = null;
    let headerKeysToStrip = [];

    // Extract cross-origin referer
    for (const key of Object.keys(details.requestHeaders)) {
      if (key.toLowerCase() === 'x-aether-referer') {
        XaetherReferer = details.requestHeaders[key];
        headerKeysToStrip.push(key);
      }
    }

    for (const key of headerKeysToStrip) {
      delete details.requestHeaders[key];
    }

    if (XaetherReferer) {
      // Safely bypass Chromium network delegate validation for cross-origin referer
      details.requestHeaders['Referer'] = XaetherReferer;
      console.log(`[NETWORK-HOOK] Injected Referer: ${XaetherReferer} -> ${host}`);
    }

    // Aether User-Agent spoofing for IPTV streams to bypass provider whitelists/WAFs
    const isIptvRequest = url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts') || url.pathname.endsWith('.m3u') || host.includes('sflex');
    if (isIptvRequest) {
      let ua = details.requestHeaders['User-Agent'] || details.requestHeaders['user-agent'] || DESKTOP_USER_AGENT;
      ua = ua.replace(/Mozilla\/[^\s]+/, 'Aether').replace(/Chrome\/[^\s]+/, '').replace(/Safari\/[^\s]+/, '').trim().replace(/\s+/g, ' ');
      details.requestHeaders['User-Agent'] = ua;
      if (details.requestHeaders['user-agent']) delete details.requestHeaders['user-agent'];
    }

    callback({ requestHeaders: details.requestHeaders });
  });

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    if (
      isPixeldrainRequest(details.url) ||
      isDriveRequest(details.url)
    ) {
      stripUnsafeResponseHeaders(responseHeaders);
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    }

    // Inject CORS headers for direct IPTV stream requests so hls.js can fetch them
    try {
      const reqUrl = new URL(details.url);
      const lp = reqUrl.pathname.toLowerCase();
      if (lp.endsWith('.m3u8') || lp.endsWith('.m3u') || lp.endsWith('.ts')) {
        responseHeaders['Access-Control-Allow-Origin'] = ['*'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];
      }
    } catch { }

    callback({ responseHeaders });
  });

  const isDev = !app.isPackaged && (process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL);
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

  if (isDev) {
    win.loadURL(devServerUrl);
  } else {
    const distIndexPath = path.join(__dirname, '..', 'dist', 'index.html');
    const rootIndexPath = path.join(__dirname, '..', 'index.html');
    const fallbackRendererEntryPath = path.join(__dirname, '..', 'renderer', 'main.tsx');

    if (fs.existsSync(distIndexPath)) {
      win.loadFile(distIndexPath);
    } else if (fs.existsSync(rootIndexPath) && fs.existsSync(fallbackRendererEntryPath)) {
      console.warn('dist/index.html not found, falling back to root index.html for local testing');
      win.loadFile(rootIndexPath);
    } else {
      throw new Error(`Unable to find app entry. Expected ${distIndexPath} or ${rootIndexPath}`);
    }
  }

  win.webContents.on('did-finish-load', () => {
    if (mediaServerOrigin) {
      win.webContents.send('media-proxy-ready', mediaServerOrigin);
    }
  });

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('window-close', () => win.close());

  setupCustomPip(ipcMain, win);

  // ── Download Manager ──
  const activeDownloads = new Map();

  const formatBytes = (bytes) => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i] || 'B'}`;
  };

  ipcMain.handle('get-downloads-path', async () => {
    try {
      return app.getPath('downloads');
    } catch {
      return '';
    }
  });

  ipcMain.handle('pick-download-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(win, {
        title: 'Select Download Folder',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
      return result.filePaths[0] || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('dialog:openFile', async (_event, payload) => {
    try {
      const opts = {
        title: payload?.title || 'Open File',
        properties: ['openFile'],
        filters: payload?.filters || [{ name: 'All Files', extensions: ['*'] }],
      };
      const result = await dialog.showOpenDialog(win, opts);
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
      const selectedPath = result.filePaths[0];
      return { path: selectedPath, name: require('path').basename(selectedPath) };
    } catch {
      return null;
    }
  });

  ipcMain.handle('read-file-text', async (_event, filePath) => {
    try {
      const resolved = require('path').resolve(String(filePath || ''));
      if (!require('fs').existsSync(resolved)) return '';
      return require('fs').readFileSync(resolved, 'utf8');
    } catch {
      return '';
    }
  });

  ipcMain.on('start-download', async (event, payload) => {
    const downloadId = String(payload?.downloadId || `dl-${Date.now()}`);
    const rawUrl = String(payload?.url || '').trim();
    const fileName = String(payload?.fileName || 'download.mp4').replace(/[<>:"/\\|?*]+/g, '_');
    const savePath = String(payload?.savePath || '').trim() || app.getPath('downloads');
    const audioUrl = String(payload?.audioUrl || '').trim();
    const pageUrl = String(payload?.pageUrl || '').trim();
    const qualityLabel = String(payload?.qualityLabel || '');
    const isLive = !!payload?.isLive;
    const isAudioOnly = !!payload?.audioOnly;
    const audioCodec = String(payload?.audioCodec || 'opus');
    const audioQuality = String(payload?.audioQuality || 'best');
    if (!rawUrl) {
      event.reply('download-error', { downloadId, message: 'No URL provided' });
      return;
    }

    // Cancel if already running
    const existing = activeDownloads.get(downloadId);
    if (existing) {
      try { existing.abortController?.abort(); } catch { }
      try { existing.request?.destroy(); } catch { }
      try { existing.ytProcess?.kill(); } catch { }
      try { existing.writeStream?.destroy(); } catch { }
      activeDownloads.delete(downloadId);
    }

    let finalFileName = fileName;
    if (isLive) {
      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const ext = path.extname(fileName) || '.mp4';
      const base = path.basename(fileName, ext);
      finalFileName = `${base}_${timestamp}${ext}`;
    }

    const filePath = path.join(savePath, finalFileName);
    console.log(`[DOWNLOAD] Starting: ${downloadId} -> ${filePath} (Live: ${isLive})`);
    if (pageUrl) console.log(`[DOWNLOAD] Source: ${pageUrl}`);
    else console.log(`[DOWNLOAD] URL: ${rawUrl}`);

    // Ensure directory exists (check first to avoid EPERM on Windows root drives like E:\)
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (mkdirErr) {
      event.reply('download-error', { downloadId, message: `Cannot create directory: ${mkdirErr.message}` });
      return;
    }

    // Determine if we should use yt-dlp
    // We use it for YouTube, or if audioUrl is present (adaptive merging), or for manifest formats
    let resolvedUrl = rawUrl;
    try {
      if (rawUrl.startsWith('http://127.0.0.1') && rawUrl.includes('/proxy')) {
        const u = new URL(rawUrl);
        const upstream = u.searchParams.get('url');
        if (upstream) resolvedUrl = upstream;
      }
    } catch (e) { }

    const isYoutube = resolvedUrl.includes('youtube.com') || resolvedUrl.includes('youtu.be') || resolvedUrl.includes('googlevideo.com') || (pageUrl && (pageUrl.includes('youtube.com') || pageUrl.includes('youtu.be')));
    const streamFormat = String(payload?.format || '').toUpperCase();
    const isManifest = resolvedUrl.includes('.m3u8') || resolvedUrl.includes('.mpd') || streamFormat === 'DASH' || streamFormat === 'HLS';
    const isYtdlpSite = isYtdlpSupportedSiteUrl(resolvedUrl) || (pageUrl && isYtdlpSupportedSiteUrl(pageUrl));
    const useYtDlp = isYoutube || isManifest || !!audioUrl || isLive || isYtdlpSite;

    const abortController = { aborted: false, abort() { this.aborted = true; } };

    if (useYtDlp) {
      // ══════════════════════════════════════════════════════════════════
      //  yt-dlp download logic
      // ══════════════════════════════════════════════════════════════════
      const ffmpegPath = getFfmpegPath();
      const args = [
        '--newline',
        '--progress',
        '--no-playlist',
        '--continue',
        '--allow-unplayable-formats',
        '--js-runtimes', `node:${process.execPath}`,
        '--ffmpeg-location', ffmpegPath,
        '--user-agent', DESKTOP_USER_AGENT,
        '--no-check-certificate',
        '--socket-timeout', '30',
        '--retries', '10',
        '--fragment-retries', '10',
        '--concurrent-fragments', '4',
        '-o', filePath
      ];

      // MP4 requires seeking to write the moov atom at the end. For live streams, 
      // ffmpeg will crash (code 319997176) if forced to merge to MP4 on-the-fly.
      if (!isLive) {
        args.push('--merge-output-format', 'mp4');
      }

      if (isLive) {
        // We previously used --hls-use-mpegts to let ffmpeg handle live streams, 
        // but ffmpeg crashes with code 319997176 when connecting to the local proxy. 
        // We now rely on yt-dlp's native downloader.
        args.push('--no-part');         // Write directly to file
        args.push('--downloader', 'native');
      }

      console.log('[DOWNLOAD] isLive:', isLive, 'targetUrl:', rawUrl, 'ext:', path.extname(filePath));

      // Smart YouTube Format Selection using Metadata Injection
      if (isYoutube && isAudioOnly) {
        args.push('--extract-audio');
        let mappedCodec = audioCodec;
        if (audioCodec === 'ac3' || audioCodec === 'eac3') mappedCodec = 'best';

        args.push('--audio-format', mappedCodec);
        if (audioQuality !== 'best') {
          args.push('--audio-quality', audioQuality + 'K');
        }
        args.push('-f', 'ba/b');

        if (pageUrl && youtubeSession?.rawData) {
          const tempInfoPath = path.join(app.getPath('temp'), `aether_${downloadId}_info.json`);
          try {
            fs.writeFileSync(tempInfoPath, JSON.stringify(youtubeSession.rawData), 'utf8');
            args.push('--load-info-json', tempInfoPath);
            const cleanupTemp = () => { try { fs.unlinkSync(tempInfoPath); } catch { } };
            setTimeout(cleanupTemp, 10000);
          } catch (err) {
            console.error('[DOWNLOAD] Audio info-json injection failed:', err);
          }
        }
        args.push(pageUrl || rawUrl);
      } else if (isYoutube && pageUrl && youtubeSession?.rawData) {
        try {
          // 1. Find the specific format ID from the UI selection
          const requestedQuality = youtubeSession.qualities.find(q => q.label === qualityLabel);
          const targetFormatId = requestedQuality?.formatId || '';

          // 2. Prepare the Temporary Info JSON
          // We must ensure the JSON matches the format we are about to request
          const tempInfoPath = path.join(app.getPath('temp'), `aether_${downloadId}_info.json`);
          fs.writeFileSync(tempInfoPath, JSON.stringify(youtubeSession.rawData), 'utf8');

          args.push('--load-info-json', tempInfoPath);

          // 3. Define Format Selector
          // If we have a specific target format ID (DASH), we use it + best audio.
          // Otherwise, we fallback to our smart height-based selector.
          if (targetFormatId && targetFormatId !== 'youtube-dash-manifest' && targetFormatId !== 'youtube-hls-manifest') {
            // Favor m4a audio for MP4 container compatibility
            args.push('-f', `(${targetFormatId})+ba[ext=m4a]/ba/b`);
          } else {
            const heightMatch = qualityLabel.match(/(\d+)p/);
            const targetHeight = heightMatch ? parseInt(heightMatch[1]) : 1080;
            const isHighFps = qualityLabel.toLowerCase().includes('60fps') || qualityLabel.toLowerCase().includes('50fps');
            const fpsConstraint = isHighFps ? '[fps>30]' : '';
            const formatSelector = `bestvideo[height=${targetHeight}]${fpsConstraint}+ba[ext=m4a]/ba/bestvideo[height=${targetHeight}]+ba[ext=m4a]/ba/best[height<=${targetHeight}]`;
            args.push('-f', formatSelector);
          }

          args.push(pageUrl);

          // Cleanup flag: we'll try to delete it after spawn or on finish
          const cleanupTemp = () => { try { fs.unlinkSync(tempInfoPath); } catch { } };
          setTimeout(cleanupTemp, 10000); // 10s is usually enough for yt-dlp to read it
        } catch (jsonErr) {
          console.error('[DOWNLOAD] Failed to inject info-json, falling back to page scraper:', jsonErr);
          args.push(pageUrl);
        }
      } else if (isYoutube && pageUrl) {
        // Fallback to scraping if no session metadata exists
        const heightMatch = qualityLabel.match(/(\d+)p/);
        const targetHeight = heightMatch ? parseInt(heightMatch[1]) : 1080;
        const isHighFps = qualityLabel.toLowerCase().includes('60fps') || qualityLabel.toLowerCase().includes('50fps');
        const fpsConstraint = isHighFps ? '[fps>30]' : '';
        const formatSelector = `bestvideo[height=${targetHeight}]${fpsConstraint}+ba[ext=m4a]/ba/bestvideo[height=${targetHeight}]+ba[ext=m4a]/ba/best[height<=${targetHeight}]`;

        args.push('-f', formatSelector);
        args.push(pageUrl);
      } else if (isYoutube && audioUrl && (rawUrl.includes('googlevideo.com') || audioUrl.includes('googlevideo.com'))) {
        // Fallback if we only have IDs/Direct links (Legacy)
        args.push('-f', 'bestvideo+ba[ext=m4a]/ba/best');
        args.push(rawUrl);
      } else if (isLive && (resolvedUrl.includes('.m3u8') || streamFormat === 'HLS') && rawUrl.includes('/proxy?url=')) {
        // ══════════════════════════════════════════════════════════════════
        //  NATIVE HLS DOWNLOADER for non-YouTube live streams
        //  Bypasses yt-dlp + ffmpeg entirely to avoid crashes (code 319997176).
        //  Downloads segments through our local media proxy which already handles
        //  all auth headers, cookies, referrers, and TLS fingerprinting.
        // ══════════════════════════════════════════════════════════════════
        console.log(`[DOWNLOAD][NATIVE-HLS] Starting native HLS download for: ${downloadId}`);

        // Ensure output is .ts for raw segment concatenation
        let tsFilePath = filePath;
        const currentExt = path.extname(filePath).toLowerCase();
        if (currentExt !== '.ts') {
          tsFilePath = filePath.replace(/\.[^.]+$/, '.ts');
        }

        const entry = { abortController, filePath: tsFilePath, status: 'downloading', isLive: true };
        activeDownloads.set(downloadId, entry);

        const proxyBaseUrl = rawUrl.split('/proxy?url=')[0];

        // Helper: fetch a URL through our local proxy using Node http (fast, no TLS issues)
        const fetchThroughProxy = (url) => {
          return new Promise((resolve, reject) => {
            if (abortController.aborted) return reject(new Error('Aborted'));
            const proxyUrl = `${proxyBaseUrl}/proxy?url=${encodeURIComponent(url)}`;
            // Extract rid from original rawUrl and forward it
            try {
              const origParsed = new URL(rawUrl);
              const rid = origParsed.searchParams.get('rid');
              if (rid) {
                const pUrl = new URL(proxyUrl);
                pUrl.searchParams.set('rid', rid);
                var finalProxyUrl = pUrl.toString();
              } else {
                var finalProxyUrl = proxyUrl;
              }
            } catch { var finalProxyUrl = proxyUrl; }

            const http = require('http');
            const parsedProxy = new URL(finalProxyUrl);
            const reqOpts = {
              hostname: parsedProxy.hostname,
              port: parsedProxy.port,
              path: parsedProxy.pathname + parsedProxy.search,
              method: 'GET',
              headers: { 'User-Agent': DESKTOP_USER_AGENT }
            };

            const req = http.request(reqOpts, (res) => {
              const chunks = [];
              res.on('data', (chunk) => chunks.push(chunk));
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                  resolve(Buffer.concat(chunks));
                } else {
                  reject(new Error(`HTTP ${res.statusCode}`));
                }
              });
              res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
          });
        };

        // Helper: parse an HLS manifest and return segment objects with decryption metadata
        const parseM3u8Segments = (manifestText, manifestBaseUrl) => {
          const lines = manifestText.split(/\r?\n/);
          const segments = [];
          let currentKey = null;
          let currentSequence = 0;

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
              currentSequence = parseInt(trimmed.split(':')[1]) || 0;
            } else if (trimmed.startsWith('#EXT-X-KEY:')) {
              const methodMatch = trimmed.match(/METHOD=([^,]+)/);
              const uriMatch = trimmed.match(/URI="([^"]+)"/);
              const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);

              if (methodMatch && methodMatch[1] === 'AES-128' && uriMatch) {
                try {
                  const keyUrl = new URL(uriMatch[1], manifestBaseUrl).toString();
                  currentKey = {
                    method: 'AES-128',
                    url: keyUrl,
                    ivHex: ivMatch ? ivMatch[1] : null
                  };
                } catch { }
              } else if (methodMatch && methodMatch[1] === 'NONE') {
                currentKey = null;
              }
            } else if (!trimmed.startsWith('#')) {
              try {
                const absUrl = new URL(trimmed, manifestBaseUrl).toString();
                segments.push({ url: absUrl, key: currentKey, seqNo: currentSequence });
              } catch {
                segments.push({ url: trimmed, key: currentKey, seqNo: currentSequence });
              }
              currentSequence++;
            }
          }
          return segments;
        };

        // Helper: find the best variant from a master playlist
        const pickBestVariant = (manifestText, manifestBaseUrl, targetHeight) => {
          const lines = manifestText.split(/\r?\n/);
          let bestUrl = null;
          let bestBandwidth = 0;
          let bestHeight = 0;

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
            const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
            const height = resMatch ? parseInt(resMatch[1]) : 0;

            // Find next non-comment line as the URL
            let urlLine = '';
            for (let j = i + 1; j < lines.length; j++) {
              const nextLine = lines[j].trim();
              if (nextLine && !nextLine.startsWith('#')) {
                urlLine = nextLine;
                break;
              }
            }
            if (!urlLine) continue;

            // Pick the highest quality that doesn't exceed targetHeight (or just highest if no targetHeight)
            const th = targetHeight || 99999;
            if (height <= th && (height > bestHeight || (height === bestHeight && bandwidth > bestBandwidth))) {
              bestHeight = height;
              bestBandwidth = bandwidth;
              try {
                bestUrl = new URL(urlLine, manifestBaseUrl).toString();
              } catch {
                bestUrl = urlLine;
              }
            }
          }

          // Fallback: if nothing matched, pick the last variant
          if (!bestUrl) {
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim();
              if (line && !line.startsWith('#')) {
                try {
                  bestUrl = new URL(line, manifestBaseUrl).toString();
                } catch { bestUrl = line; }
                break;
              }
            }
          }

          return bestUrl;
        };

        // Main download loop
        (async () => {
          try {
            // 1. Resolve the upstream m3u8 URL from the proxy URL
            const origParsed = new URL(rawUrl);
            const upstreamManifestUrl = origParsed.searchParams.get('url');
            if (!upstreamManifestUrl) throw new Error('Could not extract upstream URL from proxy URL');

            // 2. Fetch the master manifest
            console.log(`[DOWNLOAD][NATIVE-HLS] Fetching manifest: ${upstreamManifestUrl}`);
            const masterBuf = await fetchThroughProxy(upstreamManifestUrl);
            const masterText = masterBuf.toString('utf-8');

            // 3. Determine target height from quality label
            const heightMatch = qualityLabel ? qualityLabel.match(/(\d+)p/) : null;
            const targetHeight = heightMatch ? parseInt(heightMatch[1]) : null;

            // 4. Check if this is a master playlist (contains #EXT-X-STREAM-INF)
            let mediaPlaylistUrl = upstreamManifestUrl;
            let mediaPlaylistText = masterText;

            if (masterText.includes('#EXT-X-STREAM-INF:')) {
              console.log(`[DOWNLOAD][NATIVE-HLS] Master playlist detected, selecting variant (target: ${targetHeight || 'best'}p)`);
              const variantUrl = pickBestVariant(masterText, upstreamManifestUrl, targetHeight);
              if (variantUrl) {
                mediaPlaylistUrl = variantUrl;
                console.log(`[DOWNLOAD][NATIVE-HLS] Selected variant: ${mediaPlaylistUrl}`);
                const variantBuf = await fetchThroughProxy(mediaPlaylistUrl);
                mediaPlaylistText = variantBuf.toString('utf-8');
              }
            }

            // 5. Open write stream for .ts output
            const writeStream = fs.createWriteStream(tsFilePath, { flags: 'w' });
            entry.writeStream = writeStream;

            let totalDownloaded = 0;
            let segmentCount = 0;
            const downloadedSegmentUrls = new Set();
            let lastProgressTime = Date.now();
            const crypto = require('crypto');
            const keyCache = new Map();

            // 6. Segment download loop (keeps refreshing the playlist for live streams)
            while (!abortController.aborted) {
              const segments = parseM3u8Segments(mediaPlaylistText, mediaPlaylistUrl);
              let newSegments = 0;

              for (const seg of segments) {
                if (abortController.aborted) break;
                if (downloadedSegmentUrls.has(seg.url)) continue;

                try {
                  let segData = await fetchThroughProxy(seg.url);

                  if (seg.key && seg.key.method === 'AES-128') {
                    let keyBuffer = keyCache.get(seg.key.url);
                    if (!keyBuffer) {
                      keyBuffer = await fetchThroughProxy(seg.key.url);
                      keyCache.set(seg.key.url, keyBuffer);
                    }

                    let ivBuffer;
                    if (seg.key.ivHex) {
                      ivBuffer = Buffer.from(seg.key.ivHex.padStart(32, '0'), 'hex');
                    } else {
                      const seqHex = seg.seqNo.toString(16).padStart(32, '0');
                      ivBuffer = Buffer.from(seqHex, 'hex');
                    }

                    const decipher = crypto.createDecipheriv('aes-128-cbc', keyBuffer, ivBuffer);
                    decipher.setAutoPadding(false);
                    segData = Buffer.concat([decipher.update(segData), decipher.final()]);
                  }

                  writeStream.write(segData);
                  totalDownloaded += segData.length;
                  segmentCount++;
                  newSegments++;
                  downloadedSegmentUrls.add(seg.url);

                  // Report progress
                  if (Date.now() - lastProgressTime > 500) {
                    lastProgressTime = Date.now();
                    event.reply('download-progress', {
                      downloadId,
                      percent: 0,
                      speed: '',
                      downloaded: formatBytes(totalDownloaded),
                      total: 'LIVE',
                      isMerging: false,
                      isLive: true
                    });
                  }
                } catch (segErr) {
                  if (abortController.aborted) break;
                  console.warn(`[DOWNLOAD][NATIVE-HLS] Segment error: ${segErr.message}`);
                  // Continue to next segment on error
                }
              }

              // Check if the playlist has an ENDLIST tag (VOD or finished live)
              if (mediaPlaylistText.includes('#EXT-X-ENDLIST')) {
                console.log(`[DOWNLOAD][NATIVE-HLS] Reached end of playlist after ${segmentCount} segments`);
                break;
              }

              // Wait before refreshing the playlist (use target duration or default 4s)
              const tdMatch = mediaPlaylistText.match(/#EXT-X-TARGETDURATION:\s*(\d+)/);
              const refreshInterval = tdMatch ? Math.max(2000, parseInt(tdMatch[1]) * 1000 * 0.5) : 4000;

              await new Promise(resolve => {
                const timer = setTimeout(resolve, refreshInterval);
                // Allow early exit on abort
                const checkAbort = setInterval(() => {
                  if (abortController.aborted) { clearTimeout(timer); clearInterval(checkAbort); resolve(); }
                }, 200);
              });

              if (abortController.aborted) break;

              // Refresh the media playlist
              try {
                const refreshBuf = await fetchThroughProxy(mediaPlaylistUrl);
                mediaPlaylistText = refreshBuf.toString('utf-8');
              } catch (refreshErr) {
                console.warn(`[DOWNLOAD][NATIVE-HLS] Playlist refresh error: ${refreshErr.message}`);
                // Wait a bit and retry
                await new Promise(r => setTimeout(r, 3000));
              }
            }

            // 7. Close the write stream
            writeStream.end();
            await new Promise(resolve => writeStream.on('finish', resolve));

            activeDownloads.delete(downloadId);

            if (abortController.aborted) {
              // User stopped the live recording
              console.log(`[DOWNLOAD][NATIVE-HLS] Recording stopped by user after ${segmentCount} segments (${formatBytes(totalDownloaded)})`);
              if (fs.existsSync(tsFilePath) && totalDownloaded > 1024) {
                await remuxLiveRecording(tsFilePath);
                const size = fs.existsSync(tsFilePath) ? formatBytes(fs.statSync(tsFilePath).size) : 'unknown';
                event.reply('download-complete', { downloadId, filePath: tsFilePath, size });
              } else {
                event.reply('download-error', { downloadId, message: 'Recording too short' });
              }
            } else {
              // Natural end (VOD or stream ended)
              console.log(`[DOWNLOAD][NATIVE-HLS] Complete: ${segmentCount} segments, ${formatBytes(totalDownloaded)}`);
              await remuxLiveRecording(tsFilePath);
              const size = fs.existsSync(tsFilePath) ? formatBytes(fs.statSync(tsFilePath).size) : 'unknown';
              event.reply('download-complete', { downloadId, filePath: tsFilePath, size });
            }
          } catch (err) {
            activeDownloads.delete(downloadId);
            console.error(`[DOWNLOAD][NATIVE-HLS] Fatal error:`, err);
            event.reply('download-error', { downloadId, message: `Native HLS error: ${err.message}` });
          }
        })();
        return;
      } else {
        // If the URL is a proxy-wrapped manifest (DASH/HLS), yt-dlp can't parse 
        // the proxy URL. Unwrap to the real upstream URL and inject --referer.
        let finalYtdlpUrl = rawUrl;
        if (isManifest && rawUrl.includes('/proxy?url=') && resolvedUrl && resolvedUrl !== rawUrl) {
          finalYtdlpUrl = resolvedUrl;
          console.log(`[DOWNLOAD] Unwrapped proxy URL for yt-dlp: ${finalYtdlpUrl}`);
          // Inject the source page as referer so the CDN accepts the request
          if (pageUrl) {
            args.push('--referer', pageUrl);
          }
        }

        // Generic stream quality selection (non-live)
        if (qualityLabel && qualityLabel !== "Default") {
          const heightMatch = qualityLabel.match(/(\d+)p/);
          if (heightMatch) {
            const targetHeight = parseInt(heightMatch[1]);
            const isHighFps = qualityLabel.toLowerCase().includes('60fps') || qualityLabel.toLowerCase().includes('50fps');
            const fpsConstraint = isHighFps ? '[fps>30]' : '';
            const formatSelector = `bestvideo[height<=${targetHeight}]${fpsConstraint}+bestaudio/best[height<=${targetHeight}]/best`;
            args.push('-f', formatSelector);
          }
        }
        args.push(finalYtdlpUrl);
      }

      console.log(`[DOWNLOAD] Spawning yt-dlp with args: ${args.join(' ')}`);
      const ytProcess = spawn(pathToYtdlp, args);
      const entry = { abortController, ytProcess, filePath, status: 'downloading', isMerging: false, isLive };
      activeDownloads.set(downloadId, entry);

      let lastPercent = 0;
      let existingFilesizeOffset = 0;
      if (payload.isResume && fs.existsSync(filePath)) {
        try { existingFilesizeOffset = fs.statSync(filePath).size; } catch { }
      }

      const handleYtdlpOutput = (data) => {
        const output = data.toString();

        // Detect part switches (e.g., Video then Audio)
        if (output.includes('[download] Destination:')) {
          entry.currentPart = (entry.currentPart || 0) + 1;
        }

        // Parse: [download]  10.0% of 100.00MiB at 10.00MiB/s ETA 00:09
        const match = output.match(/\[download\]\s+(\d+\.\d+)%\s+of\s+(?:~)?(.+?)\s+at\s+(.+?)\s+ETA\s+(.+)/);
        if (match && !entry.isMerging) {
          const rawPercent = parseFloat(match[1]);
          const totalStr = match[2].trim();
          const speed = match[3].trim();

          const parseBytes = (str) => {
            const m = str.match(/(\d+\.?\d*)\s*([KMGTPE]i?B)/i);
            if (!m) return 0;
            const val = parseFloat(m[1]);
            const unit = m[2].toLowerCase();
            const multipliers = {
              'b': 1, 'kb': 1000, 'mb': 1000000, 'gb': 1000000000,
              'kib': 1024, 'mib': 1024 * 1024, 'gib': 1024 * 1024 * 1024
            };
            return val * (multipliers[unit] || multipliers[unit.replace('i', '')] || 1);
          };

          const totalBytes = parseBytes(totalStr);
          const downloadedBytes = (totalBytes * rawPercent) / 100;
          const downloadedStr = formatBytes(downloadedBytes);

          // Map to a global percentage if we have multiple parts
          let displayPercent = rawPercent;
          const isDualPart = !isAudioOnly && (args.some(arg => arg === '-f' && arg.includes('+')) || !!audioUrl || isYoutube);

          if (isDualPart) {
            const current = entry.currentPart || 1;
            if (current === 1) {
              displayPercent = rawPercent * 0.85; // Video is usually much larger, 0-85%
            } else if (current === 2) {
              displayPercent = 85 + (rawPercent * 0.13); // Audio, 85-98%
            } else {
              displayPercent = 98 + (rawPercent * 0.01); // Extra, 98-99%
            }
          }

          if (displayPercent > lastPercent || displayPercent === 0) {
            lastPercent = displayPercent;
            event.reply('download-progress', {
              downloadId,
              percent: Math.min(99, Math.round(displayPercent)),
              speed,
              downloaded: downloadedStr,
              total: totalStr,
              isMerging: false
            });
          }
        } else if (isLive) {
          // Case 1: Standard yt-dlp live progress: [download]   2.34MiB at  1.23MiB/s (00:02)
          let liveMatch = output.match(/\[download\]\s+([\d.]+[\w]+)\s+at\s+([\d.]+[\w/]+)\s+\((.+)\)/);
          // Case 2: Ffmpeg-style progress (often seen with HLS): size=    8192KiB time=00:00:49.98 bitrate=1342.5kbits/s speed=1.46x
          let isFfmpegStyle = false;
          if (!liveMatch) {
            liveMatch = output.match(/size=\s*([\d.]+[\w]+)\s+time=.*speed=\s*([\d.]+x)/);
            isFfmpegStyle = !!liveMatch;
          }

          if (liveMatch) {
            const downloaded = liveMatch[1].trim();
            const speed = liveMatch[2].trim();
            event.reply('download-progress', {
              downloadId,
              percent: 0,
              speed: speed,
              downloaded,
              total: 'LIVE',
              isMerging: false,
              isLive: true
            });
          }
        } else if (output.includes('[Merger]') || output.includes('Merging formats') || output.includes('[ExtractAudio]') || output.includes('[FixupM4a]') || output.includes('Extracting audio')) {
          entry.isMerging = true;
          event.reply('download-progress', {
            downloadId,
            percent: 99,
            speed: 'Processing',
            downloaded: '',
            total: '',
            isMerging: true
          });
        }
      };

      ytProcess.stdout.on('data', handleYtdlpOutput);
      ytProcess.stderr.on('data', (data) => {
        handleYtdlpOutput(data);
        const output = data.toString().trim();
        console.warn(`[DOWNLOAD][yt-dlp] ${output}`);
        if (output.includes('ERROR:')) {
          entry.errorMessage = output.split('\n').find(line => line.includes('ERROR:')) || output;
        } else if (!entry.errorMessage && output) {
          const lines = output.split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length > 0) {
            entry.errorMessage = lines[lines.length - 1];
          }
        }
      });

      ytProcess.on('close', async (code) => {
        if (abortController.aborted) {
          // For live recordings, a user-initiated abort means "finish recording".
          // Try to remux the file to fix the container, then report completion.
          if (isLive && fs.existsSync(filePath) && !entry.forceCancel) {
            console.log(`[DOWNLOAD] Live recording stopped, remuxing: ${downloadId}`);
            activeDownloads.delete(downloadId);
            await remuxLiveRecording(filePath);
            const size = fs.existsSync(filePath) ? formatBytes(fs.statSync(filePath).size) : 'unknown';
            event.reply('download-complete', { downloadId, filePath, size });
          }
          return;
        }
        activeDownloads.delete(downloadId);

        if (code === 0) {
          console.log(`[DOWNLOAD] Complete (yt-dlp): ${downloadId}`);
          // yt-dlp output might have a different size than actually downloaded if merged
          const size = fs.existsSync(filePath) ? formatBytes(fs.statSync(filePath).size) : 'unknown';
          event.reply('download-complete', { downloadId, filePath, size });
        } else {
          console.error(`[DOWNLOAD] Error (yt-dlp) code ${code} for ${downloadId}`);
          event.reply('download-error', { downloadId, message: entry.errorMessage || `yt-dlp failed with exit code ${code}` });
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { }
        }
      });

      return;
    }

    // ══════════════════════════════════════════════════════════════════
    //  Standard HTTP download logic (IDM Concurrent Downloader)
    // ══════════════════════════════════════════════════════════════════
    const MAX_DOWNLOAD_THREADS = 16;
    const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

    async function executeIDMDownload() {
      let targetUrl;
      let requestId = null;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname === '127.0.0.1' && parsed.pathname === '/proxy') {
          const upstream = parsed.searchParams.get('url');
          requestId = parsed.searchParams.get('rid');
          targetUrl = upstream ? new URL(upstream) : parsed;
        } else {
          targetUrl = parsed;
        }
      } catch (parseErr) {
        console.error('[DOWNLOAD] Invalid URL error parsing:', parseErr);
        event.reply('download-error', { downloadId, message: 'Invalid URL: ' + String(parseErr.message) });
        return;
      }

      // Initial activeDownloads entry to support early cancellation
      const entry = { abortController, filePath, threads: [], writeStreams: [], status: 'downloading', mergeStream: null, request: null };
      activeDownloads.set(downloadId, entry);

      const targetHost = targetUrl.hostname.toLowerCase();
      const isPixelDrain = isPixeldrainHost(targetHost);
      const storedHeaders = requestId ? getStoredProxyHeaders(requestId) : null;
      const cleanedStoredHeaders = {};
      if (storedHeaders) {
        for (const [key, value] of Object.entries(storedHeaders)) {
          const lk = String(key).toLowerCase();
          if (lk === 'range' || lk === 'host') continue;
          cleanedStoredHeaders[lk] = value;
        }
      }

      const requestHeaders = {
        'user-agent': DESKTOP_USER_AGENT,
        'accept': '*/*',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'identity',
        'connection': 'keep-alive',
        ...cleanedStoredHeaders
      };

      try {
        const cookies = await session.defaultSession.cookies.get({ url: targetUrl.toString() });
        if (cookies && cookies.length > 0) {
          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          if (requestHeaders['cookie']) {
            const existingMap = new Map();
            for (const pair of requestHeaders['cookie'].split(';')) {
              const eqIdx = pair.indexOf('=');
              if (eqIdx > 0) existingMap.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
            }
            for (const pair of cookieStr.split(';')) {
              const eqIdx = pair.indexOf('=');
              if (eqIdx > 0) existingMap.set(pair.slice(0, eqIdx).trim(), pair.slice(eqIdx + 1).trim());
            }
            requestHeaders['cookie'] = Array.from(existingMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
          } else {
            requestHeaders['cookie'] = cookieStr;
          }
        }
      } catch (e) { }

      if (!requestHeaders['referer'] && pageUrl) requestHeaders['referer'] = pageUrl;
      if (!requestHeaders['origin'] && requestHeaders['referer']) {
        try { requestHeaders['origin'] = new URL(requestHeaders['referer']).origin; } catch { }
      }
      if (isPixelDrain) {
        const fileId = getPixelDrainFileId(targetUrl.toString()) || '';
        Object.assign(requestHeaders, buildPixelDrainHeaders({ fileId, targetUrl: targetUrl.toString(), accept: '*/*', existingHeaders: requestHeaders }));
      }

      const getRedirectsAndMeta = async (currentUrl, redirectCount = 0) => {
        return new Promise((resolve, reject) => {
          if (abortController.aborted) return reject(new Error("Aborted"));
          const dlClient = currentUrl.protocol === 'http:' ? http : https;
          const dlHeaders = redirectCount > 0 ? { ...requestHeaders, referer: targetUrl.toString() } : requestHeaders;
          const req = dlClient.request(currentUrl, { method: 'GET', headers: { ...dlHeaders, range: 'bytes=0-0' }, agent: currentUrl.protocol === 'http:' ? proxyHttpAgent : proxyHttpsAgent }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume();
              if (redirectCount >= 6) return reject(new Error("Too many redirects"));
              try { resolve(getRedirectsAndMeta(new URL(String(res.headers.location).trim(), currentUrl), redirectCount + 1)); }
              catch (e) { reject(e); }
              return;
            }
            res.resume(); // discard body for metadata request
            if (res.statusCode >= 400 && res.statusCode !== 416) {
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const supportsRanges = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes';
            let totalBytes = 0;
            if (res.statusCode === 206 && res.headers['content-range']) {
              const match = res.headers['content-range'].match(/\/(\d+)$/);
              if (match) totalBytes = parseInt(match[1], 10);
            } else if (res.headers['content-length']) {
              // If it didn't respect range request, content-length is the full total
              totalBytes = parseInt(res.headers['content-length'], 10);
            }
            resolve({ finalUrl: currentUrl, totalBytes, supportsRanges });
          });
          req.setTimeout(30000, () => req.destroy(new Error("Timeout probing URL")));
          req.on('error', reject);
          req.end();
        });
      };

      console.log(`[DOWNLOAD] Probing headers config for IDM...`);
      const meta = await getRedirectsAndMeta(targetUrl);
      if (abortController.aborted) return;

      const { finalUrl, totalBytes, supportsRanges } = meta;
      let threadCount = 1;
      const requestedThreads = Number(payload.threads) || MAX_DOWNLOAD_THREADS;
      if (supportsRanges && totalBytes > MIN_CHUNK_SIZE && !isPixelDrain) {
        // Respect user-selected thread count or fallback to default
        threadCount = Math.min(requestedThreads, Math.ceil(totalBytes / MIN_CHUNK_SIZE));
      }

      console.log(`[DOWNLOAD] Starting ${downloadId} with ${threadCount} threads (Requested: ${requestedThreads})`);
      console.log(`[DOWNLOAD] Total size: ${totalBytes || 'Unknown'}, Supports Ranges: ${supportsRanges}`);

      const downloader = new DynamicDownloader({
        downloadId,
        finalUrl,
        filePath,
        totalBytes,
        headers: requestHeaders,
        proxyHttpAgent,
        proxyHttpsAgent,
        threadCount,
        supportsRanges,
        abortController,
        onProgress: (downloaded, total, speedBps, percent) => {
          const speed = `${formatBytes(speedBps)}/s`;
          event.reply('download-progress', {
            downloadId,
            percent,
            speed,
            downloaded: formatBytes(downloaded),
            total: total > 0 ? formatBytes(total) : '?'
          });
        },
        onComplete: (completedFilePath, sizeBytes) => {
          console.log(`[DOWNLOAD] Final Complete: ${downloadId}`);
          activeDownloads.delete(downloadId);
          event.reply('download-complete', { downloadId, filePath: completedFilePath, size: formatBytes(sizeBytes) });
        },
        onError: (err) => {
          if (!abortController.aborted) {
            console.error('[DOWNLOAD] Fatal IDM error:', err.stack || err.message || err);
            event.reply('download-error', { downloadId, message: err.message || 'Fatal download error' });
          }
          activeDownloads.delete(downloadId);
        }
      });

      entry.downloader = downloader;
      await downloader.start();
    }

    executeIDMDownload().catch(err => {
      if (!abortController.aborted) {
        console.error('[DOWNLOAD] Fatal IDM error:', err.stack || err.message || err);
        event.reply('download-error', { downloadId, message: err.message || 'Fatal download error' });
      }
      activeDownloads.delete(downloadId);
    });
  });

  ipcMain.on('pause-download', async (event, payload) => {
    const downloadId = String(payload?.downloadId || '');
    const entry = activeDownloads.get(downloadId);
    if (!entry) return;

    console.log(`[DOWNLOAD] Pausing: ${downloadId}`);
    entry.abortController.aborted = true;
    if (entry.downloader) entry.downloader.abort();

    // Cleanup IDM/Segmented threads
    if (Array.isArray(entry.threads)) {
      entry.threads.forEach(t => { try { t.destroy(); } catch { } });
    }
    if (Array.isArray(entry.writeStreams)) {
      entry.writeStreams.forEach(s => { try { s.end(); s.destroy(); } catch { } });
    }

    try { entry.request?.destroy(); } catch { }
    if (entry.ytProcess) await killProcessTree(entry.ytProcess);
    try { entry.writeStream?.destroy(); } catch { }
    try { entry.mergeStream?.destroy(); } catch { }

    activeDownloads.delete(downloadId);
    event.reply('download-paused', { downloadId });
  });

  ipcMain.on('cancel-download', async (event, payload) => {
    const downloadId = String(payload?.downloadId || '');
    const forceCancel = !!payload?.forceCancel;
    const entry = activeDownloads.get(downloadId);

    if (entry) {
      console.log(`[DOWNLOAD] ${entry.isLive && !forceCancel ? 'Finishing' : 'Cancelling'}: ${downloadId}`);
      entry.abortController.aborted = true;
      if (forceCancel) {
        entry.forceCancel = true;
      }
      if (entry.downloader) entry.downloader.abort();

      // Cleanup IDM/Segmented threads
      if (Array.isArray(entry.threads)) {
        entry.threads.forEach(t => { try { t.destroy(); } catch { } });
      }
      if (Array.isArray(entry.writeStreams)) {
        entry.writeStreams.forEach(s => { try { s.end(); s.destroy(); } catch { } });
      }

      try { entry.request?.destroy(); } catch { }

      if (entry.ytProcess) {
        if (entry.isLive && !forceCancel) {
          // For live recordings: kill the process tree.
          // On Windows, SIGINT is not supported for child processes, so we
          // use killProcessTree (taskkill /F /T) instead. The yt-dlp close
          // handler will detect isLive + aborted and remux the file to fix
          // the MP4 container before sending download-complete.
          console.log(`[DOWNLOAD] Stopping live recording: ${downloadId}`);
          await killProcessTree(entry.ytProcess);
          // Don't send download-cancelled for live recordings.
          // The close handler will remux and send download-complete.
          return;
        } else {
          await killProcessTree(entry.ytProcess);
        }
      } else if (entry.isLive && !forceCancel) {
        // Native HLS downloader: no ytProcess exists.
        // The async loop will detect abortController.aborted, close the write stream,
        // remux the recording, and send download-complete. Just return here.
        console.log(`[DOWNLOAD] Stopping native HLS live recording: ${downloadId}`);
        return;
      }

      try { entry.writeStream?.destroy(); } catch { }
      try { entry.mergeStream?.destroy(); } catch { }

      activeDownloads.delete(downloadId);

      deleteRelatedFiles(entry.filePath);
    } else if (payload.filePath) {
      deleteRelatedFiles(payload.filePath);
    }

    event.reply('download-cancelled', { downloadId });
  });

  // Component 5: Handle unsupported format transcoding requests from the renderer.
  // When the <video> element reports error code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED),
  // the renderer sends this event. We analyze, remux/transcode, and reply with a
  // playable URL.
  ipcMain.on('request-media-transcode', async (event, filePath) => {
    try {
      const resolvedPath = path.resolve(String(filePath || ''));
      if (!fs.existsSync(resolvedPath)) {
        event.reply('transcode-error', { message: `File not found: ${resolvedPath}` });
        return;
      }

      console.log('[TRANSCODE] Analyzing file for transcoding:', resolvedPath);
      const analysis = await demuxerIntegration.analyze(resolvedPath);

      if (analysis?.error) {
        event.reply('transcode-error', { message: analysis.error });
        return;
      }

      console.log('[TRANSCODE] Starting remux/transcode for:', resolvedPath);
      const result = await demuxerIntegration.remuxForPlayback({ filePath: resolvedPath, time: 0 });

      if (result?.url && !result.error) {
        console.log('[TRANSCODE] Success:', result.url, 'mode:', result.mode);
        event.reply('media-transcoded', {
          url: result.url,
          filePath: resolvedPath,
          mode: result.mode || 'copy'
        });
      } else {
        event.reply('transcode-error', { message: result?.error || 'Transcoding produced no output' });
      }
    } catch (error) {
      console.error('[TRANSCODE] Failed:', error?.message || error);
      event.reply('transcode-error', { message: error?.message || 'Transcoding failed' });
    }
  });

  const localVideoHelpers = createLocalVideoHelpers({
    path,
    fs,
    dialog,
    app,
    getFfmpegPath,
    demuxerIntegration
  });

  localVideoHelpers.registerLocalVideoHandlers({
    ipcMain,
    win,
    toLocalMediaUrl,
    parseSingleEntryMediaPlaylist,
    isLocalMediaPath,
    mapDemuxTracksForRenderer,
    parseSubtitleTextToCues,
    getMediaProxyOrigin: () => mediaServerOrigin || ''
  });


  // ── PPV Live TV: fetch streams from api.ppv.to ──
  ipcMain.handle('fetch-ppv-streams', async () => {
    try {
      const https = require('https');
      const data = await new Promise((resolve, reject) => {
        const req = https.get('https://api.ppv.to/api/streams', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 15000,
          rejectUnauthorized: false
        }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (parseErr) {
              reject(new Error('Failed to parse PPV API response'));
            }
          });
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('PPV API request timed out')); });
      });

      if (!data || !data.success || !Array.isArray(data.streams)) {
        return { success: false, error: 'Invalid API response', streams: [] };
      }

      const allStreams = [];
      for (const category of data.streams) {
        const categoryName = String(category.category || 'Other');
        if (!Array.isArray(category.streams)) continue;
        for (const stream of category.streams) {
          allStreams.push({
            id: stream.id,
            name: String(stream.name || 'Unknown Event'),
            tag: String(stream.tag || ''),
            poster: String(stream.poster || ''),
            category: categoryName,
            uriName: String(stream.uri_name || ''),
            startsAt: Number(stream.starts_at || 0),
            endsAt: Number(stream.ends_at || 0),
            alwaysLive: !!stream.always_live || !!category.always_live,
            iframe: String(stream.iframe || ''),
            viewers: String(stream.viewers || '0'),
            substreams: Array.isArray(stream.substreams) ? stream.substreams.map(sub => ({
              id: sub.id,
              name: String(sub.name || ''),
              iframe: String(sub.iframe || '')
            })) : []
          });
        }
      }

      console.log(`[PPV-TV] Fetched ${allStreams.length} streams across ${data.streams.length} categories`);
      return { success: true, streams: allStreams, timestamp: data.timestamp || Math.floor(Date.now() / 1000) };
    } catch (err) {
      console.error('[PPV-TV] Fetch failed:', err?.message || err);
      return { success: false, error: err?.message || 'Failed to fetch streams', streams: [] };
    }
  });

  ipcMain.handle('clear-pixeldrain-cookies', async () => {
    for (const [domain] of pixelDrainDomainCookies) {
      if (domain.includes('pixeldrain')) {
        pixelDrainDomainCookies.delete(domain);
      }
    }
    await clearPixeldrainSessionCookies();
    console.log('Cleared all PixelDrain cookies (map + session)');
  });

  // Enhanced CDN link generator for folder/album files in the renderer
  ipcMain.handle('generate-pixeldrain-cdn-link', async (_event, payload) => {
    try {
      const { type, folderId, fileName, fileId } = payload || {};

      let syntheticUrl = '';
      let targetId = fileId || folderId;

      if (type === 'folder' && folderId && fileName) {
        // Folder file: pattern /d/folderId/fileName
        syntheticUrl = `https://pixeldrain.com/d/${encodeURIComponent(folderId)}/${encodeURIComponent(fileName)}`;
        targetId = folderId;
      } else if ((type === 'album' || type === 'file') && fileId) {
        // Album or direct file: pattern /u/fileId
        // Usually renderer passes specific file IDs
        syntheticUrl = `https://pixeldrain.com/u/${encodeURIComponent(fileId)}`;
        targetId = fileId;
      } else if (type === 'folder' && fileId && fileName) {
        // Alternate folder file pattern
        syntheticUrl = `https://pixeldrain.com/d/${encodeURIComponent(fileId)}/${encodeURIComponent(fileName)}`;
        targetId = fileId;
      } else if (fileId) {
        // Generic fallback
        syntheticUrl = `https://pixeldrain.com/u/${encodeURIComponent(fileId)}`;
      }

      if (!syntheticUrl || !targetId) return null;

      console.log(`[CDN-IPC] Request type=${type} targetId=${targetId} syntheticUrl=${syntheticUrl}`);
      const result = await generateEnhancedCdnLink(targetId, syntheticUrl);

      if (result?.url) {
        try {
          const host = new URL(result.url).hostname.toLowerCase();
          pixeldrainMirrorRegistry.add(host);
        } catch { }
        console.log(`[CDN-IPC] Enhanced CDN found: ${result.url}`);
        return { url: result.url, proxyHeaders: result.proxyHeaders || null };
      }

      return null;
    } catch (err) {
      console.warn('[CDN-IPC] Enhanced CDN generation failed:', err?.message || err);
      return null;
    }
  });

  // Smart probe: determine if a /d/{id} URL is a folder or a direct file
  ipcMain.handle('probe-pixeldrain-filesystem', async (_event, { id }) => {
    try {
      if (!id) return { isFolder: false, files: [] };
      console.log(`[PIXELDRAIN-PROBE] Probing filesystem for id=${id}`);

      // Try CDN mirror first, then native
      const urls = [
        `https://cdn.pixeldrain.eu.cc/proxy-api/filesystem/${encodeURIComponent(id)}`,
        `https://pixeldrain.com/api/filesystem/${encodeURIComponent(id)}`,
      ];

      for (const probeUrl of urls) {
        try {
          const headers = buildPixelDrainHeaders({ fileId: id, targetUrl: probeUrl, userAgent: DESKTOP_USER_AGENT });
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(probeUrl, {
            headers: { ...headers, 'Accept': 'application/json' },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            console.log(`[PIXELDRAIN-PROBE] ${probeUrl} returned ${resp.status}`);
            continue;
          }

          const data = await resp.json();
          // Check if it's a folder (has children array)
          const candidateCollections = [
            data?.children,
            data?.value?.children,
            data?.data?.children,
            data?.files,
            data?.value?.files,
            data?.data?.files,
          ];
          const collection = candidateCollections.find(c => Array.isArray(c));

          if (collection && collection.length > 0) {
            const files = collection
              .filter(f => {
                const name = String(f?.name || f?.path || f?.id || '').trim();
                const type = String(f?.type || '').toLowerCase();
                if (!name || name === '.search_index.gz') return false;
                if (!type) return true;
                return type === 'file';
              })
              .map(f => ({
                name: decodeURIComponent(String(f?.name || f?.path || f?.id || 'Unknown')),
                id: String(f?.name || f?.path || f?.id || '').trim(),
                size: f?.size || 0,
                mime_type: f?.mime_type || '',
              }))
              .filter(f => !!f.id);

            console.log(`[PIXELDRAIN-PROBE] Folder detected with ${files.length} files`);
            return { isFolder: true, files, title: data?.name || data?.title || `Pixeldrain folder: ${id}` };
          }

          console.log(`[PIXELDRAIN-PROBE] Not a folder (no children array)`);
          return { isFolder: false, files: [] };
        } catch (probeErr) {
          console.warn(`[PIXELDRAIN-PROBE] ${probeUrl} failed:`, probeErr?.message || probeErr);
          continue;
        }
      }

      return { isFolder: false, files: [] };
    } catch (err) {
      console.error('[PIXELDRAIN-PROBE] Error:', err?.message || err);
      return { isFolder: false, files: [] };
    }
  });
  ipcMain.on('get-youtube-stream', async (event, url) => {
    try {
      console.log('Fetching best stream for:', url);
      const output = await extractYoutubeInfo(url);
      console.log('YT-DLP Response received for:', output.title);

      youtubeSession = buildYoutubeSession(output);
      youtubeSession.pageUrl = url; // store for lazy POT resolution
      const selected = youtubeSession.selected;
      const startupSelected = youtubeSession.startupSelected || selected;
      console.log(
        'YouTube qualities prepared:',
        youtubeSession.qualities.map((entry) => `${entry.label}${entry.hasAudio ? '' : ' (video-only)'}`).join(', ') || 'none'
      );
      console.log('YouTube preferred selected:', selected?.label || 'none');
      console.log('YouTube startup selected:', startupSelected?.label || 'none');

      if (startupSelected?.url) {
        const payload = maybeProxifyPayload({
          url: startupSelected.url,
          audioUrl: startupSelected.audioUrl,
          audioTracks: youtubeSession.audioTracks || [],
          title: youtubeSession.title,
          isLive: youtubeSession.isLive,
          selectedQuality: startupSelected.formatId, // CHANGED from url to formatId
          preferredQuality: selected?.formatId || startupSelected.formatId, // CHANGED from url to formatId
          transport: startupSelected.transport || 'direct',
          proxyHeaders: startupSelected.proxyHeaders || null,
          qualities: youtubeSession.qualities.map((entry) => ({
            label: entry.label,
            value: entry.formatId,
            audioUrl: entry.audioUrl,
            format: (entry.ext || '').toUpperCase(),
            proxyHeaders: entry.proxyHeaders || null
          }))
        });

        event.reply('youtube-stream-ready', payload);
        return;
      }

      if (output?.url && isLikelyDirectMediaUrl(output.url)) {
        event.reply('youtube-stream-ready', {
          url: output.url,
          audioUrl: null,
          title: output.title || 'YouTube Video',
          selectedQuality: 'Default',
          qualities: [{ label: 'Default', value: 'Default' }]
        });
        return;
      }

      event.reply('stream-error', {
        message: 'No stream URL found for this YouTube video.'
      });
    } catch (error) {
      console.error('YT-DLP Error:', error);
      event.reply('stream-error', {
        message: 'Unable to load this URL'
      });
    }
  });
  /**
   * Smart Universal Media Probe using ffprobe.
   * Verifies if a URL is a direct media stream even without file extensions.
   */
  async function probeMediaUrl(url, headers = {}) {
    const ffprobePath = getFfprobePath();
    const ua = headers['user-agent'] || headers['User-Agent'] || headers['User-agent'] || DESKTOP_USER_AGENT;
    const referer = headers['referer'] || headers['Referer'] || '';
    const cookie = headers['cookie'] || headers['Cookie'] || '';

    return new Promise((resolve) => {
      const isHttp = url.startsWith('http://') || url.startsWith('https://');

      const args = [
        '-v', 'error',
        '-hide_banner',
        '-tls_verify', '0',
        '-analyzeduration', '3000000',
        '-probesize', '3000000',
        '-allowed_extensions', 'ALL',
        '-show_entries', 'format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,bit_rate',
        '-of', 'json',
      ];

      if (isHttp) {
        let headerStr = `User-Agent: ${ua}\r\nReferer: ${referer}\r\n`;
        if (cookie) headerStr += `Cookie: ${cookie}\r\n`;
        args.push('-headers', headerStr);
      }

      args.push(url);

      const proc = spawn(ffprobePath, args);
      let output = '';
      let stderrOut = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { stderrOut += data.toString(); });

      const timeout = setTimeout(() => {
        console.error('[probeMediaUrl] TIMED OUT! stderr:', stderrOut);
        try { proc.kill(); } catch { }
        resolve(null);
      }, 12000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.error('[probeMediaUrl] ffprobe exited with code', code, 'stderr:', stderrOut);
          return resolve(null);
        }
        try {
          const data = JSON.parse(output);
          if (data.format && Array.isArray(data.streams) && data.streams.length > 0) {
            return resolve(data);
          }
          console.error('[probeMediaUrl] Missing format/streams in output', output.substring(0, 100));
        } catch (err) {
          console.error('[probeMediaUrl] parse error:', err, 'output:', output.substring(0, 100));
        }
        resolve(null);
      });
      proc.on('error', (err) => {
        console.error('[probeMediaUrl] spawn error:', err);
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  // ── On-demand media probe for the Info modal ──
  ipcMain.handle('probe-current-media', async (_event, url) => {
    if (!url || typeof url !== 'string') return null;
    try {
      // Unwrap proxy URL to get the real upstream URL
      let realUrl = url;
      let proxyUpstreamUrl = null;
      let isLocal = false;
      let probeHeaders = { 'User-Agent': DESKTOP_USER_AGENT };
      try {
        const parsed = new URL(url);
        if (parsed.pathname === '/proxy' && parsed.searchParams.has('url')) {
          proxyUpstreamUrl = parsed.searchParams.get('url');
          console.log('[probe-current-media] Unwrapped proxy URL:', proxyUpstreamUrl?.substring(0, 80) + '...');
        } else if (parsed.protocol === 'file:') {
          const { fileURLToPath } = require('url');
          realUrl = fileURLToPath(url);
          isLocal = true;
        } else if (parsed.protocol === 'aether-media:') {
          realUrl = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
          isLocal = true;
        }
      } catch (err) {
        console.error('[probe-current-media] URL parsing error:', err);
      }

      // Determine the URL to probe with ffprobe
      const ffprobeUrl = proxyUpstreamUrl || realUrl;
      if (!ffprobeUrl) {
        console.error('[probe-current-media] realUrl is empty!');
        return null;
      }
      console.log('[probe-current-media] Probing:', ffprobeUrl.substring(0, 100), isLocal ? '(local)' : '(remote)');

      let result = null;
      try {
        result = await probeMediaUrl(ffprobeUrl, isLocal ? {} : probeHeaders);
        console.log('[probe-current-media] ffprobe result streams count:', result?.streams?.length || 0);
      } catch (err) {
        console.error('[probe-current-media] probeMediaUrl threw error:', err);
      }

      if (!result) {
        console.error('[probe-current-media] probeMediaUrl returned null/empty result.');
      }

      const videoStream = result?.streams?.find(s => s.codec_type === 'video');
      const audioStream = result?.streams?.find(s => s.codec_type === 'audio');
      let fileSize = result?.format?.size ? parseInt(result.format.size, 10) : null;

      // Parse FPS from r_frame_rate (format: "30/1" or "24000/1001")
      let fps = null;
      if (videoStream?.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        if (parts.length === 2 && parseInt(parts[1], 10) > 0) {
          fps = Math.round((parseInt(parts[0], 10) / parseInt(parts[1], 10)) * 100) / 100;
        } else if (parts.length === 1) {
          fps = parseFloat(parts[0]) || null;
        }
      }

      let bitrate = null;
      if (videoStream?.bit_rate) bitrate = parseInt(videoStream.bit_rate, 10);
      else if (audioStream?.bit_rate) bitrate = parseInt(audioStream.bit_rate, 10);
      else if (result?.format?.bit_rate) bitrate = parseInt(result.format.bit_rate, 10);

      let videoCodec = videoStream?.codec_name || null;
      let audioCodec = audioStream?.codec_name || null;

      // ── HLS Manifest Fallback ──
      // If ffprobe failed or couldn't find bitrate (common for HLS), parse the manifest
      const isHlsUrl = /\.m3u8(?:$|\?|#)/i.test(proxyUpstreamUrl || ffprobeUrl);
      if ((!result || !bitrate) && isHlsUrl) {
        console.log('[probe-current-media] Missing bitrate or result for HLS. Parsing manifest...');
        try {
          const manifestUrl = proxyUpstreamUrl ? url : ffprobeUrl;
          const fetcher = session?.defaultSession?.fetch
            ? session.defaultSession.fetch.bind(session.defaultSession)
            : net?.fetch ? net.fetch.bind(net) : null;
          if (fetcher) {
            const resp = await fetcher(manifestUrl, {
              method: 'GET',
              headers: probeHeaders,
              signal: AbortSignal.timeout(8000)
            });
            const manifestText = await resp.text();
            if (manifestText && manifestText.includes('#EXT')) {
              const codecsMatch = manifestText.match(/CODECS="([^"]+)"/i);
              const bandwidthMatch = manifestText.match(/BANDWIDTH=(\d+)/i);

              if (bandwidthMatch) {
                bitrate = parseInt(bandwidthMatch[1], 10);
              }

              if (codecsMatch && !videoCodec && !audioCodec) {
                const codecsStr = codecsMatch[1];
                const codecParts = codecsStr.split(',').map(c => c.trim());

                for (const codec of codecParts) {
                  const lower = codec.toLowerCase();
                  if (lower.startsWith('avc1') || lower.startsWith('avc3')) videoCodec = 'h264';
                  else if (lower.startsWith('hvc1') || lower.startsWith('hev1')) videoCodec = 'hevc';
                  else if (lower.startsWith('vp09') || lower.startsWith('vp9')) videoCodec = 'vp9';
                  else if (lower.startsWith('av01')) videoCodec = 'av1';
                  else if (lower.startsWith('mp4a')) audioCodec = 'aac';
                  else if (lower.startsWith('ac-3') || lower === 'ac3') audioCodec = 'ac3';
                  else if (lower.startsWith('ec-3') || lower === 'eac3') audioCodec = 'eac3';
                  else if (lower.startsWith('opus')) audioCodec = 'opus';
                  else if (lower.startsWith('flac')) audioCodec = 'flac';
                  else if (!videoCodec && !audioCodec) {
                    if (/^(video|v)/.test(lower)) videoCodec = codec;
                    else audioCodec = codec;
                  }
                }
              }
              console.log('[probe-current-media] HLS manifest parsed - updated codecs and bitrate:', { videoCodec, audioCodec, bitrate });

              // ── Segment Probe Fallback ──
              // If codecs are still missing (no CODECS tag in manifest), probe a .ts segment
              if (!videoCodec || !audioCodec) {
                console.log('[probe-current-media] Codecs still missing after manifest parse. Attempting segment probe...');
                try {
                  let segmentManifestText = manifestText;
                  const realUpstreamUrl = proxyUpstreamUrl || ffprobeUrl;

                  // If this is a master playlist (has #EXT-X-STREAM-INF), fetch the first sub-playlist
                  if (manifestText.includes('#EXT-X-STREAM-INF')) {
                    const subPlaylistLines = manifestText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                    if (subPlaylistLines.length > 0) {
                      let subPlaylistUrl = subPlaylistLines[0].trim();
                      if (!subPlaylistUrl.startsWith('http')) {
                        const baseUrl = realUpstreamUrl.substring(0, realUpstreamUrl.lastIndexOf('/') + 1);
                        subPlaylistUrl = baseUrl + subPlaylistUrl;
                      }
                      console.log('[probe-current-media] Fetching sub-playlist for segment probe:', subPlaylistUrl.substring(0, 100));
                      const subProxyUrl = proxyUpstreamUrl
                        ? `${new URL(url).origin}/proxy?url=${encodeURIComponent(subPlaylistUrl)}`
                        : subPlaylistUrl;
                      const subResp = await fetcher(subProxyUrl, {
                        method: 'GET',
                        headers: probeHeaders,
                        signal: AbortSignal.timeout(8000)
                      });
                      segmentManifestText = await subResp.text();
                    }
                  }

                  // Find a .ts segment URL from the (sub-)playlist
                  const segmentLines = segmentManifestText.split('\n').filter(l => {
                    const trimmed = l.trim();
                    return trimmed && !trimmed.startsWith('#') && /\.(ts|m4s|mp4|aac)(\?|$)/i.test(trimmed);
                  });

                  if (segmentLines.length > 0) {
                    // Pick a segment from the middle for better codec detection (avoid init segments)
                    const pickIdx = Math.min(Math.floor(segmentLines.length / 2), segmentLines.length - 1);
                    let segmentUrl = segmentLines[pickIdx].trim();
                    if (!segmentUrl.startsWith('http')) {
                      // Resolve relative to the sub-playlist or manifest URL
                      const resolveBase = realUpstreamUrl.substring(0, realUpstreamUrl.lastIndexOf('/') + 1);
                      segmentUrl = resolveBase + segmentUrl;
                    }
                    // Probe segment through proxy for auth headers
                    const segProxyUrl = proxyUpstreamUrl
                      ? `${new URL(url).origin}/proxy?url=${encodeURIComponent(segmentUrl)}`
                      : segmentUrl;
                    console.log('[probe-current-media] Probing segment:', segmentUrl.substring(0, 100));
                    const segResult = await probeMediaUrl(segProxyUrl, {});
                    if (segResult?.streams?.length > 0) {
                      const segVideo = segResult.streams.find(s => s.codec_type === 'video');
                      const segAudio = segResult.streams.find(s => s.codec_type === 'audio');
                      if (segVideo?.codec_name && !videoCodec) {
                        videoCodec = segVideo.codec_name;
                        console.log('[probe-current-media] Segment probe found video codec:', videoCodec);
                      }
                      if (segAudio?.codec_name && !audioCodec) {
                        audioCodec = segAudio.codec_name;
                        console.log('[probe-current-media] Segment probe found audio codec:', audioCodec);
                      }
                      if (!fps && segVideo?.r_frame_rate) {
                        const fParts = segVideo.r_frame_rate.split('/');
                        if (fParts.length === 2 && parseInt(fParts[1], 10) > 0) {
                          fps = Math.round((parseInt(fParts[0], 10) / parseInt(fParts[1], 10)) * 100) / 100;
                        }
                      }
                    }
                  }
                } catch (segErr) {
                  console.warn('[probe-current-media] Segment probe fallback error:', segErr?.message || segErr);
                }
              }
            }
          }
        } catch (hlsErr) {
          console.error('[probe-current-media] HLS manifest fallback error:', hlsErr?.message || hlsErr);
        }
      }

      // For local files, use fs.stat; for remote, try HEAD request
      if (!fileSize) {
        if (isLocal) {
          try {
            const fs = require('fs');
            const stat = fs.statSync(realUrl);
            fileSize = stat.size || null;
          } catch { }
        } else {
          try {
            const fetcher = session?.defaultSession?.fetch
              ? session.defaultSession.fetch.bind(session.defaultSession)
              : net?.fetch ? net.fetch.bind(net) : null;
            if (fetcher) {
              const headUrl = proxyUpstreamUrl || realUrl;
              const resp = await fetcher(headUrl, { method: 'HEAD', headers: probeHeaders, signal: AbortSignal.timeout(6000) });
              const cl = resp.headers.get('content-length');
              if (cl && parseInt(cl, 10) > 0) fileSize = parseInt(cl, 10);
            }
          } catch { }
        }
      }

      return {
        format: result?.format?.format_name || (isHlsUrl ? 'hls' : null),
        videoCodec: videoCodec,
        audioCodec: audioCodec,
        fileSize: fileSize || null,
        fps: fps,
        bitrate: bitrate,
      };
    } catch (err) {
      console.error('[probe-current-media] Error:', err);
      return null;
    }
  });

  const isUnambiguousMediaUrl = (url, isFromPlaylist = false) => {
    const lower = String(url || '').toLowerCase();
    // If it comes directly from an IPTV playlist, treat .m3u8 as direct media (HLS)
    if (isFromPlaylist && /\.m3u8(?:$|\?|#)/i.test(lower)) {
      return true;
    }
    // Otherwise m3u8 is explicitly excluded because it can be a direct stream OR a playlist
    return /\.(mp4|mkv|webm|avi|mov|mpd|ts|m4v|flv)(?:$|\?|#)/i.test(lower);
  };

  const isPotentialBinaryMediaUrl = (url) => {
    const lower = String(url || '').toLowerCase();
    return /\.(mp4|mkv|webm|avi|mov|m3u8|mpd|ts|m4v|flv)(?:$|\?|#)/i.test(lower);
  };

  async function checkDirectMediaHeaders(urlStr, headers = {}) {
    const electronFetch = session?.defaultSession?.fetch
      ? session.defaultSession.fetch.bind(session.defaultSession)
      : net?.fetch
        ? net.fetch.bind(net)
        : null;

    if (!electronFetch) return null;

    const ua = headers['User-Agent'] || headers['user-agent'] || DESKTOP_USER_AGENT;
    const referer = headers['Referer'] || headers['referer'] || '';
    const cookie = headers['Cookie'] || headers['cookie'] || '';

    const analyzeResponse = (res) => {
      if (!res || res.status >= 400) return null;
      const contentType = String(res.headers.get('content-type') || '').toLowerCase();
      const contentDisposition = String(res.headers.get('content-disposition') || '').toLowerCase();

      const isMediaMime = contentType.startsWith('video/') ||
        contentType.startsWith('audio/') ||
        contentType.includes('mpegurl') ||
        contentType.includes('x-mpegurl') ||
        contentType.includes('dash') ||
        contentType.includes('mpd') ||
        contentType.includes('application/octet-stream');

      if (!isMediaMime) return null;

      const hasMediaExtension = /\.(mp4|mkv|webm|avi|mov|m3u8|mpd|ts)/i.test(urlStr) ||
        /\.(mp4|mkv|webm|avi|mov|m3u8|mpd|ts)/i.test(contentDisposition);

      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        return null;
      }

      return {
        contentType,
        contentLength: res.headers.get('content-length') || null,
        contentDisposition
      };
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const fetchHeaders = { 'User-Agent': ua, 'Referer': referer };
      if (cookie) fetchHeaders['Cookie'] = cookie;
      const res = await electronFetch(urlStr, {
        method: 'HEAD',
        headers: fetchHeaders,
        signal: controller.signal
      });
      clearTimeout(timeout);
      const result = analyzeResponse(res);
      if (result) return result;
    } catch (err) {
      console.log(`[SMART-PROBE][HEAD] Failed/timed out for ${urlStr}: ${err.message}`);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const getHeaders = {
        'User-Agent': ua,
        'Referer': referer,
        'Range': 'bytes=0-0'
      };
      if (cookie) getHeaders['Cookie'] = cookie;
      const res = await electronFetch(urlStr, {
        method: 'GET',
        headers: getHeaders,
        signal: controller.signal
      });
      clearTimeout(timeout);
      const result = analyzeResponse(res);
      if (result) return result;
    } catch (err) {
      console.log(`[SMART-PROBE][GET-RANGE] Failed/timed out for ${urlStr}: ${err.message}`);
    }

    return null;
  }

  ipcMain.on('set-downloader-proxy', (event, proxyUrl) => {
    process.env.aether_DOWNLOADER_PROXY = (proxyUrl || '').trim();
    console.log('[SYSTEM] Updated custom downloader proxy to:', process.env.aether_DOWNLOADER_PROXY || 'none');
  });

  let activeFetchId = 0;

  ipcMain.on('fetch-online-video', async (event, payload) => {
    const fetchId = ++activeFetchId;
    const isObj = payload && typeof payload === 'object';
    const rawUrl = isObj ? payload.url : payload;
    const customReferer = isObj ? payload.referer : null;
    const iptvHttpHeaders = (isObj && payload.httpHeaders && typeof payload.httpHeaders === 'object') ? payload.httpHeaders : null;
    const isFromPlaylist = isObj ? !!payload.isFromPlaylist : false;
    if (iptvHttpHeaders) {
      console.log('[IPTV-HEADERS] Received from renderer:', JSON.stringify(iptvHttpHeaders).substring(0, 200));
    } else {
      console.log('[IPTV-HEADERS] None received from renderer');
    }
    try { abortActiveCapture(); } catch (e) { }

    let safeUrl = normalizeManifestQueryUrl(sanitizeIncomingUrl(rawUrl));
    safeUrl = normalizeManifestQueryUrl(safeUrl);

    const parsedSafeUrl = (() => {
      try {
        return new URL(safeUrl);
      } catch {
        return null;
      }
    })();
    const safeHost = parsedSafeUrl?.hostname?.toLowerCase() || '';

    // ── Smart Universal Probe ──
    const isExcludedHost = parsedSafeUrl && (
      isDrivePlaybackLike(safeUrl) ||
      isPixeldrainRequest(safeUrl) ||
      safeHost.includes('youtube.com') ||
      safeHost.includes('youtu.be') ||
      safeHost.includes('google.com')
    );

    if (parsedSafeUrl && !isExcludedHost) {
      let isDirectMedia = false;
      let confirmedMimeType = '';

      if (isUnambiguousMediaUrl(safeUrl, isFromPlaylist)) {
        console.log(`[SMART-PROBE] Fast path for unambiguous media extension: ${safeUrl}`);
        const isDash = /\.mpd(?:$|\?|#)/i.test(safeUrl);
        const isHls = /\.m3u8(?:$|\?|#)/i.test(safeUrl);

        const probeHeadersInput = { 'User-Agent': DESKTOP_USER_AGENT };
        if (customReferer) probeHeadersInput['Referer'] = customReferer;
        if (iptvHttpHeaders) {
          if (iptvHttpHeaders['user-agent']) probeHeadersInput['User-Agent'] = iptvHttpHeaders['user-agent'];
          if (iptvHttpHeaders['referer']) probeHeadersInput['Referer'] = iptvHttpHeaders['referer'];
          if (iptvHttpHeaders['cookie']) probeHeadersInput['Cookie'] = iptvHttpHeaders['cookie'];
        }

        sendMediaReady(event, maybeProxifyPayload({
          url: safeUrl,
          audioUrl: null,
          title: 'Direct Stream',
          selectedQuality: 'Source',
          proxyHeaders: probeHeadersInput,
          isStreamingManifest: isDash || isHls,
          isHls: isHls,
          isDash: isDash,
          format: isDash ? 'DASH' : isHls ? 'HLS' : 'WEB',
          qualities: [{ label: 'Source', value: safeUrl, proxyHeaders: probeHeadersInput, format: isDash ? 'DASH' : isHls ? 'HLS' : 'WEB' }]
        }));
        return;
      }

      if (isPotentialBinaryMediaUrl(safeUrl)) {
        isDirectMedia = true;
      } else {
        console.log(`[SMART-PROBE] URL does not match binary extension. Performing fast header check: ${safeUrl}`);
        const checkHeaders = { 'User-Agent': DESKTOP_USER_AGENT };
        if (customReferer) checkHeaders['Referer'] = customReferer;
        // Merge IPTV headers for the fast check
        if (iptvHttpHeaders) {
          if (iptvHttpHeaders['user-agent']) checkHeaders['User-Agent'] = iptvHttpHeaders['user-agent'];
          if (iptvHttpHeaders['referer']) checkHeaders['Referer'] = iptvHttpHeaders['referer'];
          if (iptvHttpHeaders['cookie']) checkHeaders['Cookie'] = iptvHttpHeaders['cookie'];
        }
        const headerInfo = await checkDirectMediaHeaders(safeUrl, checkHeaders);
        if (headerInfo) {
          console.log(`[SMART-PROBE] Confirmed media via headers: ${headerInfo.contentType}`);
          isDirectMedia = true;
          confirmedMimeType = headerInfo.contentType;
        }
      }

      if (isDirectMedia) {
        try {
          console.log(`[SMART-PROBE] Checking if direct media: ${safeUrl}`);
          const probeHeadersInput = { 'User-Agent': DESKTOP_USER_AGENT };
          if (customReferer) probeHeadersInput['Referer'] = customReferer;
          // Merge IPTV playlist headers (cookie, user-agent, referer) into probe
          if (iptvHttpHeaders) {
            if (iptvHttpHeaders['user-agent']) probeHeadersInput['User-Agent'] = iptvHttpHeaders['user-agent'];
            if (iptvHttpHeaders['referer']) probeHeadersInput['Referer'] = iptvHttpHeaders['referer'];
            if (iptvHttpHeaders['cookie']) probeHeadersInput['Cookie'] = iptvHttpHeaders['cookie'];
          }
          const probeResult = await probeMediaUrl(safeUrl, probeHeadersInput);

          // Build proxyHeaders from customReferer + iptvHttpHeaders
          const probeHeaders = {};
          if (customReferer) {
            probeHeaders['user-agent'] = DESKTOP_USER_AGENT;
            probeHeaders['referer'] = customReferer;
          }
          if (iptvHttpHeaders) {
            Object.assign(probeHeaders, iptvHttpHeaders);
          }

          if (probeResult) {
            console.log(`[SMART-PROBE] Confirmed media: ${probeResult.format.format_name}`);
            const videoStream = probeResult.streams.find(s => s.codec_type === 'video');
            const resLabel = (videoStream && videoStream.height) ? `${videoStream.height}p` : 'Source';

            const formatName = String(probeResult.format.format_name || '').toLowerCase();
            const isHls = formatName.includes('hls') || /\.m3u8(?:$|\?|#)/i.test(safeUrl) || confirmedMimeType.includes('mpegurl');
            const isDash = formatName.includes('dash') || /\.mpd(?:$|\?|#)/i.test(safeUrl) || confirmedMimeType.includes('dash') || confirmedMimeType.includes('mpd');

            const audioStream = probeResult.streams.find(s => s.codec_type === 'audio');
            const videoCodec = videoStream ? videoStream.codec_name : null;
            const audioCodec = audioStream ? audioStream.codec_name : null;
            const formatSize = probeResult.format.size ? parseInt(probeResult.format.size, 10) : null;
            const trueFormat = probeResult.format.format_name || (isHls ? 'HLS' : (isDash ? 'DASH' : 'WEB'));

            sendMediaReady(event, maybeProxifyPayload({
              url: safeUrl,
              audioUrl: null,
              title: 'Direct Stream',
              selectedQuality: resLabel,
              proxyHeaders: probeHeaders,
              isStreamingManifest: isHls || isDash,
              isHls: isHls,
              isDash: isDash,
              format: trueFormat,
              fileSize: formatSize,
              videoCodec: videoCodec,
              audioCodec: audioCodec,
              qualities: [{ label: resLabel, value: safeUrl, proxyHeaders: probeHeaders, format: trueFormat, videoCodec, audioCodec }]
            }));
            return;
          } else if (!/\.(m3u8|m3u)(?:$|\?|#)/i.test(safeUrl) && (confirmedMimeType || isDirectMedia)) {
            // Fallback: ffprobe failed or returned null, but fast headers or extension confirmed it is a direct media stream!
            // We play it directly rather than falling back to browser/scraping layers which would fail.
            console.log(`[SMART-PROBE] ffprobe failed but headers or extension confirmed media. Playing direct stream fallback.`);
            const isHls = confirmedMimeType.includes('mpegurl') || /\.m3u8(?:$|\?|#)/i.test(safeUrl);
            const isDash = confirmedMimeType.includes('dash') || confirmedMimeType.includes('mpd') || /\.mpd(?:$|\?|#)/i.test(safeUrl);

            sendMediaReady(event, maybeProxifyPayload({
              url: safeUrl,
              audioUrl: null,
              title: 'Direct Stream',
              selectedQuality: 'Source',
              proxyHeaders: probeHeaders,
              isStreamingManifest: isHls || isDash,
              isHls: isHls,
              isDash: isDash,
              format: isHls ? 'HLS' : (isDash ? 'DASH' : 'WEB'),
              qualities: [{ label: 'Source', value: safeUrl, proxyHeaders: probeHeaders }]
            }));
            return;
          }
        } catch (probeErr) {
          console.warn('[SMART-PROBE] Failed:', probeErr.message);
        }
      }
    }

    if (parsedSafeUrl && /\.(m3u8|m3u)(?:$|\?)/i.test(parsedSafeUrl.pathname)) {
      try {
        const playlistHeaders = pickSafeProxyHeaders({
          'user-agent': DESKTOP_USER_AGENT,
          'accept-language': 'en-US,en;q=0.9',
          accept: 'application/vnd.apple.mpegurl,application/x-mpegurl,text/plain,*/*;q=0.8',
          referer: parsedSafeUrl.origin + '/'
        }) || {};
        const playlistText = await fetchText(safeUrl, playlistHeaders, 12000);
        const directEntry = parseSingleEntryRemotePlaylist(playlistText, safeUrl);
        if (directEntry?.url) {
          sendMediaReady(event, maybeProxifyPayload({
            url: directEntry.url,
            audioUrl: null,
            title: directEntry.title || 'Online Video'
          }));
          return;
        }
      } catch {
        // Ignore and continue with existing flow.
      }
    }

    // Adult site and restricted host checks removed to default to generic capture engine.

    const pixelDrainPayload = resolvePixelDrainDirectUrl(safeUrl);
    if (pixelDrainPayload?.url || isPixeldrainRequest(safeUrl)) {
      const fileId = getPixelDrainFileId(safeUrl);
      if (fileId) {
        // Only clear Playwright result cache (cheap, forces fresh CDN resolution).
        // Do NOT clear cookies, domain cookies, CDN cookies, active streams, or
        // session cookies here – that would kill the currently-playing video stream
        // if the user is loading a second Pixeldrain URL (e.g. a folder) while a
        // single-file video is still playing.
        pixelDrainPlaywrightCache.clear();
        // Clear the priming cookie only for the NEW fileId so it re-primes fresh.
        pixelDrainCookieStore.delete(fileId);

        let requestedVariant = 'api';
        try {
          const parsedPixelDrainUrl = new URL(String(safeUrl || ''));
          const pixelDrainParts = parsedPixelDrainUrl.pathname.split('/').filter(Boolean);
          if (['d', 'l'].includes(pixelDrainParts[0]) && pixelDrainParts[1]) {
            console.log(`[PIXELDRAIN] Testing if /d/ link is direct media using ffprobe...`);
            const probeUrl = `https://pixeldrain.com/api/file/${fileId}`;
            const probeResult = await probeMediaUrl(probeUrl, { 'User-Agent': DESKTOP_USER_AGENT });

            if (probeResult) {
              console.log(`[PIXELDRAIN] ffprobe confirmed direct media! Playing as file instead of folder.`);
              requestedVariant = 'api';
              safeUrl = `https://pixeldrain.com/u/${fileId}`;
            } else {
              console.log(`[PIXELDRAIN] ffprobe failed (likely a folder). Fetching IDs using filesystem variant.`);
              requestedVariant = 'filesystem';
            }
          }
        } catch {
          // Keep the default variant.
        }

        const proxyFallbackUrl = buildPixelDrainLocalVariantStreamUrl(fileId, requestedVariant);

        // ── Folder/Album shortcut: skip CDN + Playwright, go straight to filesystem proxy ──
        if (requestedVariant === 'filesystem') {
          console.log(`[PIXELDRAIN][FOLDER-FAST] Refusing to send JSON API endpoint to video player for folder link.`);
          event.sender.send('stream-error', { message: 'URL is a Pixeldrain folder. Use the folder view.' });
          return;
        }

        // ── Fast CDN Bypass Layer ──
        try {
          const fastCdnResult = await generateEnhancedCdnLink(fileId, safeUrl);
          if (fastCdnResult?.url) {
            console.log(`[PIXELDRAIN][CDN-FAST] Found working enhanced bypass link: ${fastCdnResult.url}`);

            // Register host immediately before sending to renderer
            try {
              const fastHost = new URL(fastCdnResult.url).hostname.toLowerCase();
              pixeldrainMirrorRegistry.add(fastHost);
            } catch { }

            sendMediaReady(event, {
              url: fastCdnResult.url,
              title: `pixeldrain-${fileId}`,
              disablePreview: true,
              proxyHeaders: fastCdnResult.proxyHeaders || null,
              fallbackUrl: proxyFallbackUrl,
              retryUrls: [proxyFallbackUrl]
            });
            return;
          }
        } catch (cdnErr) {
          console.warn(`[PIXELDRAIN][CDN-FAST] Fast bypass failed:`, cdnErr.message || cdnErr);
        }

        // ── Attempt Playwright extraction for direct native CDN playback ──
        // fetchPixelDrainWithPlaywright will also sync cookies into
        // session.defaultSession so Chromium can play the CDN URL directly.
        let playwrightResult = null;
        try {
          playwrightResult = await fetchPixelDrainWithPlaywright(fileId);
        } catch (pwErr) {
          console.warn(`[PIXELDRAIN] Playwright extraction failed for ${fileId}:`, pwErr.message || pwErr);
        }

        if (playwrightResult?.url) {
          // Direct CDN URL — Chromium will handle byte-range/seeking natively
          console.log(`[PIXELDRAIN][CDN-DIRECT] Sending direct CDN URL for native playback: ${playwrightResult.url}`);
          sendMediaReady(event, {
            url: playwrightResult.url,
            title: playwrightResult.title || `pixeldrain-${fileId}`,
            disablePreview: true,
            fallbackUrl: proxyFallbackUrl,
            retryUrls: [proxyFallbackUrl],
            subtitles: playwrightResult.subtitles || []
          });
          return;
        }

        // Playwright failed or unavailable — fall back to the local proxy
        console.log(`[PIXELDRAIN][PROXY-FALLBACK] route=${safeUrl} variant=${requestedVariant} primary=${proxyFallbackUrl}`);
        sendMediaReady(event, {
          url: proxyFallbackUrl,
          title: `pixeldrain-${fileId}`,
          disablePreview: true,
          fallbackUrl: null,
          retryUrls: []
        });
        return;
      }

      console.log(`[PIXELDRAIN][BYPASS] No resolvable fileId for ${safeUrl}; skipping provider and Playwright fallbacks`);
      event.reply('stream-error', {
        message: 'Unable to resolve this Pixeldrain link.'
      });
      return;
    }

    const driveId = extractDriveIdFromUrl(safeUrl);

    const directPayload = resolveDirectMediaUrl(safeUrl);
    if (directPayload?.url) {
      sendMediaReady(event, {
        ...maybeProxifyPayload(directPayload),
        fallbackUrl: driveId ? maybeProxifyUrl(getDriveFallbackUrl(driveId)) : null
      });
      return;
    }

    // Drive fallback logic has been merged into the YouTube handler

    // ── Mega.nz standalone resolution ──
    if (megaProvider.matchesPage(safeUrl)) {
      try {
        const megaResult = await megaProvider.resolveStandalone({ pageUrl: safeUrl, event });
        if (megaResult?.url) {
          sendMediaReady(event, maybeProxifyPayload(megaResult));
          return;
        }
      } catch (error) {
        console.warn('[mega-provider] Standalone resolution failed, falling back to generic flow:', error?.message || error);
      }
    }

    // ── Direct YouTube & Google Drive handler — bypasses Playwright entirely ──────────
    const isDriveUrl = (isDrivePlaybackLike(safeUrl) || isDriveLikeUrl(safeUrl)) && driveId;
    const isYoutubeUrl = safeHost.includes('youtube.com') || safeHost.includes('youtu.be') || isDriveUrl;
    if (isYoutubeUrl) {
      try {
        const extractionUrl = isDriveUrl ? `https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view` : safeUrl;
        console.log(`[YOUTUBE-DIRECT] Extracting via yt-dlp: ${extractionUrl}`);
        const ytOutput = await extractYoutubeInfo(extractionUrl);
        if (fetchId !== activeFetchId) return;

        youtubeSession = buildYoutubeSession(ytOutput);
        youtubeSession.pageUrl = safeUrl;
        const selected = youtubeSession.selected;
        const startupSelected = youtubeSession.startupSelected || selected;

        if (startupSelected?.url) {
          // Attempt to extract ranges for startup video and primary audio to use DASH
          const primaryAudio = youtubeSession.audioFormat;
          const isMuxedStartup = startupSelected.audioCodec && startupSelected.audioCodec !== 'none';
          let useDash = false;
          let dashVideoFormat = startupSelected; // the format we'll use for the DASH video track

          if (isMuxedStartup && primaryAudio) {
            // ── Muxed startup but adaptive formats available (Google Drive) ──
            const targetHeight = startupSelected.height || 1080;
            const videoOnlyFormats = youtubeSession.qualities.filter(
              (q) => !q.hasAudio && !q.isManifestBacked && q.url && q.formatId
            );
            // Prefer exact height match, then closest
            let bestAdaptive = videoOnlyFormats.find((q) => q.height === targetHeight);
            if (!bestAdaptive) {
              bestAdaptive = [...videoOnlyFormats]
                .sort((a, b) => Math.abs(a.height - targetHeight) - Math.abs(b.height - targetHeight))[0];
            }

            if (bestAdaptive) {
              dashVideoFormat = bestAdaptive;
              console.log(`[YOUTUBE-DIRECT] Muxed startup detected. Switching to adaptive format ${dashVideoFormat.formatId} (${dashVideoFormat.height}p) for DASH`);
              try {
                console.log('[YOUTUBE-DIRECT] Resolving adaptive stream ranges in parallel for DASH...');
                const isVideoWebm = dashVideoFormat.ext === 'webm' || (dashVideoFormat.codec || '').toLowerCase().includes('vp9') || (dashVideoFormat.codec || '').toLowerCase().includes('av01');
                const isAudioWebm = primaryAudio.ext === 'webm';

                const [videoRanges, audioRanges] = await Promise.all([
                  extractFormatRanges(dashVideoFormat.url, isVideoWebm, dashVideoFormat.proxyHeaders),
                  extractFormatRanges(primaryAudio.url, isAudioWebm, primaryAudio.proxyHeaders || dashVideoFormat.proxyHeaders)
                ]);

                if (videoRanges && audioRanges) {
                  dashVideoFormat.initRange = videoRanges.initRange;
                  dashVideoFormat.indexRange = videoRanges.indexRange;
                  primaryAudio.initRange = audioRanges.initRange;
                  primaryAudio.indexRange = audioRanges.indexRange;
                  useDash = true;
                }
              } catch (rangeErr) {
                console.warn('[YOUTUBE-DIRECT] Failed to resolve adaptive ranges:', rangeErr.message);
              }
            } else {
              console.warn('[YOUTUBE-DIRECT] No video-only adaptive formats found, falling back to progressive.');
            }
          } else if (primaryAudio && !isMuxedStartup) {
            // ── Separate video + audio (standard YouTube) ──
            dashVideoFormat = startupSelected;
            try {
              console.log('[YOUTUBE-DIRECT] Resolving startup stream ranges in parallel for DASH...');
              const isVideoWebm = dashVideoFormat.ext === 'webm' || (dashVideoFormat.codec || '').toLowerCase().includes('vp9') || (dashVideoFormat.codec || '').toLowerCase().includes('av01');
              const isAudioWebm = primaryAudio.ext === 'webm';

              const [videoRanges, audioRanges] = await Promise.all([
                extractFormatRanges(dashVideoFormat.url, isVideoWebm, dashVideoFormat.proxyHeaders),
                extractFormatRanges(primaryAudio.url, isAudioWebm, primaryAudio.proxyHeaders || dashVideoFormat.proxyHeaders)
              ]);

              if (videoRanges && audioRanges) {
                dashVideoFormat.initRange = videoRanges.initRange;
                dashVideoFormat.indexRange = videoRanges.indexRange;
                primaryAudio.initRange = audioRanges.initRange;
                primaryAudio.indexRange = audioRanges.indexRange;
                useDash = true;
              }
            } catch (rangeErr) {
              console.warn('[YOUTUBE-DIRECT] Failed to resolve startup ranges in parallel:', rangeErr.message);
            }
          } else {
            // ── No separate audio at all — try muxed DASH as last resort ──
            try {
              console.log('[YOUTUBE-DIRECT] No separate audio. Resolving muxed stream ranges for DASH...');
              const isVideoWebm = startupSelected.ext === 'webm' || (startupSelected.codec || '').toLowerCase().includes('vp9') || (startupSelected.codec || '').toLowerCase().includes('av01');
              const videoRanges = await extractFormatRanges(startupSelected.url, isVideoWebm, startupSelected.proxyHeaders);

              if (videoRanges && videoRanges.initRange && videoRanges.indexRange) {
                startupSelected.initRange = videoRanges.initRange;
                startupSelected.indexRange = videoRanges.indexRange;
                dashVideoFormat = startupSelected;
                useDash = true;
                console.log('[YOUTUBE-DIRECT] Muxed DASH ranges resolved:', JSON.stringify(videoRanges));
              } else {
                console.warn('[YOUTUBE-DIRECT] Muxed stream has no sidx box — cannot use DASH, falling back to progressive.');
              }
            } catch (rangeErr) {
              console.warn('[YOUTUBE-DIRECT] Failed to resolve muxed stream ranges:', rangeErr.message);
            }
          }

          if (useDash) {
            youtubeSession.useDash = true;
            const dashUrl = `${mediaServerOrigin}/youtube-dash.mpd?session=${activeFetchId}&quality=${startupSelected.formatId}`;
            console.log('[YOUTUBE-DIRECT] DASH Flow Ready. Manifest:', dashUrl);

            const payload = maybeProxifyPayload({
              url: dashUrl,
              audioUrl: null,
              audioTracks: youtubeSession.audioTracks || [],
              title: youtubeSession.title,
              isLive: youtubeSession.isLive,
              selectedQuality: startupSelected.formatId,
              preferredQuality: selected?.formatId || startupSelected.formatId,
              transport: 'dash-manifest',
              proxyHeaders: null,
              qualities: youtubeSession.qualities.map((entry) => ({
                label: entry.label,
                value: entry.formatId,
                audioUrl: null,
                format: (entry.ext || '').toUpperCase(),
                proxyHeaders: null
              }))
            });

            console.log('[YOUTUBE-DIRECT] Success (DASH):', youtubeSession.title);
            event.reply('youtube-stream-ready', payload);
            return;
          }

          // Fallback: Direct progressive separate video and audio streams
          console.log('[YOUTUBE-DIRECT] Falling back to separate progressive streams');
          const payload = maybeProxifyPayload({
            url: startupSelected.url,
            audioUrl: startupSelected.audioUrl,
            audioTracks: youtubeSession.audioTracks || [],
            title: youtubeSession.title,
            isLive: youtubeSession.isLive,
            selectedQuality: startupSelected.formatId,
            preferredQuality: selected?.formatId || startupSelected.formatId,
            transport: startupSelected.transport || 'direct',
            proxyHeaders: startupSelected.proxyHeaders || null,
            qualities: youtubeSession.qualities.map((entry) => ({
              label: entry.label,
              value: entry.formatId,
              audioUrl: entry.audioUrl,
              format: (entry.ext || '').toUpperCase(),
              proxyHeaders: entry.proxyHeaders || null
            }))
          });

          console.log('[YOUTUBE-DIRECT] Success:', youtubeSession.title, '| qualities:', youtubeSession.qualities.length);
          event.reply('youtube-stream-ready', payload);
          return;
        }

        console.warn('[YOUTUBE-DIRECT] No playable format found, falling back to generic flow.');
      } catch (ytErr) {
        console.warn('[YOUTUBE-DIRECT] yt-dlp extraction failed:', ytErr.message || ytErr);
        // Fall through to generic Playwright/yt-dlp flow
      }
    }

    const shouldTryYtDlpFirst = isYtdlpSupportedSiteUrl(safeUrl) && !safeHost.includes('youtube.com') && !safeHost.includes('youtu.be');
    if (shouldTryYtDlpFirst) {
      try {
        console.log('[FAST-PATH] URL is a yt-dlp supported site. Attempting fast-path extraction:', safeUrl);
        const output = await extractWithRetries(safeUrl);
        if (output) {
          const payload = maybeProxifyPayload(
            isDriveLikeUrl(safeUrl) ? buildDriveStreamPayload(output) : buildOnlineStreamPayload(output)
          );
          if (payload?.url) {
            const qualities = buildOnlineQualities(output);
            if (qualities.length > 0) {
              const proxiedQualities = qualities.map((entry) => ({
                ...entry,
                value: maybeProxifyUrl(entry.value || entry.videoUrl, entry.proxyHeaders || payload.proxyHeaders || null),
                videoUrl: maybeProxifyUrl(entry.videoUrl || entry.value, entry.proxyHeaders || payload.proxyHeaders || null),
                audioUrl: maybeProxifyUrl(entry.audioUrl, entry.audioProxyHeaders || entry.proxyHeaders || payload.audioProxyHeaders || payload.proxyHeaders || null),
              }));
              payload.qualities = proxiedQualities;
              payload.selectedQuality = proxiedQualities[0].value || proxiedQualities[0].videoUrl;
            }
            console.log('[FAST-PATH] Fast-path extraction succeeded.');
            sendMediaReady(event, payload);
            return;
          }
        }
      } catch (fastErr) {
        console.log('[FAST-PATH] Fast-path extraction failed, falling back to generic flow:', fastErr.message || fastErr);
      }
    }

    if (!directPayload && !isDrivePlaybackLike(safeUrl)) {
      try {
        console.log('Attempting generic Playwright extraction for:', safeUrl);
        const playwrightResult = await fetchMainPlayableVideoUrl(safeUrl, (msg) => {
          try { event.reply('capture-progress', { message: msg }); } catch { }
        }, 0, customReferer);
        if (playwrightResult?.url) {
          const cookieAwareProxyHeaders = buildProxyHeadersWithCookies(
            playwrightResult.proxyHeaders || null,
            playwrightResult.cookieString || null
          );

          const browserCapturedHeaders = playwrightResult.browserCapturedHeaders || {};
          const cookieAwareQualityHeaders = Object.fromEntries(
            Object.entries(playwrightResult.qualityHeaders || {}).map(([url, headers]) => [
              url,
              buildProxyHeadersWithCookies(
                {
                  ...(headers || {}),
                  ...(browserCapturedHeaders?.[url] || {})
                },
                playwrightResult.cookieString || null
              )
            ])
          );

          const preferredPlayable = pickPreferredPlayableUrlFromPlaywrightResult({
            ...playwrightResult,
            proxyHeaders: cookieAwareProxyHeaders,
            qualityHeaders: cookieAwareQualityHeaders
          });

          const selectedRawUrl = String(preferredPlayable?.url || playwrightResult.url || '').trim();
          const selectedRawHeaders = buildProxyHeadersWithCookies(
            {
              ...(preferredPlayable?.headers || cookieAwareProxyHeaders || {}),
              ...(browserCapturedHeaders?.[selectedRawUrl] || {})
            },
            playwrightResult.cookieString || null
          ) || null;
          console.log('[PLAYWRIGHT][SELECTED-PLAYABLE]', {
            preferred: selectedRawUrl,
            source: preferredPlayable?.source || 'primary',
            isManifest: isLikelyManifestUrl(selectedRawUrl),
            isAv1: isLikelyAv1Url(selectedRawUrl)
          });

          const finalUrl = maybeProxifyUrl(selectedRawUrl, selectedRawHeaders);
          const proxiedQualities = Array.isArray(playwrightResult.qualities)
            ? playwrightResult.qualities.map((entry) => {
              const rawEntryUrl = String(entry?.value || entry?.videoUrl || entry?.url || '').trim();
              const rawLabel = String(entry?.label || 'undefined');
              return {
                ...entry,
                label: rawLabel,
                originalValue: rawEntryUrl,
                value: maybeProxifyUrl(
                  rawEntryUrl,
                  cookieAwareQualityHeaders?.[rawEntryUrl] || cookieAwareProxyHeaders || null
                )
              };
            })
            : playwrightResult.qualities;
          const selectedQualityValue = Array.isArray(proxiedQualities)
            ? (proxiedQualities.find((entry) => entry.value === finalUrl)?.value ||
              proxiedQualities.find((entry) => entry.label === (playwrightResult.qualities || []).find((q) => String(q.value || q.videoUrl || q.url || '') === selectedRawUrl)?.label)?.value ||
              'undefined')
            : 'undefined';


          const proxiedAlbumFiles = Array.isArray(playwrightResult.albumFiles)
            ? playwrightResult.albumFiles.map((file, idx) => {
              const rawFileUrl = String(file.url || '').trim();
              const fileHeaders = buildProxyHeadersWithCookies(
                {
                  ...(file.proxyHeaders || playwrightResult.proxyHeaders || {}),
                  ...(playwrightResult.browserCapturedHeaders?.[rawFileUrl] || {})
                },
                playwrightResult.cookieString || null
              );
              return {
                id: file.id || String(idx),
                name: file.name || `File ${idx + 1}`,
                url: maybeProxifyUrl(rawFileUrl, fileHeaders),
                originalUrl: rawFileUrl,
                proxyHeaders: fileHeaders
              };
            })
            : null;

          sendMediaReady(event, {
            url: finalUrl,
            title: playwrightResult.title,
            qualities: proxiedQualities,
            selectedQuality: selectedQualityValue,
            proxyHeaders: selectedRawHeaders,
            qualityHeaders: cookieAwareQualityHeaders,
            proxyConfig: playwrightResult.proxyConfig || null,
            cookies: playwrightResult.cookies || null,
            cookieString: playwrightResult.cookieString || null,
            segmentHeaders: playwrightResult.segmentHeaders || null,
            albumFiles: proxiedAlbumFiles,
            albumName: playwrightResult.albumName,
            isStreamingManifest: !!preferredPlayable?.url && isLikelyManifestUrl(selectedRawUrl) ? true : !!playwrightResult.isStreamingManifest,
            isHls: !!preferredPlayable?.url && /\.m3u8(?:$|\?|#)/i.test(selectedRawUrl) ? true : !!playwrightResult.isHls,
            isDash: !!preferredPlayable?.url && /\.mpd(?:$|\?|#)/i.test(selectedRawUrl) ? true : !!playwrightResult.isDash,
            isLive: !!playwrightResult.isLive,
            format: (() => {
              if (/\.m3u8(?:$|\?|#)/i.test(selectedRawUrl) || playwrightResult.isHls) return 'HLS';
              if (/\.mpd(?:$|\?|#)/i.test(selectedRawUrl) || playwrightResult.isDash) return 'DASH';
              if (/[\?&]download[=&]|\/download[\/&?]|(?:^|&)download(?:&|$)/i.test(selectedRawUrl)) return 'DL';

              const lowerUrl = selectedRawUrl.toLowerCase();
              if (lowerUrl.includes('.mp4')) return 'AVC';
              if (lowerUrl.includes('.webm')) return 'VP9';
              if (lowerUrl.includes('.mkv')) return 'MKV';

              return 'WEB';
            })(),
            sourcePageUrl: playwrightResult.sourcePageUrl || safeUrl,
            mediaOrigin: playwrightResult.mediaOrigin || null,
            baseMediaUrl: playwrightResult.baseMediaUrl || null,
            subtitles: playwrightResult.subtitles || [],
            defaultSubtitleUrl: playwrightResult.defaultSubtitleUrl || null,
            drmKeys: playwrightResult.drmKeys || null
          });
          return;
        }
      } catch (error) {
        console.warn('Generic Playwright failed:', error.message || error);
      }
    }

    if (fetchId !== activeFetchId) return;

    try {
      console.log('Resolving online video URL:', safeUrl);
      const output = await extractWithRetries(safeUrl);
      if (fetchId !== activeFetchId) return;

      const payload = maybeProxifyPayload(
        isDriveLikeUrl(safeUrl) ? buildDriveStreamPayload(output) : buildOnlineStreamPayload(output)
      );

      if (payload?.url) {
        if (isDriveLikeUrl(safeUrl)) {
          const qualities = buildDriveQualities(output);
          if (qualities.length > 0) {
            payload.qualities = qualities;
            payload.selectedQuality = qualities[0].value || qualities[0].videoUrl;
          }
        } else {
          const qualities = buildOnlineQualities(output);
          if (qualities.length > 0) {
            payload.qualities = qualities;
            payload.selectedQuality = qualities[0].value || qualities[0].videoUrl;
          }
        }

        if (Array.isArray(payload.qualities)) {
          payload.qualities = payload.qualities.map((entry) => ({
            ...entry,
            value: maybeProxifyUrl(entry.value || entry.videoUrl, entry.proxyHeaders || payload.proxyHeaders || null),
            videoUrl: maybeProxifyUrl(entry.videoUrl || entry.value, entry.proxyHeaders || payload.proxyHeaders || null),
            audioUrl: maybeProxifyUrl(entry.audioUrl, entry.audioProxyHeaders || entry.proxyHeaders || payload.audioProxyHeaders || payload.proxyHeaders || null),
          }));
          payload.selectedQuality = payload.qualities[0].value || payload.qualities[0].videoUrl;
        }

        sendMediaReady(event, payload);
      } else {
        event.reply('stream-error', {
          message: 'No playable stream found for this URL.'
        });
      }
    } catch (error) {
      if (fetchId !== activeFetchId) return;
      console.error('Online stream extraction failed:', error);
      const fallbackDirectPayload = resolveDirectMediaUrl(safeUrl);
      if (fallbackDirectPayload?.url) {
        sendMediaReady(event, {
          ...maybeProxifyPayload(fallbackDirectPayload),
          fallbackUrl: null
        });
        return;
      }

      const lines = String(error?.stderr || '').split('\n').map(l => l.trim()).filter(Boolean);
      let errorMessage = 'Unable to load this URL. It may require login/cookies or may be region-restricted.';

      // Look for a specific error line, ignoring warnings
      const errorLine = lines.find(line => line.toLowerCase().startsWith('error:'));
      if (errorLine) {
        errorMessage = errorLine.replace(/^error:\s*/i, '');
        // Clean up common yt-dlp extractor prefixes like "[youtube] xxxxx: "
        errorMessage = errorMessage.replace(/^\[[^\]]+\]\s*[^:]+:\s*/, '');
      }

      event.reply('stream-error', {
        message: errorMessage
      });
    }
  });

  ipcMain.on('set-youtube-quality', async (event, payload) => {
    try {
      const qualityId = String(payload?.qualityId || '');
      const currentTime = Number(payload?.currentTime || 0);
      let quality = youtubeSession.qualityMap[qualityId];
      if (!quality) {
        quality = youtubeSession.qualityMap[qualityId];
      }

      if (!quality?.url) {
        console.warn('Unknown quality id:', qualityId, 'Available keys:', Object.keys(youtubeSession?.qualityMap || {}));
        return;
      }

      if (youtubeSession.useDash) {
        // Resolve ranges for the newly selected format on the fly if needed
        if (!quality.initRange || !quality.indexRange) {
          try {
            console.log('[YOUTUBE-DIRECT] Resolving ranges on the fly for quality switch to:', quality.formatId);
            const isWebm = quality.ext === 'webm' || (quality.codec || '').toLowerCase().includes('vp9') || (quality.codec || '').toLowerCase().includes('av01');
            const ranges = await extractFormatRanges(quality.url, isWebm, quality.proxyHeaders);
            if (ranges) {
              quality.initRange = ranges.initRange;
              quality.indexRange = ranges.indexRange;
            }
          } catch (rangeErr) {
            console.warn('[YOUTUBE-DIRECT] Failed to resolve quality ranges on the fly:', rangeErr.message);
          }
        }

        if (quality.initRange && quality.indexRange) {
          const dashUrl = `${mediaServerOrigin}/youtube-dash.mpd?session=${activeFetchId}&quality=${quality.formatId}`;
          const responsePayload = maybeProxifyPayload({
            url: dashUrl,
            audioUrl: null,
            currentTime,
            selectedQuality: quality.formatId,
            transport: 'dash-manifest',
            proxyHeaders: null,
            title: youtubeSession.title,
            isLive: youtubeSession.isLive,
            audioTracks: youtubeSession.audioTracks || [],
            qualities: youtubeSession.qualities.map((entry) => ({
              label: entry.label,
              value: entry.formatId,
              audioUrl: null,
              format: (entry.ext || '').toUpperCase(),
              proxyHeaders: null
            }))
          });
          event.reply('youtube-quality-switched', responsePayload);
          return;
        } else {
          console.warn('[YOUTUBE-DIRECT] Quality ranges not resolvable, falling back to progressive for this quality');
        }
      }

      const responsePayload = maybeProxifyPayload({
        url: quality.url,
        audioUrl: quality.audioUrl || null,
        currentTime,
        selectedQuality: quality.formatId, // CHANGED from url to formatId
        transport: quality.transport || 'direct',
        proxyHeaders: quality.proxyHeaders || null,
        title: youtubeSession.title,
        isLive: youtubeSession.isLive,
        audioTracks: youtubeSession.audioTracks || [],
        qualities: youtubeSession.qualities.map((entry) => ({
          label: entry.label,
          value: entry.formatId, // CHANGED from url to formatId
          audioUrl: entry.audioUrl,
          format: (entry.ext || '').toUpperCase(),
          proxyHeaders: entry.proxyHeaders || null
        }))
      });

      event.reply('youtube-quality-switched', responsePayload);
    } catch (error) {
      console.error('Quality switch failed:', error);
    }
  });

  /* ─── Lazy POT resolver via YouTube InnerTube API ────────────────────
   * When a dubbed audio track has isMissingPot=true its yt-dlp URL was
   * obtained from the iOS client and will return HTTP 403 without a PO
   * token.
   *
   * Root cause of the original Playwright approach failing:
   *   ytInitialPlayerResponse.streamingData.adaptiveFormats in the HTML
   *   contains NO url fields — YouTube serves undecrypted format data in
   *   the page HTML and the JS player calls /youtubei/v1/player to get
   *   real signed URLs at runtime.
   *
   * Fix: call the InnerTube /youtubei/v1/player API directly from Node.js
   * using the WEB client context. This returns all adaptive formats with
   * real signed URLs — no browser, no Playwright, ~400 ms.
   * ─────────────────────────────────────────────────────────────────── */
  async function resolveMissingPotAudioUrl(audioTrackId) {
    // Deduplicate: if already resolving this track return the same promise.
    if (potResolutionInFlight.has(audioTrackId)) {
      return potResolutionInFlight.get(audioTrackId);
    }

    const promise = (async () => {
      const pageUrl = youtubeSession.pageUrl;
      if (!pageUrl) throw new Error('[POT] No YouTube pageUrl stored on session');

      // Extract the video ID from the stored watch URL.
      let videoId;
      try {
        const parsed = new URL(pageUrl);
        videoId = parsed.searchParams.get('v') || parsed.pathname.replace(/^\//, '');
      } catch {
        throw new Error('[POT] Cannot parse video ID from: ' + pageUrl);
      }
      if (!videoId) throw new Error('[POT] No video ID found in: ' + pageUrl);

      console.log('[POT] Calling InnerTube API for dubbed URL, videoId:', videoId, 'track:', audioTrackId);

      // ── InnerTube /youtubei/v1/player request ──────────────────────────
      // The WEB client returns adaptive formats with real signed URLs that
      // work anonymously for public videos. No authentication needed.
      const requestBody = JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240726.00.00',
            hl: 'en',
            gl: 'US',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            timeZone: 'America/New_York',
            utcOffsetMinutes: -300,
          }
        },
        playbackContext: {
          contentPlaybackContext: {
            signatureTimestamp: 20082,  // a recent working value; stable for weeks
            autoCaptionSettings: { language: 'en', translationLanguage: null },
          }
        },
        // Request all audio tracks including dubbed variants
        racyCheckOk: true,
        contentCheckOk: true,
      });

      const apiUrl = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
      const requestHeaders = {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240726.00.00',
        'Origin': 'https://www.youtube.com',
        'Referer': pageUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      };

      const responseJson = await new Promise((resolve, reject) => {
        const req = https.request(apiUrl, {
          method: 'POST',
          headers: { ...requestHeaders, 'Content-Length': Buffer.byteLength(requestBody) },
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('[POT] InnerTube response not JSON: ' + data.slice(0, 200))); }
          });
        });
        req.on('error', reject);
        req.setTimeout(15_000, () => { req.destroy(); reject(new Error('[POT] InnerTube request timed out')); });
        req.write(requestBody);
        req.end();
      });

      const adaptiveFormats = responseJson?.streamingData?.adaptiveFormats;
      if (!Array.isArray(adaptiveFormats) || adaptiveFormats.length === 0) {
        throw new Error('[POT] InnerTube returned no adaptiveFormats (status: ' + responseJson?.playabilityStatus?.status + ')');
      }

      // Filter to audio-only formats that have a real URL.
      const audioFormats = adaptiveFormats.filter(
        f => f.url && f.mimeType && f.mimeType.startsWith('audio/')
      );
      if (audioFormats.length === 0) {
        throw new Error('[POT] InnerTube returned no audio formats with signed URLs');
      }

      // audioTrackId is 'yt-audio-bn' — extract lang code.
      const langCode = String(audioTrackId || '').replace(/^yt-audio-/, '').toLowerCase();

      // Match priority:
      //   1. xtags field (encoded protobuf) contains the lang code as plain text
      //   2. audioTrack.id field (e.g. "bn.3")
      //   3. language field
      //   4. last resort: highest-quality dubbed format
      const isDubbedFormat = (f) => {
        const at = f.audioTrack || {};
        return !at.audioIsDefault && at.id && at.id !== 'en.0' && at.id !== 'und.0';
      };

      const matchByLang = (f) => {
        // xtags is a base64-encoded protobuf containing strings like "acont" "dubbed" "lang" "bn"
        // The raw bytes contain the lang code as ASCII — simplest is to search the decoded bytes
        if (f.xtags) {
          try {
            const decoded = Buffer.from(f.xtags, 'base64').toString('binary');
            if (decoded.includes(langCode)) return true;
          } catch { }
        }
        const at = f.audioTrack || {};
        if (at.id && String(at.id).toLowerCase().startsWith(langCode + '.')) return true;
        if (String(f.language || '').toLowerCase() === langCode) return true;
        return false;
      };

      const match =
        audioFormats.find(f => matchByLang(f) && isDubbedFormat(f)) ||
        audioFormats.find(f => matchByLang(f)) ||
        audioFormats.find(f => isDubbedFormat(f));  // any dubbed if lang not found

      if (!match) {
        throw new Error('[POT] InnerTube: no dubbed audio found for lang: ' + langCode);
      }

      console.log('[POT] Resolved via InnerTube for', audioTrackId,
        '— audioTrack:', match.audioTrack?.id, 'mimeType:', match.mimeType);
      return match.url;
    })();

    // Store so rapid double-clicks share the same promise; remove when settled.
    potResolutionInFlight.set(audioTrackId, promise);
    // Attach a no-op rejection handler immediately so Node does not fire
    // unhandledRejection before the caller's await can attach its own catch.
    promise.catch(() => { });
    promise.finally(() => potResolutionInFlight.delete(audioTrackId));
    return promise;
  }

  ipcMain.on('set-youtube-audio-track', async (event, payload) => {
    const audioTrackId = String(payload?.audioTrackId || '');
    const qualityId = String(payload?.qualityId || '');
    const currentTime = Number(payload?.currentTime || 0);

    try {
      let quality = youtubeSession.qualityMap[qualityId];
      if (!quality) {
        console.warn('[YT-AUDIO] Unknown quality id:', qualityId);
        return;
      }

      const audioTrack = (youtubeSession.audioTracks || []).find((t) => t.id === audioTrackId);
      if (!audioTrack) {
        console.warn('[YT-AUDIO] Unknown audio track id:', audioTrackId);
        return;
      }

      if (!quality?.url) {
        console.warn('[YT-AUDIO] Quality has no URL:', qualityId);
        return;
      }

      // ── MISSING POT: resolve live signed URL via headless Playwright ─────
      if (audioTrack.isMissingPot) {
        console.log('[YT-AUDIO] MISSING POT track — resolving via InnerTube for:', audioTrack.label);

        // Tell frontend: resolving, keep spinner going
        event.reply('youtube-audio-resolving', { audioTrackId, trackLabel: audioTrack.label });

        try {
          const resolvedUrl = await resolveMissingPotAudioUrl(audioTrackId);

          // Patch the resolved URL back into the session and clear the flag
          // so subsequent clicks go straight through without Playwright.
          audioTrack.url = resolvedUrl;
          audioTrack.isMissingPot = false;
          if (Array.isArray(audioTrack.qualities)) {
            audioTrack.qualities.forEach(q => { q.value = resolvedUrl; });
          }

          console.log('[YT-AUDIO] POT resolved — URL patched for:', audioTrack.label);
        } catch (err) {
          console.error('[YT-AUDIO] POT resolution failed:', err.message);
          event.reply('youtube-audio-unavailable', {
            reason: 'pot_resolution_failed',
            trackLabel: audioTrack.label,
            currentTime,
          });
          return;
        }
      }

      // ── Normal path (or post-resolution) ────────────────────────────────
      // Update the active audioUrl across all qualities so that a later video
      // quality switch preserves the selected dubbed audio.
      youtubeSession.qualities.forEach(q => {
        if (!q.isManifestBacked) q.audioUrl = audioTrack.url;
      });
      quality.audioUrl = audioTrack.url;

      const responsePayload = maybeProxifyPayload({
        url: quality.url,
        audioUrl: quality.audioUrl || null,
        currentTime,
        selectedQuality: quality.formatId,
        transport: quality.transport || 'direct',
        proxyHeaders: quality.proxyHeaders || null,
        title: youtubeSession.title,
        isLive: youtubeSession.isLive,
        audioTracks: youtubeSession.audioTracks || [],
        qualities: youtubeSession.qualities.map((entry) => ({
          label: entry.label,
          value: entry.formatId,
          audioUrl: entry.audioUrl,
          format: (entry.ext || '').toUpperCase(),
          proxyHeaders: entry.proxyHeaders || null
        }))
      });

      event.reply('youtube-quality-switched', responsePayload);
    } catch (error) {
      console.error('[YT-AUDIO] Audio track switch failed:', error);
      event.reply('youtube-audio-unavailable', {
        reason: 'unexpected_error',
        trackLabel: audioTrackId,
        currentTime,
      });
    }
  });
}

app.whenReady().then(async () => {
  // 1. Initialize AdBlocker (instant — loads from local bundled/cached files, no network)
  try {
    await adBlockManager.initialize();
    await adBlockManager.enableInElectron(session.defaultSession);
  } catch (err) {
    console.error('[SYSTEM] AdBlock initialization failed:', err.message);
  }

  // 2. Sanitize session state (fast, offline)
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage']
    });
    if (typeof genericPlaywrightCache !== 'undefined') genericPlaywrightCache.clear();
    console.log('[SYSTEM] Session and network cache cleared for fresh start');
  } catch (e) {
    console.error('[SYSTEM] Sanitize error:', e.message);
  }

  // 3. Start local media proxy server
  try {
    await createMediaProxyServer();
  } catch (e) {
    console.error('[SYSTEM] Failed to start media proxy server:', e.message);
  }

  // 4. Open the window
  createWindow();

  // 5. Non-critical network tasks in background (fire-and-forget)
  fetchLiveMirrors()
    .then(liveMirrors => {
      if (Array.isArray(liveMirrors)) {
        liveMirrors.forEach(m => pixeldrainMirrorRegistry.add(m));
        console.log(`[PIXELDRAIN] Registry initialized with ${liveMirrors.length} live mirrors`);
      }
    })
    .catch(err => console.warn('[PIXELDRAIN] Failed to initialize mirror registry:', err.message));
});

// ─── Hybrid DASH Manifest Helpers ──────────────────────────────────
const fetchFirstBytes = (targetUrl, bytesCount, customHeaders = null) => {
  return new Promise((resolve, reject) => {
    const performGet = (currentUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const parsedUrl = new URL(currentUrl);
      const req = https.get(currentUrl, {
        headers: {
          'Range': `bytes=0-${bytesCount - 1}`,
          'User-Agent': 'Mozilla/5.0',
          ...(customHeaders || {})
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectLocation = res.headers.location;
          if (redirectLocation) {
            const absoluteUrl = redirectLocation.startsWith('http') ? redirectLocation : new URL(redirectLocation, currentUrl).toString();
            performGet(absoluteUrl, redirectCount + 1);
            return;
          }
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`HTTP status ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
    };

    performGet(targetUrl);
  });
};

const parseVint = (buffer, offset, keepLengthBits = false) => {
  if (offset >= buffer.length) return null;
  const firstByte = buffer[offset];
  let mask = 0x80;
  let length = 1;
  while (mask > 0 && (firstByte & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > buffer.length) return null;

  let value = keepLengthBits ? firstByte : (firstByte & (mask - 1));
  for (let i = 1; i < length; i++) {
    value = (value * 256) + buffer[offset + i];
  }

  return { length, value };
};

const extractFormatRanges = async (formatUrl, isWebm = false, proxyHeaders = null) => {
  try {
    const bytesToFetch = isWebm ? 30000 : 8000;
    const buffer = await fetchFirstBytes(formatUrl, bytesToFetch, proxyHeaders);

    if (isWebm) {
      let offset = 0;
      let initRange = null;
      let indexRange = null;

      const ebmlId = parseVint(buffer, offset, true);
      if (!ebmlId || ebmlId.value !== 0x1a45dfa3) return null;
      offset += ebmlId.length;
      const ebmlSize = parseVint(buffer, offset, false);
      if (!ebmlSize) return null;
      offset += ebmlSize.length + ebmlSize.value;

      const segmentId = parseVint(buffer, offset, true);
      if (!segmentId || segmentId.value !== 0x18538067) return null;
      offset += segmentId.length;
      const segmentSize = parseVint(buffer, offset, false);
      if (!segmentSize) return null;
      offset += segmentSize.length;

      let cuesStart = -1;
      let cuesEnd = -1;
      let clusterStart = -1;

      while (offset + 4 <= buffer.length) {
        const elId = parseVint(buffer, offset, true);
        if (!elId) break;
        offset += elId.length;
        const elSize = parseVint(buffer, offset, false);
        if (!elSize) break;
        offset += elSize.length;

        const currentElementStart = offset - elId.length - elSize.length;

        if (elId.value === 0x1f43b675) { // Cluster
          if (clusterStart === -1) {
            clusterStart = currentElementStart;
          }
        } else if (elId.value === 0x1c53bb6b) { // Cues
          cuesStart = currentElementStart;
          cuesEnd = offset + elSize.value - 1;
        }

        if (cuesStart !== -1 && clusterStart !== -1) break;

        const isContainer = [0x114d9b74, 0x1549a966, 0x1654ae6b].includes(elId.value);
        if (!isContainer) {
          offset += elSize.value;
        }
      }

      if (cuesStart !== -1 && cuesEnd !== -1) {
        indexRange = { start: cuesStart, end: cuesEnd };
        if (cuesStart < clusterStart || clusterStart === -1) {
          initRange = { start: 0, end: cuesStart - 1 };
        } else {
          initRange = { start: 0, end: clusterStart - 1 };
        }
      } else if (clusterStart !== -1) {
        initRange = { start: 0, end: clusterStart - 1 };
      }

      return { initRange, indexRange };
    } else {
      let offset = 0;
      let initRange = null;
      let indexRange = null;

      while (offset + 8 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (size <= 0) break;

        if (type === 'moov') {
          initRange = { start: 0, end: offset + size - 1 };
        } else if (type === 'sidx') {
          indexRange = { start: offset, end: offset + size - 1 };
          break;
        }
        offset += size;
      }
      return { initRange, indexRange };
    }
  } catch (error) {
    console.warn('[DASH-RANGE-EXTRACTOR] Failed to extract ranges:', error.message);
    return null;
  }
};


app.on('window-all-closed', () => {
  if (mediaProxyServer) {
    mediaProxyServer.close();
    mediaProxyServer = null;
    mediaProxyBaseUrl = null;
    mediaServerOrigin = null;
  }
  try {
    demuxerIntegration.clearTempOutputs({ keepActive: false });
  } catch {
    cleanupDemuxTempFiles();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    demuxerIntegration.clearTempOutputs({ keepActive: false });
  } catch {
    cleanupDemuxTempFiles();
  }
});
