// ═══════════════════════════════════════════════════════════════════════════════
// local-media-demuxer.cjs
// Merged from: demuxer-integration.cjs and local-videos-main.cjs
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const { probeFile } = require('../core/parser');
const TrackManager = require('../core/trackManager');
const { getFfmpegPath } = require('../core/ffmpegPaths');

const trackManager = new TrackManager([]);

const state = {
  filePath: '',
  analysis: null,
  tempDir: path.join(os.tmpdir(), 'aether-player-demux'),
  activeTempOutputPath: '',
  remuxCache: new Map(),
  activeFfmpegProcess: null
};

// ─── Chromium-native codec whitelist ─────────────────────────────────────────
// These codecs can be decoded by Chromium's media pipeline without transcoding.
const CHROMIUM_NATIVE_VIDEO_CODECS = new Set([
  'h264', 'avc', 'avc1',
  'vp8', 'vp08',
  'vp9', 'vp09',
  'av1', 'av01',
  'hevc', 'h265', 'hev1', 'hvc1',
  'theora'
]);

const CHROMIUM_NATIVE_AUDIO_CODECS = new Set([
  'aac', 'mp4a',
  'opus',
  'vorbis',
  'flac',
  'mp3', 'mp3float',
  'pcm_s16le', 'pcm_s16be', 'pcm_f32le', 'pcm_u8',
  'mp2', 'mp2float',
  'xhe-aac', 'usac'
]);

// Audio codecs that need transcoding to AAC/PCM for Chromium playback
const UNSUPPORTED_AUDIO_CODECS = new Set([
  'dts', 'dts-hd', 'dtshd',
  'truehd',
  'cook',       // RealAudio
  'wmav1', 'wmav2', 'wmavoice', 'wmapro', 'wmalossless', 'wma',
  'adpcm_ms', 'adpcm_ima_wav',
  'pcm_dvd', 'pcm_bluray',
  'ac3', 'ac-3', 'eac3', 'ec-3',
  'alac',
  'speex',
  'amr', 'amr-nb', 'amr-wb'
]);

function setTempDirForFile(filePath) {
  const resolvedFile = path.resolve(String(filePath || ''));
  const parentDir = path.dirname(resolvedFile);
  state.tempDir = path.join(parentDir, 'temp');
  return state.tempDir;
}

function ensureTempDir() {
  fs.mkdirSync(state.tempDir, { recursive: true });
  return state.tempDir;
}

function isLocalFilesystemPath(filePath) {
  const value = String(filePath || '').trim();
  if (!value) return false;
  if (value.startsWith('file://')) return true;
  if (/^[a-zA-Z]:[\\\/]/.test(value)) return true;
  if (value.startsWith('/')) return true;
  return false;
}

