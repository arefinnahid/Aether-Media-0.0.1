/**
 * pixeldrain.com-main.cjs
 *
 * Unified Pixeldrain module – merges pixeldrain-main.cjs, pixeldrain-cdn-enhancer.cjs,
 * and all pixeldrain-related functions + state that were previously inlined in main.cjs.
 *
 * Usage:
 *   const createPixelDrainModule = require('./pixeldrain.com-main.cjs');
 *   const pixeldrainModule = createPixelDrainModule();
 *   // … later, once deps are available …
 *   pixeldrainModule.setDeps({ session, playwright, DESKTOP_USER_AGENT, … });
 */

const http = require('http');
const https = require('https');

module.exports = function createPixelDrainModule() {

  // ══════════════════════════════════════════════════════════════════════
  //  Dependencies – injected via setDeps() after main.cjs has them ready
  // ══════════════════════════════════════════════════════════════════════
  let deps = {};

  // ══════════════════════════════════════════════════════════════════════
  //  Internal state (owned by this module)
  // ══════════════════════════════════════════════════════════════════════
  const pixelDrainCookieStore = new Map();                // Cookie cache for PixelDrain (API)
  const pixelDrainPlaywrightCache = new Map();            // Cache for PixelDrain Playwright results
  const pixelDrainCdnCookieStore = new Map();             // Cookies from Playwright for CDN requests (keyed by fileId)
  const pixelDrainDomainCookies = new Map();              // Cookies keyed by domain (e.g., cdn09.pixeldrain.eu.cc)
  const pixeldrainMirrorRegistry = new Set([              // Dynamic registry for known CDN domains
    'pixeldrain.com',
    'www.pixeldrain.com',
    'cdn.pixeldrain.eu.cc'
  ]);
  const activePixelDrainStreamsMap = new Map();
  let pixelDrainBackoffUntil = 0;

  // ══════════════════════════════════════════════════════════════════════
  //  CDN Enhancer internals (absorbed from pixeldrain-cdn-enhancer.cjs)
  // ══════════════════════════════════════════════════════════════════════

  const isDirectBinaryMediaPath = (value) =>
    /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m4a|aac|ts|m4s)(?:\/)?(?:$|\?|#)/i.test(String(value || '').toLowerCase());

  // Extract folder ID and file path from a folder file URL
  const extractFolderFileInfo = (url) => {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (!['d', 'l'].includes(parts[0]) || !parts[1]) return null;

      // If only /d/folderId, return null as we don't fetch metadata here anymore
      if (parts.length === 2) {
        return null;
      }

      // For /d/folderId/path/to/file.mp4, extract the full file path
      const filePath = parts.slice(2).join('/');
      const lastPart = parts[parts.length - 1] || filePath;
      let fileName = lastPart;
      try {
        fileName = decodeURIComponent(lastPart);
      } catch {
        fileName = lastPart;
      }
      return { folderId: parts[1], filePath, fileName };
    } catch {
      return null;
    }
  };

  const HARDCODED_MIRRORS = Array.from(pixeldrainMirrorRegistry);
  let globalMirrorCache = null;
  let lastFetchTime = 0;
  const mirrorCooldowns = new Map();      // mirror -> expiry timestamp
  const COOLDOWN_TIMEOUT_MS = 60000;      // 60s cooldown for transient errors (timeout/abort)
  const COOLDOWN_DNS_MS = 300000;         // 5min cooldown for DNS/unreachable errors
  let lastWorkingMirror = null;

  const isMirrorCoolingDown = (mirror) => {
    const expiry = mirrorCooldowns.get(mirror);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      mirrorCooldowns.delete(mirror);
      return false;
    }
    return true;
  };

  const MIRROR_API_URL = 'https://pixeldrain-bypass.gamedrive.org/api/proxy.json';

  const fetchLiveMirrors = async () => {
    const now = Date.now();
    if (globalMirrorCache && (now - lastFetchTime < 300000)) { // 5 min cache
      return globalMirrorCache;
    }

    try {
      console.log(`[CDN-ENHANCER] Fetching live mirrors from: ${MIRROR_API_URL}`);
      const res = await fetch(MIRROR_API_URL, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const rawData = await res.json();
        const liveList = Array.isArray(rawData) ? rawData
          : (Array.isArray(rawData?.proxies) ? rawData.proxies : null);
        if (liveList && liveList.length > 0) {
          // Merge live list with hardcoded and unique names.
          // We ALWAYS prioritize the last known working mirror, or default to cdn.pixeldrain.eu.cc.
          const preferred = lastWorkingMirror || 'cdn.pixeldrain.eu.cc';
          const rawMerged = [...liveList, ...HARDCODED_MIRRORS];
          const unique = Array.from(new Set(rawMerged)).filter(m => m !== preferred);

          const finalMirrors = [preferred, ...unique];

          console.log(`[CDN-ENHANCER] Active mirrors (prioritizing ${preferred}):`, finalMirrors);
          globalMirrorCache = finalMirrors;
          lastFetchTime = now;
          return finalMirrors;
        }
      }
    } catch (err) {
      console.warn(`[CDN-ENHANCER] Failed to fetch live mirrors: ${err.message}`);
    }

    globalMirrorCache = HARDCODED_MIRRORS;
    return HARDCODED_MIRRORS;
  };

  const verifyCdnUrl = async (url, mirror) => {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': `https://${mirror}/`
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });

      if (res.ok || res.status === 206 || res.status === 302) {
        console.log(`[CDN-ENHANCER] Verification success (${res.status}) on: ${res.url}`);
        lastWorkingMirror = mirror; // Remember the mirror that just worked!

        let finalUrl = res.url;
        try {
          const parsed = new URL(finalUrl);
          parsed.searchParams.delete('download');
          parsed.searchParams.delete('attach');
          finalUrl = parsed.toString();
        } catch (e) { }

        return {
          url: finalUrl,
          mirror: mirror,
          proxyHeaders: {
            'referer': `https://${mirror}/`,
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        };
      } else {
        console.log(`[CDN-ENHANCER] Mirror ${mirror} rejected request with status ${res.status}`);
        return null;
      }
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('DNS') || msg.includes('ENOTFOUND')) {
        console.warn(`[CDN-ENHANCER] Mirror ${mirror} DNS failed, cooling down for 5min.`);
        mirrorCooldowns.set(mirror, Date.now() + COOLDOWN_DNS_MS);
      } else if (msg.includes('timeout') || msg.includes('aborted')) {
        console.warn(`[CDN-ENHANCER] Mirror ${mirror} timed out, cooling down for 60s.`);
        mirrorCooldowns.set(mirror, Date.now() + COOLDOWN_TIMEOUT_MS);
      }
      return null;
    }
  };

  async function generateEnhancedCdnLink(fileId, originalUrl) {
    if (!fileId) return null;

    console.log(`[CDN-ENHANCER] Generating link for id=${fileId}, url=${originalUrl}`);
    const mirrors = await fetchLiveMirrors();

    // Strategy 1: If it's a folder/album URL with a specific file path,
    // try the /{id}/{fileName} pattern
    const folderInfo = extractFolderFileInfo(originalUrl);
    const isFolderWithFile = folderInfo && folderInfo.fileName;

    if (isFolderWithFile) {
      console.log(`[CDN-ENHANCER] Strategy: Folder/Album nested file (folderId=${folderInfo.folderId}, fileName=${folderInfo.fileName})`);

      for (const mirror of mirrors) {
        if (isMirrorCoolingDown(mirror)) continue;

        try {
          // 1.1 Try the specific path /api/filesystem/{folderId}/{encodedFilePath}
          const encodedPath = folderInfo.filePath.split('/').map(p => encodeURIComponent(decodeURIComponent(p))).join('/');
          const specificUrl = `https://${mirror}/api/filesystem/${folderInfo.folderId}/${encodedPath}`;
          console.log(`[CDN-ENHANCER][FOLDER] Trying specific path: ${specificUrl}`);
          const result = await verifyCdnUrl(specificUrl, mirror);
          if (result) return result;

          // 1.2 If that fails, try treating fileId as a standalone file ID (common for albums)
          const standaloneUrl = `https://${mirror}/api/file/${fileId}`;
          console.log(`[CDN-ENHANCER][FOLDER] Fallback to standalone ID: ${standaloneUrl}`);
          const standaloneResult = await verifyCdnUrl(standaloneUrl, mirror);
          if (standaloneResult) return standaloneResult;
        } catch (err) {
          console.warn(`[CDN-ENHANCER] Error processing mirror ${mirror}:`, err.message);
        }
      }
    } else {
      // Strategy 2: Default resolution (single file ID)
      console.log(`[CDN-ENHANCER] Strategy: Default/Standalone (id=${fileId})`);

      for (const mirror of mirrors) {
        if (isMirrorCoolingDown(mirror)) continue;

        try {
          // Single file (/u/ or /api/file/)
          const candidateUrl = `https://${mirror}/api/file/${fileId}`;
          console.log(`[CDN-ENHANCER][DEFAULT] Trying: ${candidateUrl}`);
          const result = await verifyCdnUrl(candidateUrl, mirror);
          if (result) return result;
        } catch (err) {
          console.warn(`[CDN-ENHANCER] Error processing mirror ${mirror}:`, err.message);
        }
      }
    }

    console.log(`[CDN-ENHANCER] Failed to generate enhanced link for ${fileId}`);
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Core Pixeldrain functions
  // ══════════════════════════════════════════════════════════════════════

  const isPixeldrainHost = (host) => {
    const value = String(host || '').toLowerCase();

    // Check dynamic registry first
    if (typeof pixeldrainMirrorRegistry !== 'undefined' && (pixeldrainMirrorRegistry.has(value) || Array.from(pixeldrainMirrorRegistry).some(d => value.endsWith('.' + d)))) {
      return true;
    }

    // Exact matches for primary domains
    if (value === 'pixeldrain.com' || value === 'www.pixeldrain.com') return true;
    // For custom CDN domains (e.g., cdn.pixeldrain.eu.cc, cdn49.pixeldrain.eu.cc)
    if (value.includes('pixeldrain')) return true;
    return false;
  };

  const getPixelDrainFileId = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      const host = parsed.hostname.toLowerCase();
      if (!isPixeldrainHost(host)) return null;

      const pathParts = parsed.pathname.split('/').filter(Boolean);
      // Known direct-file patterns
      if (pathParts[0] === 'u' && pathParts[1] && pathParts.length === 2) return pathParts[1];
      if (pathParts[0] === 'd' && pathParts[1] && pathParts.length === 2) return pathParts[1];
      if (pathParts[0] === 'api' && pathParts[1] === 'file' && pathParts[2]) return pathParts[2];
      // Fallback: if the path is a single segment and looks like a file ID (6+ alphanumeric)
      if (pathParts.length === 1 && /^[a-zA-Z0-9]{6,}$/.test(pathParts[0])) {
        return pathParts[0];
      }
      return null;
    } catch {
      return null;
    }
  };

  const resolvePixelDrainDirectUrl = (rawUrl) => {
    try {
      const fileId = getPixelDrainFileId(rawUrl);
      if (!fileId) return null;

      return {
        url: `https://pixeldrain.com/api/file/${fileId}`,
        audioUrl: null,
        title: `pixeldrain-${fileId}`
      };
    } catch {
      return null;
    }
  };

  const getPixelDrainPlaybackUrls = (fileId) => {
    const filesystemUrl = `https://pixeldrain.com/api/filesystem/${encodeURIComponent(fileId)}`;
    const directUrl = `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}`;
    const directDownloadUrl = `${directUrl}?download`;
    const externalDownloadUrl = `https://pixeldrain.com/u/${encodeURIComponent(fileId)}?download`;
    const proxiedFilesystemUrl = deps.proxifyMediaUrl(filesystemUrl);
    const proxiedDirectUrl = deps.proxifyMediaUrl(directUrl);
    const proxiedDirectDownloadUrl = deps.proxifyMediaUrl(directDownloadUrl);
    const proxiedExternalDownloadUrl = deps.proxifyMediaUrl(externalDownloadUrl);

    return {
      primaryUrl: directUrl,
      retryUrls: deps.buildOrderedRetryList([
        directDownloadUrl,
        externalDownloadUrl,
        filesystemUrl,
        proxiedDirectDownloadUrl,
        proxiedDirectUrl,
        proxiedFilesystemUrl,
        proxiedExternalDownloadUrl
      ]).filter((candidate) => candidate && candidate !== directUrl)
    };
  };

  const getPixelDrainVariantUrl = (fileId, variant = 'api') => {
    const safeId = encodeURIComponent(String(fileId || ''));
    if (!safeId) return '';
    if (variant === 'filesystem') return `https://pixeldrain.com/api/filesystem/${safeId}`;
    if (variant === 'api') return `https://pixeldrain.com/api/file/${safeId}`;
    if (variant === 'page-download') return `https://pixeldrain.com/u/${safeId}?download`;
    if (variant === 'download') return `https://pixeldrain.com/api/file/${safeId}?download`;
    return `https://pixeldrain.com/api/file/${safeId}`;
  };

  const normalizePixelDrainLocalVariant = (variant = 'api') => {
    const normalized = String(variant || 'api').trim().toLowerCase();
    if (!normalized) return 'api';
    if (normalized === 'api' || normalized === 'filesystem' || normalized === 'page-download' || normalized === 'download') {
      return normalized;
    }
    return 'api';
  };

  const buildPixelDrainLocalVariantStreamUrl = (fileId, variant = 'filesystem') => {
    const safeVariant = normalizePixelDrainLocalVariant(variant);
    const mediaServerOrigin = deps.getMediaServerOrigin ? deps.getMediaServerOrigin() : null;
    if (!mediaServerOrigin) {
      return getPixelDrainVariantUrl(fileId, safeVariant);
    }
    return `${mediaServerOrigin}/pixeldrain-stream?fileId=${encodeURIComponent(fileId)}&variant=${encodeURIComponent(safeVariant)}`;
  };

  // isPixelDrainBackoffExemptTarget removed – no longer used after queue removal

  const buildPixelDrainLocalPlaybackUrls = (fileId) => {
    const primaryUrl = buildPixelDrainLocalVariantStreamUrl(fileId, 'api');
    return {
      primaryUrl,
      retryUrls: []
    };
  };

  const isPixeldrainRequest = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || ''));
      return isPixeldrainHost(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  const getPixelDrainCookieForHost = (host, fileId) => {
    const normalizedHost = String(host || '').toLowerCase();
    const normalizedFileId = String(fileId || '').trim();

    const exactDomainCookie = pixelDrainDomainCookies.get(normalizedHost);
    const suffixDomainCookie = !exactDomainCookie
      ? Array.from(pixelDrainDomainCookies.entries()).find(([domain]) =>
        normalizedHost === String(domain || '').toLowerCase() ||
        normalizedHost.endsWith(`.${String(domain || '').toLowerCase()}`) ||
        String(domain || '').toLowerCase().endsWith(`.${normalizedHost}`)
      )?.[1]
      : null;
    const fileCookie = normalizedFileId ? pixelDrainCdnCookieStore.get(normalizedFileId) : null;
    const primedCookie = normalizedFileId ? pixelDrainCookieStore.get(normalizedFileId)?.cookie || '' : '';

    return deps.mergeCookieStrings(exactDomainCookie, suffixDomainCookie, fileCookie, primedCookie);
  };

  const syncPixeldrainCookiesToElectron = async (cookies, fileId, bestUrl) => {
    if (!cookies || cookies.length === 0) return;

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (!cookieHeader) return;

    console.log(`[COOKIE-SYNC] Synchronizing ${cookies.length} cookies for fileId ${fileId}`);
    pixelDrainCdnCookieStore.set(fileId, cookieHeader);

    try {
      const url = new URL(bestUrl);
      const targetHost = url.hostname.toLowerCase();
      pixelDrainDomainCookies.set(targetHost, cookieHeader);
      pixelDrainDomainCookies.set('pixeldrain.com', deps.mergeCookieStrings(pixelDrainDomainCookies.get('pixeldrain.com'), cookieHeader));
      pixelDrainDomainCookies.set('www.pixeldrain.com', deps.mergeCookieStrings(pixelDrainDomainCookies.get('www.pixeldrain.com'), cookieHeader));
    } catch { }

    const session = deps.session;
    if (session?.defaultSession?.cookies) {
      for (const pwCookie of cookies) {
        const cookieDomain = String(pwCookie.domain || '').toLowerCase();
        const parentDomain = (() => {
          const parts = cookieDomain.replace(/^\./, '').split('.');
          if (parts.length >= 3) return '.' + parts.slice(1).join('.');
          return '.' + parts.join('.');
        })();
        const cookieUrl = `https://${cookieDomain.replace(/^\./, '')}`;
        const domainsToSet = [parentDomain, cookieDomain.startsWith('.') ? cookieDomain : '.' + cookieDomain];
        const uniqueDomains = [...new Set(domainsToSet)];

        for (const domain of uniqueDomains) {
          try {
            await session.defaultSession.cookies.set({
              url: cookieUrl,
              name: pwCookie.name,
              value: pwCookie.value,
              domain,
              path: pwCookie.path || '/',
              secure: pwCookie.secure !== false,
              httpOnly: !!pwCookie.httpOnly,
              sameSite: 'no_restriction',
              expirationDate: pwCookie.expires > 0
                ? pwCookie.expires
                : Math.floor(Date.now() / 1000) + 3600
            });
          } catch { }
        }
      }
    }
  };

  const buildPixelDrainHeaders = ({ fileId = '', targetUrl = '', accept = '', range = '', existingHeaders = {}, refererUrl = '', originUrl = 'https://pixeldrain.com' } = {}) => {
    const target = (() => {
      try {
        return targetUrl ? new URL(String(targetUrl)) : null;
      } catch {
        return null;
      }
    })();

    const safeFileId = String(fileId || '').trim() || getPixelDrainFileId(target?.toString() || '') || '';
    const targetHost = String(target?.hostname || '').toLowerCase();
    const requestedAccept = String(accept || '').trim();
    const pathname = String(target?.pathname || '').toLowerCase();
    const isManifest = pathname.endsWith('.m3u8') || pathname.endsWith('.mpd');
    const resolvedAccept = requestedAccept || (
      isManifest
        ? 'application/dash+xml,application/vnd.apple.mpegurl,application/x-mpegurl,*/*;q=0.8'
        : 'video/webm,video/ogg,video/*;q=0.9,audio/*;q=0.8,*/*;q=0.5'
    );
    const explicitReferer = String(refererUrl || existingHeaders?.Referer || existingHeaders?.referer || '').trim();

    // Pixeldrain mirrors are often very picky about the Referer.
    // Using the primary site or the mirror origin usually works.
    const resolvedReferer = explicitReferer || (safeFileId
      ? `https://pixeldrain.com/u/${encodeURIComponent(safeFileId)}`
      : `https://pixeldrain.com/`);

    const headers = {
      ...existingHeaders,
      'User-Agent': deps.DESKTOP_USER_AGENT,
      'Accept': resolvedAccept,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'DNT': '1',
      'Origin': String(originUrl || 'https://pixeldrain.com'),
      'Referer': resolvedReferer,
      'Sec-Fetch-Dest': isManifest ? 'empty' : 'video',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Connection': 'keep-alive'
    };

    if (range) {
      headers.Range = range;
      headers.range = range;
    }

    const mergedCookie = deps.mergeCookieStrings(
      existingHeaders?.Cookie,
      existingHeaders?.cookie,
      getPixelDrainCookieForHost(targetHost, safeFileId)
    );

    if (mergedCookie) {
      headers.Cookie = mergedCookie;
      headers.cookie = mergedCookie;
    }

    return headers;
  };

  // PixelDrain cookie priming (from adult site version)
  const primePixelDrainCookies = (fileId) =>
    new Promise((resolve) => {
      const safeFileId = String(fileId || '').trim();
      if (!safeFileId) {
        resolve('');
        return;
      }

      const cached = pixelDrainCookieStore.get(safeFileId);
      if (cached && cached.expiresAt > Date.now()) {
        resolve(cached.cookie);
        return;
      }

      const pageUrl = new URL(`https://pixeldrain.com/u/${encodeURIComponent(safeFileId)}`);
      const req = https.request(
        pageUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent': deps.DESKTOP_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://pixeldrain.com/'
          },
          agent: deps.proxyHttpsAgent
        },
        (res) => {
          const cookie = deps.normalizeCookieHeader(res.headers?.['set-cookie']);
          if (cookie) {
            pixelDrainCookieStore.set(safeFileId, {
              cookie,
              expiresAt: Date.now() + 2 * 60 * 60 * 1000 // Increased to 2 hours
            });
          }
          res.resume();
          resolve(cookie || '');
        }
      );

      req.setTimeout(15000, () => req.destroy(new Error('PixelDrain cookie prime timeout')));
      req.on('error', () => resolve(''));
      req.end();
    });

  /**
   * Start a PixelDrain upstream stream for the given fileId.
   * If there is already an active stream for this fileId (e.g. from a previous
   * seek position), we instantly .destroy() it so the Pixeldrain connection slot
   * is freed before opening the new one.  No queue, no delay.
   */
  function startPixelDrainStream(targetUrl, options, res, fileId, streamFn) {
    // Backoff safety valve – respect IP reputation
    if (pixelDrainBackoffUntil > Date.now()) {
      console.log(`PixelDrain backoff active, rejecting request for file ${fileId}`);
      if (!res.headersSent) {
        res.writeHead(503, {
          'Retry-After': String(Math.ceil((pixelDrainBackoffUntil - Date.now()) / 1000)),
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        res.end('Service Unavailable (rate limited)');
      }
      return;
    }

    // Use a unique tracking ID for every stream to allow concurrent range requests
    // (e.g. video/audio separation, moov atom probes, ffprobe) without aborting each other.
    // The previous preemptive abort logic caused Chromium's <video> element to throw
    // MEDIA_ERR_NETWORK because it aggressively killed still-active sibling requests.
    const trackId = Symbol('pixeldrain-stream');

    // Preemptive abort removed. Chromium correctly closes sockets it no longer needs,
    // which automatically triggers the cleanup logic below.

    // ── Prepare tracking entry ──
    const entry = { res, upstreamReq: null };
    res._pixelDrainEntry = entry;
    activePixelDrainStreamsMap.set(trackId, entry);

    const cleanup = () => {
      // ALWAYS destroy the upstream request if the frontend disconnects!
      // This immediately frees the connection slot on Pixeldrain's servers.
      try { entry.upstreamReq?.destroy(); } catch { }

      const current = activePixelDrainStreamsMap.get(trackId);
      if (current === entry) {
        activePixelDrainStreamsMap.delete(trackId);
        console.log(`[PIXELDRAIN] Stream finished/cleaned up for trackId ${String(trackId)}`);
      }
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);

    // ── Build final headers and start the upstream request ──
    const doStream = () => {
      options.headers = buildPixelDrainHeaders({
        fileId,
        targetUrl: targetUrl.toString(),
        accept: options?.headers?.Accept || options?.headers?.accept || '',
        range: options?.headers?.Range || options?.headers?.range || '',
        existingHeaders: options?.headers || {}
      });

      // Wrap the streamFn so we can capture the upstream request object for
      // future abort.  streamFromUpstream creates an http(s).request – we hook
      // into the returned req via a thin proxy around the native module.
      streamFn(targetUrl, options, res, 0, fileId, 0);
    };

    const existingCookie = getPixelDrainCookieForHost(targetUrl.hostname, fileId);
    if (existingCookie) {
      doStream();
      return;
    }

    // Prime cookies, then stream – no artificial delay
    primePixelDrainCookies(fileId)
      .then(() => doStream())
      .catch(() => doStream());
  }

  // Helper to clear session cookies for any Pixeldrain domain
  const clearPixeldrainSessionCookies = async () => {
    const session = deps.session;
    const sess = session?.defaultSession;
    if (!sess) return;
    const allCookies = await sess.cookies.get({});
    const pixeldrainCookies = allCookies.filter(c =>
      c.domain && c.domain.includes('pixeldrain')
    );
    for (const cookie of pixeldrainCookies) {
      await sess.cookies.remove(cookie.domain, cookie.name);
    }
    if (pixeldrainCookies.length > 0) {
      console.log(`Cleared ${pixeldrainCookies.length} session cookies for Pixeldrain domains`);
    }
  };

  const resolvePixelDrainPlaybackUrlForRenderer = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      if (!isPixeldrainHost(parsed.hostname.toLowerCase())) return null;

      const fileId = getPixelDrainFileId(parsed.toString());
      if (!fileId) return null;

      const pathname = parsed.pathname.toLowerCase();
      let variant = 'api';

      if (pathname.startsWith('/d/')) {
        variant = 'filesystem';
      } else if (pathname.startsWith('/api/filesystem/')) {
        variant = 'filesystem';
      } else if (pathname.startsWith('/api/file/') && parsed.searchParams.has('download')) {
        variant = 'download';
      } else if (pathname.startsWith('/u/') && parsed.searchParams.has('download')) {
        variant = 'page-download';
      }

      return buildPixelDrainLocalVariantStreamUrl(fileId, variant);
    } catch {
      return null;
    }
  };

  async function fetchPixelDrainWithPlaywright(fileId) {
    const playwright = deps.playwright;
    if (!playwright) {
      console.log('Playwright not available for PixelDrain');
      return null;
    }

    const cacheKey = `pd:${fileId}`;
    const cached = pixelDrainPlaywrightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('Using cached PixelDrain Playwright result for fileId:', fileId);
      return cached.payload;
    }

    let browser = null;
    let capturedUrls = [];
    let capturedSubtitles = new Map();
    let settled = false;
    let resolveTimer = null;

    const cleanupBrowser = async () => {
      if (!browser) return;
      try { await browser.close(); } catch { }
      browser = null;
    };

    return new Promise(async (resolve, reject) => {
      const resolveOnce = (value) => {
        if (settled) return;
        if (resolveTimer) clearTimeout(resolveTimer);
        settled = true;
        resolve(value);
      };
      const rejectOnce = (error) => {
        if (settled) return;
        if (resolveTimer) clearTimeout(resolveTimer);
        settled = true;
        reject(error);
      };

      try {
        console.log(`Launching Playwright (HEADFUL) for PixelDrain enhanced CDN, fileId: ${fileId}`);

        // Start the stealth hider before launching
        deps.startStealthHider();

        browser = await playwright.chromium.launch({
          headless: false,
          executablePath: deps.getPlaywrightExecutablePath() || undefined,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--disable-features=BlockInsecurePrivateNetworkRequests',
            '--disable-features=OutOfBlinkCors',
            '--disable-webgl',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-sync',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--password-store=basic',
            '--use-mock-keychain',
            '--no-default-browser-check',
            '--no-zygote'
          ]
        });

        const context = await browser.newContext({
          userAgent: deps.DESKTOP_USER_AGENT,
          viewport: { width: 1280, height: 720 },
          deviceScaleFactor: 1,
          hasTouch: false,
          isMobile: false,
          locale: 'en-US',
          timezoneId: 'America/New_York',
          permissions: ['geolocation'],
          extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://pixeldrain.com/'
          }
        });

        const page = await context.newPage();

        await page.addInitScript(() => {

          // Hook window.eval to dynamically rewrite Pooembed's / gasm.js bot check script to always return false (NOT A BOT)
          const origEval = window.eval;
          window.eval = function (code) {
            if (typeof code === 'string' && code.includes('prefers-color-scheme') && code.includes('userAgentData')) {
              console.log('[PLAYWRIGHT] INTERCEPTED BOT CHECK SCRIPT! Rewriting to always return false...');
              // Force the self-executing function to return false instantly, bypassing all checks!
              code = code.replace('var R=false;', 'var R=false; return false;');
              console.log('[PLAYWRIGHT] Bot check script successfully patched!');
            }
            return origEval.apply(this, arguments);
          };

          window.open = function () {
            return {
              closed: false,
              close: function () { this.closed = true; },
              focus: function () { },
              blur: function () { },
              postMessage: function () { }
            };
          };
          // Bypass Pooembed's sandboxed detector object onerror trigger
          let dummySandDetect = () => {
            console.log('[PLAYWRIGHT] window.sandDetect() bypass triggered');
          };
          Object.defineProperty(window, 'sandDetect', {
            get: () => dummySandDetect,
            set: (val) => {
              console.log('[PLAYWRIGHT] window.sandDetect set attempted (ignored)', typeof val);
            },
            configurable: true
          });

          // The WASM crashes due to a cross-origin error if the PDF viewer extension is broken/disabled
          // We completely remove the sandDetect object as soon as it appears in the DOM
          new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const node of m.addedNodes) {
                if (node.id === 'sandDetect' || (node.tagName === 'OBJECT' && node.data?.includes('application/pdf'))) {
                  node.remove();
                  console.log('[PLAYWRIGHT] Removed sandDetect PDF object to prevent WASM crash');
                }
              }
            }
          }).observe(document, { childList: true, subtree: true });
          window.addEventListener('beforeunload', (e) => {
            e.preventDefault();
            e.returnValue = '';
          });
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
          });
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
          });
          delete window.chrome;
        });

        page.on('close', async () => {
          console.log('PixelDrain Playwright page closed unexpectedly, attempting to recover cookies/URL...');
          if (settled) return;

          try {
            // If the page closed but we have captured URLs, try to grab cookies from context before resolving
            const currentCookies = await context.cookies().catch(() => []);
            if (currentCookies.length > 0) {
              await syncPixeldrainCookiesToElectron(currentCookies, fileId, capturedUrls[0]);
            }
          } catch (recoverErr) {
            console.warn('[PIXELDRAIN] Failed to recover cookies on page close:', recoverErr.message);
          }

          setTimeout(() => {
            if (settled) return;
            const best = capturedUrls[0];
            if (best) resolveOnce(best);
            else rejectOnce(new Error('Page closed without capturing video URL'));
          }, 500);
        });

        await page.route('**/*', async (route) => {
          const requestUrl = route.request().url();
          const resourceType = route.request().resourceType();

          const isSubtitle = (() => {
            const hasSubExt = /\.(vtt|srt|ass|ssa)(\?|$)/i.test(requestUrl);
            if (!hasSubExt) return false;
            if (deps.isLikelyThumbnailUrl(requestUrl)) {
              console.log(`[SUBTITLE] Skipping thumbnail: ${requestUrl}`);
              return false;
            }
            if (resourceType === 'fetch' || resourceType === 'xhr' || resourceType === 'other') {
              return true;
            }
            return false;
          })();

          if (isSubtitle) {
            const language = deps.extractLanguageFromUrl(requestUrl);
            const label = language ? `Subtitle (${language})` : 'Subtitle';
            console.log(`[SUBTITLE] Captured: ${requestUrl} (type: ${resourceType}, lang: ${language || 'unknown'})`);
            capturedSubtitles.set(requestUrl, { url: requestUrl, language, label });
          }

          if (
            requestUrl.includes('pixeldrain.eu.cc/api/file/') ||
            (requestUrl.includes('pixeldrain.eu.cc') && requestUrl.match(/\.mp4(\?|$)/i)) ||
            requestUrl.includes(`/api/file/${fileId}`)
          ) {
            console.log('PixelDrain Playwright captured URL:', requestUrl);
            capturedUrls.push(requestUrl);
          }
          await route.continue();
        });

        const mirrorsToTry = Array.from(pixeldrainMirrorRegistry).filter(m => !m.includes('pixeldrain.com'));
        if (mirrorsToTry.length === 0) mirrorsToTry.push('cdn.pixeldrain.eu.cc');

        let mirror = mirrorsToTry[0];
        let pageUrl = `https://${mirror}/${encodeURIComponent(fileId)}`;
        console.log('Navigating to:', pageUrl);

        try {
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (gotoErr) {
          console.warn(`[PIXELDRAIN] Playwright mirror failed (${mirror}), trying alternatives...`);
          let success = false;
          for (let i = 1; i < mirrorsToTry.length; i++) {
            mirror = mirrorsToTry[i];
            pageUrl = `https://${mirror}/${encodeURIComponent(fileId)}`;
            try {
              console.log('Retrying with mirror:', mirror);
              await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              success = true;
              break;
            } catch (retryErr) {
              console.warn(`[PIXELDRAIN] Playwright mirror retry failed (${mirror}):`, retryErr.message);
            }
          }
          if (!success && capturedUrls.length === 0) throw gotoErr;
        }

        await page.waitForTimeout(3000);

        try {
          const videoSrc = await page.$eval('video', (el) => el.src).catch(() => null);
          if (videoSrc && videoSrc.startsWith('http')) {
            console.log('Extracted video src from DOM:', videoSrc);
            capturedUrls.push(videoSrc);
          }
        } catch { }

        try {
          const tracks = await page.$$eval('track', els => els.map(el => ({
            src: el.src,
            srclang: el.srclang,
            label: el.label,
            kind: el.kind
          })));
          for (const track of tracks) {
            const isSubtitleTrack = (track.kind === 'subtitles' || track.kind === 'captions') &&
              track.src && /\.(vtt|srt|ass|ssa)(\?|$)/i.test(track.src);
            if (isSubtitleTrack) {
              if (deps.isLikelyThumbnailUrl(track.src)) {
                console.log(`[SUBTITLE] Skipping thumbnail track: ${track.src}`);
                continue;
              }
              const inferredLanguage = track.srclang || deps.extractLanguageFromUrl(track.src);
              const ext = (track.src.match(/\.(vtt|srt|ass|ssa)(?:\?|$)/i)?.[1] || 'sub').toUpperCase();
              const label = track.label || (inferredLanguage ? `${ext} (${inferredLanguage})` : ext);
              console.log(`[SUBTITLE] Track element: ${track.src} (lang: ${inferredLanguage || 'unknown'})`);
              capturedSubtitles.set(track.src, {
                url: track.src,
                language: inferredLanguage || null,
                label,
                kind: track.kind || 'subtitles'
              });
            }
          }
        } catch { }

        const bestUrl = capturedUrls.find(url => url.includes(`/api/file/${fileId}`)) || capturedUrls[0];
        if (!bestUrl) {
          rejectOnce(new Error('No video URL captured'));
          return;
        }

        console.log('Best PixelDrain CDN URL:', bestUrl);

        await syncPixeldrainCookiesToElectron(await context.cookies(), fileId, bestUrl);

        try {
          const headResult = await new Promise((resolveHead, rejectHead) => {
            const url = new URL(bestUrl);
            const client = url.protocol === 'https:' ? https : http;
            const headers = buildPixelDrainHeaders({
              fileId,
              targetUrl: bestUrl,
              userAgent: deps.DESKTOP_USER_AGENT
            });
            const req = client.request(
              url,
              {
                method: 'HEAD',
                headers,
                timeout: 5000,
                agent: new https.Agent({ rejectUnauthorized: false })
              },
              (res) => {
                if (res.statusCode === 200 || res.statusCode === 206) {
                  resolveHead(true);
                } else {
                  rejectHead(new Error(`HEAD returned ${res.statusCode}`));
                }
                res.resume();
              }
            );
            req.on('error', rejectHead);
            req.on('timeout', () => {
              req.destroy();
              rejectHead(new Error('HEAD timeout'));
            });
            req.end();
          });

          if (!headResult) {
            throw new Error('HEAD check failed');
          }
        } catch (headError) {
          console.warn(`CDN URL ${bestUrl} is not accessible (${headError.message}), failing PixelDrain resolution.`);
          resolveOnce(null);
          return;
        }

        const result = {
          url: bestUrl,
          title: `pixeldrain-${fileId}`,
          proxyHeaders: null,
          disablePreview: true,
          subtitles: Array.from(capturedSubtitles.values())
        };

        pixelDrainPlaywrightCache.set(cacheKey, {
          payload: result,
          expiresAt: Date.now() + 10 * 60 * 1000
        });
        resolveOnce(result);
      } catch (error) {
        console.error('PixelDrain Playwright error:', error);
        rejectOnce(error);
      }
    })
      .then(async (result) => {
        await cleanupBrowser();
        return result;
      })
      .catch(async (error) => {
        console.error('PixelDrain Playwright final error:', error.message || error);
        await cleanupBrowser();
        return null;
      });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Module API
  // ══════════════════════════════════════════════════════════════════════

  return {
    // ── State (reference types – safe to destructure) ──
    pixelDrainCookieStore,
    pixelDrainPlaywrightCache,
    pixelDrainCdnCookieStore,
    pixelDrainDomainCookies,
    pixeldrainMirrorRegistry,
    activePixelDrainStreamsMap,

    // ── Backoff (primitive – use getter/setter for live access) ──
    get pixelDrainBackoffUntil() { return pixelDrainBackoffUntil; },
    set pixelDrainBackoffUntil(val) { pixelDrainBackoffUntil = val; },

    // ── Core functions ──
    isPixeldrainHost,
    getPixelDrainFileId,
    resolvePixelDrainDirectUrl,
    getPixelDrainPlaybackUrls,
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

    // ── CDN Enhancer functions ──
    fetchLiveMirrors,
    generateEnhancedCdnLink,

    // ── Dependency injection ──
    setDeps(newDeps) { Object.assign(deps, newDeps); }
  };
};