function normalizeLocalPath(filePath) {
  const value = String(filePath || '').trim();
  if (!isLocalFilesystemPath(value)) {
    throw new Error('Demuxer integration only accepts local filesystem paths');
  }

  if (value.startsWith('file://')) {
    return decodeURIComponent(value.replace(/^file:\/\//i, '').replace(/^\/+([a-zA-Z]:)/, '$1'));
  }

  return path.resolve(value);
}

function ensureAnalyzed() {
  if (!state.analysis || !state.filePath) {
    throw new Error('No local file has been analyzed yet');
  }
}

function getStructuredTracks() {
  ensureAnalyzed();
  return {
    video: state.analysis.streams.video || [],
    audio: state.analysis.streams.audio || [],
    subtitles: state.analysis.streams.subtitle || [],
    current: trackManager.getCurrentSelection()
  };
}

function getPreferredTrackIndex(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;
  const preferred = tracks.find((track) => Number(track?.disposition?.default || 0) === 1);
  return Number((preferred || tracks[0]).index);
}

function applyPreferredDefaults(analysis) {
  const tracks = analysis?.allStreams || [];
  trackManager.setTracks(tracks);

  // For video and audio, fallback to the first track if no default is specified
  const preferredVideo = getPreferredTrackIndex(analysis?.streams?.video || []);
  const preferredAudio = getPreferredTrackIndex(analysis?.streams?.audio || []);

  // For subtitles, only auto-select if a track is explicitly marked as default
  const subtitleTracks = analysis?.streams?.subtitle || [];
  const defaultSubtitle = subtitleTracks.find((track) => Number(track?.disposition?.default || 0) === 1);
  const preferredSubtitle = defaultSubtitle ? Number(defaultSubtitle.index) : null;

  if (preferredVideo != null) {
    trackManager.selectTrack('video', preferredVideo);
  }
  if (preferredAudio != null) {
    trackManager.selectTrack('audio', preferredAudio);
  }
  if (preferredSubtitle != null) {
    trackManager.selectTrack('subtitle', preferredSubtitle);
  } else {
    trackManager.disableTrack('subtitle');
  }
}

function spawnAndCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to start ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}\n${stderr}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function spawnFfmpegToFile(args) {
  const ffmpegPath = getFfmpegPath();

  // Kill any previous active ffmpeg process
  if (state.activeFfmpegProcess) {
    try { state.activeFfmpegProcess.kill('SIGKILL'); } catch { }
    state.activeFfmpegProcess = null;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    state.activeFfmpegProcess = child;

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      state.activeFfmpegProcess = null;
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });

    child.on('close', (code) => {
      state.activeFfmpegProcess = null;
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}\n${stderr}`));
        return;
      }
      resolve({ stderr });
    });
  });
}

function uniqueTempFile(name) {
  ensureTempDir();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return path.join(state.tempDir, `${name}-${suffix}`);
}


function getRemuxCacheKey(filePath, currentSelection, mode = 'copy') {
  const fileKey = path.resolve(String(filePath || ''));
  const video = currentSelection?.video == null ? 'none' : Number(currentSelection.video);
  const audio = currentSelection?.audio == null ? 'none' : Number(currentSelection.audio);
  return `${fileKey}::v=${video}::a=${audio}::${mode}`;
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function clearTempOutputs({ keepActive = false } = {}) {
  if (!keepActive && state.activeFfmpegProcess) {
    try { state.activeFfmpegProcess.kill('SIGKILL'); } catch { }
    state.activeFfmpegProcess = null;
  }

  ensureTempDir();

  const keepPaths = new Set();
  if (keepActive) {
    const active = path.resolve(String(state.activeTempOutputPath || ''));
    if (active) keepPaths.add(active);

    for (const [cacheKey, cachedPath] of state.remuxCache.entries()) {
      const resolvedCachedPath = path.resolve(String(cachedPath || ''));
      if (!resolvedCachedPath || !fs.existsSync(resolvedCachedPath)) {
        state.remuxCache.delete(cacheKey);
        continue;
      }
      keepPaths.add(resolvedCachedPath);
    }
  }

  for (const entry of fs.readdirSync(state.tempDir)) {
    const absolute = path.join(state.tempDir, entry);
    try {
      const stat = fs.statSync(absolute);
      if (!stat.isFile()) continue;
      const resolvedAbsolute = path.resolve(absolute);
      if (keepActive && keepPaths.has(resolvedAbsolute)) continue;
      fs.unlinkSync(absolute);
    } catch {
      // Best-effort cleanup only.
    }
  }

  if (!keepActive) {
    state.activeTempOutputPath = '';
    state.remuxCache.clear();
    try {
      if (fs.existsSync(state.tempDir)) {
        fs.rmSync(state.tempDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup only.
    }
  } else {
    for (const [cacheKey, cachedPath] of state.remuxCache.entries()) {
      if (!fs.existsSync(cachedPath)) {
        state.remuxCache.delete(cacheKey);
      }
    }
  }

  return { ok: true, tempDir: state.tempDir, activeTempOutputPath: state.activeTempOutputPath || '' };
}

async function analyze(filePath) {
  const resolvedPath = normalizeLocalPath(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Local file does not exist: ${resolvedPath}`);
  }

  if (state.filePath && path.resolve(state.filePath) !== path.resolve(resolvedPath)) {
    clearTempOutputs({ keepActive: false });
  }

  setTempDirForFile(resolvedPath);
  ensureTempDir();

  const analysis = await probeFile(resolvedPath);
  state.filePath = resolvedPath;
  state.analysis = analysis;
  applyPreferredDefaults(analysis);

  return {
    file: resolvedPath,
    tracks: getStructuredTracks(),
    commands: analysis.commands
  };
}

function getTracks() {
  return getStructuredTracks();
}

function setActiveTracks({ audioIndex, subtitleIndex, videoIndex } = {}) {
  ensureAnalyzed();

  if (videoIndex !== undefined) {
    if (videoIndex == null) trackManager.disableTrack('video');
    else trackManager.selectTrack('video', videoIndex);
  }

  if (audioIndex !== undefined) {
    if (audioIndex == null) trackManager.disableTrack('audio');
    else trackManager.selectTrack('audio', audioIndex);
  }

  if (subtitleIndex !== undefined) {
    if (subtitleIndex == null) trackManager.disableTrack('subtitle');
    else trackManager.selectTrack('subtitle', subtitleIndex);
  }

  return getStructuredTracks();
}

// ─── Playability analysis ────────────────────────────────────────────────────
// Determines whether the selected tracks need transcoding for Chromium playback.
function analyzePlayability(analysis, currentSelection) {
  const result = {
    videoNeedsTranscode: false,
    audioNeedsTranscode: false,
    videoCodec: null,
    audioCodec: null,
    reason: null,
    canPlayDirect: false
  };

  if (!analysis?.streams) return result;

  // Check selected video track
  const videoStreams = analysis.streams.video || [];
  const videoIndex = currentSelection?.video;
  if (videoIndex != null) {
    const videoTrack = videoStreams.find((t) => Number(t.index) === Number(videoIndex)) || videoStreams[0];
    if (videoTrack) {
      const codec = String(videoTrack.codec || '').toLowerCase();
      result.videoCodec = codec;

      const isNativeVideo = CHROMIUM_NATIVE_VIDEO_CODECS.has(codec) ||
        Array.from(CHROMIUM_NATIVE_VIDEO_CODECS).some((native) => codec.startsWith(native));

      if (!isNativeVideo && codec && codec !== 'unknown') {
        result.videoNeedsTranscode = true;
        result.reason = `Video codec '${codec}' is not natively supported — will transcode to H.264`;
      }
    }
  }

  // Check selected audio track
  const audioStreams = analysis.streams.audio || [];
  const audioIndex = currentSelection?.audio;
  if (audioIndex != null) {
    const audioTrack = audioStreams.find((t) => Number(t.index) === Number(audioIndex)) || audioStreams[0];
    if (audioTrack) {
      const codec = String(audioTrack.codec || '').toLowerCase();
      result.audioCodec = codec;

      const isNativeAudio = CHROMIUM_NATIVE_AUDIO_CODECS.has(codec) ||
        Array.from(CHROMIUM_NATIVE_AUDIO_CODECS).some((native) => codec.startsWith(native));

      const isKnownUnsupported = UNSUPPORTED_AUDIO_CODECS.has(codec) ||
        Array.from(UNSUPPORTED_AUDIO_CODECS).some((u) => codec.startsWith(u));

      const isDefault = audioStreams.length === 0 || Number(audioTrack.index) === Number(audioStreams[0].index);

      if ((isKnownUnsupported || !isNativeAudio || !isDefault) && codec && codec !== 'unknown') {
        result.audioNeedsTranscode = true;
        let audioReason = `Audio codec '${codec}' is not natively supported — will transcode to AAC/PCM`;
        if (isNativeAudio && !isDefault) {
          audioReason = `Chromium cannot natively switch to non-default track (${audioTrack.index}) — using Virtual WAV Proxy`;
        }
        result.reason = result.reason ? `${result.reason}; ${audioReason}` : audioReason;
      }
    }
  }

  // Check if the original file can be played directly (no remux or transcode needed)
  const ext = path.extname(String(analysis?.file || '')).toLowerCase();
  const directPlayableContainers = ['.mp4', '.m4v', '.webm', '.mkv', '.ogg', '.ogv', '.wav', '.mp3', '.flac'];
  result.canPlayDirect = !result.videoNeedsTranscode &&
    !result.audioNeedsTranscode &&
    directPlayableContainers.includes(ext);

  return result;
}

async function remuxForPlayback({ filePath, time } = {}) {
  const resolvedFile = normalizeLocalPath(filePath || state.filePath);

  if (!state.analysis || state.filePath !== resolvedFile) {
    await analyze(resolvedFile);
  } else {
    ensureAnalyzed();
  }

  const current = trackManager.getCurrentSelection();
  const videoIndex = current.video;
  const audioIndex = current.audio;

  if (videoIndex == null) {
    throw new Error('No active video track is selected');
  }

  ensureTempDir();
  const ffmpegPath = getFfmpegPath();
  const requestedResumeTime = Number.isFinite(Number(time)) && Number(time) > 0 ? Number(time) : 0;

  // ── Check playability to decide strategy ──
  const playability = analyzePlayability(state.analysis, current);
  console.log('[DEMUX][PLAYABILITY]', {
    videoCodec: playability.videoCodec,
    audioCodec: playability.audioCodec,
    videoNeedsTranscode: playability.videoNeedsTranscode,
    audioNeedsTranscode: playability.audioNeedsTranscode,
    canPlayDirect: playability.canPlayDirect,
    reason: playability.reason
  });

  // ── Fast path: if the file is directly playable, skip remux entirely ──
  if (playability.canPlayDirect) {
    console.log('[DEMUX][FAST-PATH] File is directly playable, serving original file');
    return {
      filePath: resolvedFile,
      outputPath: resolvedFile,
      url: pathToFileURL(resolvedFile).href,
      current,
      startedAt: requestedResumeTime,
      cached: true,
      command: null,
      mode: 'direct'
    };
  }

  // ── Determine the mode ──
  const needsTranscode = playability.videoNeedsTranscode || playability.audioNeedsTranscode;
  const audioOnlyTranscode = !playability.videoNeedsTranscode && playability.audioNeedsTranscode;
  const mode = audioOnlyTranscode ? 'split' : (needsTranscode ? 'transcode' : 'copy');

  // ── Check cache ──
  const cacheKey = getRemuxCacheKey(resolvedFile, current, mode);
  const cachedOutputPath = state.remuxCache.get(cacheKey);

  if (cachedOutputPath && fs.existsSync(cachedOutputPath)) {
    state.activeTempOutputPath = cachedOutputPath;

    // For split mode, the cached path is the audio file
    if (mode === 'split') {
      return {
        filePath: resolvedFile,
        outputPath: resolvedFile,
        url: pathToFileURL(resolvedFile).href,
        audioUrl: pathToFileURL(cachedOutputPath).href,
        current,
        startedAt: requestedResumeTime,
        cached: true,
        command: null,
        mode: 'split'
      };
    }

    return {
      filePath: resolvedFile,
      outputPath: cachedOutputPath,
      url: pathToFileURL(cachedOutputPath).href,
      current,
      startedAt: requestedResumeTime,
      cached: true,
      command: null,
      mode
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPLIT MODE: Virtual WAV Audio Proxy
  // Leverages the media proxy server to generate an uncompressed PCM/WAV stream
  // on the fly, enabling perfect mathematically-aligned seeking and instant load.
  // The original file is served directly for video playback.
  // ══════════════════════════════════════════════════════════════════════════

  const duration = Number.parseFloat(state.analysis?.format?.duration || '0');
  if (duration <= 0) {
    throw new Error('Cannot use Audio Proxy: File duration is unknown or 0.');
  }

  const proxyUrl = new URL('http://127.0.0.1:18652/local-audio.wav');
  proxyUrl.searchParams.set('file', resolvedFile);
  proxyUrl.searchParams.set('duration', duration.toString());
  if (audioIndex != null) proxyUrl.searchParams.set('aindex', audioIndex.toString());

  console.log('[DEMUX][SPLIT] Serving Virtual WAV Audio Proxy:', proxyUrl.href);

  return {
    filePath: resolvedFile,
    outputPath: resolvedFile, // No temp file
    url: pathToFileURL(resolvedFile).href, // Native video playback
    audioUrl: proxyUrl.href, // Streamed audio proxy
    current,
    startedAt: requestedResumeTime,
    cached: false,
    mode: 'split',
    command: 'Virtual WAV Audio Proxy'
  };
}

async function getSubtitles() {
  ensureAnalyzed();

  const current = trackManager.getCurrentSelection();
  const subtitleIndex = current.subtitle;

  if (subtitleIndex == null) {
    return {
      supported: true,
      subtitleIndex: null,
      format: null,
      codec: null,
      text: ''
    };
  }

  const subtitleTrack = (state.analysis.streams.subtitle || []).find(
    (track) => Number(track.index) === Number(subtitleIndex)
  );

  if (!subtitleTrack) {
    return {
      supported: false,
      subtitleIndex,
      reason: 'Selected subtitle track was not found'
    };
  }

  const codec = String(subtitleTrack.codec || '').toLowerCase();
  const ffmpegPath = getFfmpegPath();

  if (codec === 'hdmv_pgs_subtitle' || codec === 'pgs') {
    return {
      supported: false,
      subtitleIndex,
      codec,
      format: null,
      reason: 'PGS subtitles are image-based and are not supported by the Electron text overlay path'
    };
  }

  let format = 'srt';
  if (codec === 'webvtt') format = 'vtt';
  if (codec === 'ass' || codec === 'ssa' || codec === 'mov_text') format = 'vtt';

  const args = [
    '-v', 'error',
    '-i', state.filePath,
    '-map', `0:${subtitleIndex}`,
    '-f', format === 'vtt' ? 'webvtt' : 'srt',
    'pipe:1'
  ];

  const { stdout } = await spawnAndCollect(ffmpegPath, args);

  return {
    supported: true,
    subtitleIndex,
    codec,
    format,
    text: stdout,
    title: subtitleTrack.title || '',
    language: subtitleTrack.language || 'und'
  };
}

function getCurrentFilePath() {
  return state.filePath || '';
}




const demuxerIntegration = {
  analyze,
  getTracks,
  setActiveTracks,
  remuxForPlayback,
  getSubtitles,
  getCurrentFilePath,
  clearTempOutputs,
  analyzePlayability
};

function createLocalVideoHelpers(deps) {
  const { path, fs, dialog, app, getFfmpegPath, demuxerIntegration } = deps;

  const registerLocalVideoHandlers = ({
    ipcMain,
    win,
    toLocalMediaUrl,
    parseSingleEntryMediaPlaylist,
    isLocalMediaPath,
    mapDemuxTracksForRenderer,
    parseSubtitleTextToCues,
    getMediaProxyOrigin
  }) => {
    ipcMain.handle('get-local-media-url', async (_event, filePath) => {
      const absolutePath = path.resolve(String(filePath || ''));
      if (!fs.existsSync(absolutePath)) return '';

      if (/\.(m3u8|m3u)$/i.test(absolutePath)) {
        try {
          const rawPlaylist = fs.readFileSync(absolutePath, 'utf8');
          const directEntry = parseSingleEntryMediaPlaylist(rawPlaylist, absolutePath);
          if (directEntry?.url) {
            return directEntry.url;
          }
        } catch {
          // Fall back to serving the playlist itself.
        }
      }

      return toLocalMediaUrl(absolutePath);
    });

    ipcMain.handle('get-media-proxy-origin', async () => {
      return typeof getMediaProxyOrigin === 'function' ? getMediaProxyOrigin() : '';
    });

    ipcMain.handle('open-local-media-file', async () => {
      const result = await dialog.showOpenDialog(win, {
        title: 'Open Video',
        properties: ['openFile'],
        filters: [
          {
            name: 'Media Files',
            extensions: ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'ts', 'm2ts', 'webm', 'm4v', 'm3u8', 'm3u']
          },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
        return null;
      }

      const selectedPath = String(result.filePaths[0] || '');
      if (!selectedPath) return null;

      return {
        path: selectedPath,
        name: path.basename(selectedPath)
      };
    });

    ipcMain.handle('ass:extractFonts', async (_event, videoPath) => {
      try {
        const resolvedVideoPath = String(videoPath || '').trim();
        if (!resolvedVideoPath || !isLocalMediaPath(resolvedVideoPath)) {
          return [];
        }

        const normalizedVideoPath = path.resolve(
          resolvedVideoPath.replace(/^file:\/\//i, '').replace(/^\/+([a-zA-Z]:)/, '$1')
        );
        if (!fs.existsSync(normalizedVideoPath)) {
          return [];
        }

        const outputDir = path.join(
          app.getPath('temp'),
          `aether-fonts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        );
        fs.mkdirSync(outputDir, { recursive: true });

        const ffmpegPath = getFfmpegPath();
        const args = ['-y', '-dump_attachment:t', '', '-i', normalizedVideoPath, '-f', 'null', '-'];

        await new Promise((resolve, reject) => {
          const child = require('child_process').spawn(ffmpegPath, args, {
            cwd: outputDir,
            stdio: ['ignore', 'ignore', 'pipe']
          });

          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });
          child.on('error', (error) => reject(error));
          child.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(stderr || `ffmpeg exited with code ${code}`));
              return;
            }
            resolve(null);
          });
        });

        const files = fs.readdirSync(outputDir)
          .filter((fileName) => /\.(ttf|otf|ttc|otc)$/i.test(fileName))
          .map((fileName) => path.join(outputDir, fileName));

        console.log('[ASS] Extracted fonts:', files);
        return files;
      } catch (error) {
        console.error('[ASS] Font extraction failed:', error);
        return [];
      }
    });

    ipcMain.handle('demux:clearTempOutputs', async (_event, payload) => {
      try {
        return demuxerIntegration.clearTempOutputs({ keepActive: !!payload?.keepActive });
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.handle('demux:analyze', async (_event, filePath) => {
      try {
        if (!isLocalMediaPath(filePath)) {
          return { error: 'demuxer-only-supports-local-files' };
        }
        return await demuxerIntegration.analyze(filePath);
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.handle('demux:getTracks', async () => {
      try {
        return demuxerIntegration.getTracks();
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.handle('demux:setTracks', async (_event, payload) => {
      try {
        return demuxerIntegration.setActiveTracks(payload || {});
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.handle('demux:remuxForPlayback', async (_event, payload) => {
      try {
        const filePath = payload?.filePath;
        if (filePath && !isLocalMediaPath(filePath)) {
          return { error: 'demuxer-only-supports-local-files' };
        }
        return await demuxerIntegration.remuxForPlayback(payload || {});
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.handle('demux:getSubtitles', async () => {
      try {
        return await demuxerIntegration.getSubtitles();
      } catch (error) {
        return { error: error.message || String(error) };
      }
    });

    ipcMain.on('get-media-tracks', async (event, filePath) => {
      try {
        if (!isLocalMediaPath(filePath)) {
          event.reply('media-tracks-info', { audioTracks: [], subtitleTracks: [] });
          return;
        }

        const analysis = await demuxerIntegration.analyze(filePath);
        const mapped = mapDemuxTracksForRenderer(analysis?.tracks || {});
        event.reply('media-tracks-info', mapped);
      } catch {
        event.reply('media-tracks-info', { audioTracks: [], subtitleTracks: [] });
      }
    });

    ipcMain.on('set-audio-track', async (event, payload) => {
      try {
        const currentTracks = demuxerIntegration.getTracks();
        const requestedIndex = payload?.index;
        const currentTime = Number(payload?.currentTime || 0);

        const nextTracks = demuxerIntegration.setActiveTracks({ audioIndex: requestedIndex });
        const remuxResult = await demuxerIntegration.remuxForPlayback({
          filePath: demuxerIntegration.getCurrentFilePath ? demuxerIntegration.getCurrentFilePath() : undefined,
          time: currentTime
        });

        event.reply('media-tracks-info', mapDemuxTracksForRenderer(nextTracks));
        event.reply('audio-track-switched', {
          streamUrl: remuxResult.url,
          currentTime,
          selectedAudio: nextTracks?.current?.audio,
          previousAudio: currentTracks?.current?.audio ?? null
        });
      } catch (error) {
        event.reply('local-track-error', {
          message: error?.message || 'Failed to switch audio track.'
        });
      }
    });

    ipcMain.on('extract-subtitle-track', async (event, subtitleIndex) => {
      try {
        demuxerIntegration.setActiveTracks({ subtitleIndex });
        const subtitleResult = await demuxerIntegration.getSubtitles();

        if (!subtitleResult || subtitleResult.error || !subtitleResult.supported) {
          event.reply('extracted-subtitles', []);
          return;
        }

        const cues = parseSubtitleTextToCues(subtitleResult.text || '');
        event.reply('extracted-subtitles', cues);
      } catch {
        event.reply('extracted-subtitles', []);
      }
    });
  };

  return {
    registerLocalVideoHandlers
  };
};

module.exports = {
  demuxerIntegration,
  createLocalVideoHelpers
};
