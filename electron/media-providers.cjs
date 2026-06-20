// ═══════════════════════════════════════════════════════════════════════════════
// media-providers.cjs
// Merged from: provider-registry.cjs, optional-site-sections.cjs,
//              site-policy-main.cjs, shared-media-main.cjs
// ═══════════════════════════════════════════════════════════════════════════════

// ── Provider Registry ────────────────────────────────────────────────────────

function createProviderRegistry({ deps }) {
  const loadedProviders = [];

  const safeArray = (value) => (Array.isArray(value) ? value : []);

  const loadProviders = () => {
    try {
      const factory = require('./mega.nz-main.cjs');
      if (typeof factory === 'function') {
        const provider = factory(deps || {});
        if (provider && typeof provider === 'object' && provider.id) {
          loadedProviders.push({
            priority: Number(provider.priority || 0),
            ...provider
          });
          console.log(`[providers] Loaded: ${provider.id}`);
        }
      }
    } catch (error) {
      console.warn(`[providers] Skipped mega.nz-main.cjs:`, error?.message || error);
    }

    loadedProviders.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    return loadedProviders;
  };

  loadProviders();

  const getProviders = () => [...loadedProviders];

  const getPageProviders = (rawUrl) =>
    loadedProviders.filter((provider) => {
      try {
        return typeof provider.matchesPage === 'function' && provider.matchesPage(rawUrl);
      } catch {
        return false;
      }
    });

  const getHostProviders = (host) =>
    loadedProviders.filter((provider) => {
      try {
        if (typeof provider.matchesRequestHost === 'function' && provider.matchesRequestHost(host)) return true;
        if (typeof provider.matchesMediaHost === 'function' && provider.matchesMediaHost(host)) return true;
        return false;
      } catch {
        return false;
      }
    });

  const buildProxyHeaders = (pageUrl, mediaUrl, fallbackBuilder = null) => {
    const targetHost = (() => {
      try {
        return new URL(String(mediaUrl || '').trim()).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();

    const ordered = [
      ...getPageProviders(pageUrl),
      ...getHostProviders(targetHost)
    ];

    for (const provider of ordered) {
      try {
        if (typeof provider.buildProxyHeaders === 'function') {
          const headers = provider.buildProxyHeaders(pageUrl, mediaUrl);
          if (headers && typeof headers === 'object') return headers;
        }
      } catch (error) {
        console.warn(`[providers] buildProxyHeaders failed for ${provider.id}:`, error?.message || error);
      }
    }

    return typeof fallbackBuilder === 'function' ? fallbackBuilder(pageUrl, mediaUrl) : null;
  };

  const applyRequestHeaders = ({ details, headers }) => {
    const host = (() => {
      try {
        return new URL(String(details?.url || '')).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();

    let nextHeaders = { ...(headers || {}) };
    for (const provider of getHostProviders(host)) {
      try {
        if (typeof provider.applyRequestHeaders === 'function') {
          nextHeaders = provider.applyRequestHeaders({ details, headers: nextHeaders }) || nextHeaders;
        }
      } catch (error) {
        console.warn(`[providers] applyRequestHeaders failed for ${provider.id}:`, error?.message || error);
      }
    }

    return nextHeaders;
  };

  const runRouteInterceptors = async (context) => {
    for (const provider of getPageProviders(context?.pageUrl)) {
      try {
        if (typeof provider.interceptRoute !== 'function') continue;
        const result = await provider.interceptRoute(context);
        if (result && typeof result === 'object' && result.handled) {
          return result;
        }
      } catch (error) {
        console.warn(`[providers] interceptRoute failed for ${provider.id}:`, error?.message || error);
      }
    }
    return null;
  };

  const waitAfterNavigation = async (context) => {
    for (const provider of getPageProviders(context?.pageUrl)) {
      try {
        if (typeof provider.waitAfterNavigation === 'function') {
          await provider.waitAfterNavigation(context);
        }
      } catch (error) {
        console.warn(`[providers] waitAfterNavigation failed for ${provider.id}:`, error?.message || error);
      }
    }
  };

  const resolveCapturedPage = async (context) => {
    for (const provider of getPageProviders(context?.pageUrl)) {
      try {
        if (typeof provider.resolveCapturedPage !== 'function') continue;
        const result = await provider.resolveCapturedPage(context);
        if (result?.url) {
          return { providerId: provider.id, payload: result };
        }
      } catch (error) {
        console.warn(`[providers] resolveCapturedPage failed for ${provider.id}:`, error?.message || error);
      }
    }
    return null;
  };

  const resolveStandalone = async (context) => {
    for (const provider of getPageProviders(context?.pageUrl)) {
      try {
        if (typeof provider.resolveStandalone !== 'function') continue;
        const result = await provider.resolveStandalone(context);
        if (!result) continue;

        if (result?.handled) {
          return {
            providerId: provider.id,
            handled: true,
            payload: result?.payload || null
          };
        }

        if (result?.url) {
          return {
            providerId: provider.id,
            handled: false,
            payload: result
          };
        }
      } catch (error) {
        console.warn(`[providers] resolveStandalone failed for ${provider.id}:`, error?.message || error);
      }
    }
    return null;
  };

  const shouldCaptureUrl = ({ pageUrl, url }) => {
    const providers = getPageProviders(pageUrl);
    for (const provider of providers) {
      try {
        if (typeof provider.isUsefulCaptureUrl === 'function' && provider.isUsefulCaptureUrl(url)) {
          return true;
        }
      } catch {
        // Ignore provider failure.
      }
    }
    return false;
  };

  const getPageFlags = (pageUrl) => ({
    isHstream: getPageProviders(pageUrl).some((provider) => provider.id === 'hstream'),
    isHanime: getPageProviders(pageUrl).some((provider) => provider.id === 'hanime'),
    isOppaiStream: getPageProviders(pageUrl).some((provider) => provider.id === 'oppaistream')
  });

  return {
    getProviders,
    getPageProviders,
    getHostProviders,
    getPageFlags,
    buildProxyHeaders,
    applyRequestHeaders,
    runRouteInterceptors,
    waitAfterNavigation,
    resolveCapturedPage,
    resolveStandalone,
    shouldCaptureUrl,
    safeArray
  };
}

// ── Optional Site Sections ───────────────────────────────────────────────────

const loadOptionalFactory = (modulePath, label, fallbackFactory) => {
  try {
    return require(modulePath);
  } catch (error) {
    console.warn(`[optional-sections] Optional module missing or failed to load (${label}):`, error?.message || error);
    return typeof fallbackFactory === 'function' ? fallbackFactory : (() => ({}));
  }
};

const createNoopGenericCaptureHelpers = () => ({
  fetchMainPlayableVideoUrl: async () => null
});

const createGenericCaptureHelpers = loadOptionalFactory('./generic-capture-main.cjs', 'generic-capture-main.cjs', createNoopGenericCaptureHelpers);

function createOptionalSiteSections(deps) {
  const {
    fs,
    path,
    baseDir,
    http,
    https,
    playwright,
    playwrightExecutablePath,
    DESKTOP_USER_AGENT,
    proxyHttpAgent,
    proxyHttpsAgent,
    genericPlaywrightCache,
    isLikelyThumbnailUrl,
    buildCapturedSubtitleDescriptor,
    parsePotentialJsonOutput,
    extractLanguageFromUrl,
    getReadableLanguageName,
    isDirectBinaryMediaPath,
    maybeProxifyUrl,
    sendMediaReady,
    session,
    adBlockManager,
    providerExtraDeps = {}
  } = deps;

  const providerRegistry = createProviderRegistry({
    fs,
    path,
    providersDir: path.join(baseDir, 'providers'),
    deps: {
      http,
      https,
      DESKTOP_USER_AGENT,
      proxyHttpAgent,
      proxyHttpsAgent,
      isLikelyThumbnailUrl,
      buildCapturedSubtitleDescriptor,
      parsePotentialJsonOutput,
      extractLanguageFromUrl,
      getReadableLanguageName,
      isDirectBinaryMediaPath,
      playwright,
      maybeProxifyUrl,
      sendMediaReady,
      ...providerExtraDeps
    }
  });

  const genericCaptureHelpers = createGenericCaptureHelpers({
    playwright,
    playwrightExecutablePath,
    session,
    DESKTOP_USER_AGENT,
    genericPlaywrightCache,
    parsePotentialJsonOutput,
    extractLanguageFromUrl,
    buildCapturedSubtitleDescriptor,
    isLikelyThumbnailUrl,
    isDirectBinaryMediaPath,
    providerRegistry,
    adBlockManager
  });

  return {
    providerRegistry,
    fetchMainPlayableVideoUrl: genericCaptureHelpers.fetchMainPlayableVideoUrl
  };
}

// ── Site Policy Helpers ──────────────────────────────────────────────────────

function createSitePolicyHelpers(deps) {
  const {
    DESKTOP_USER_AGENT,
    PRIMARY_FORMAT
  } = deps;

  const DIRECT_MEDIA_BYPASS_HOST = 'myspacecat.pictures';

  const getExtractorProfiles = (url) => {
    const lowerUrl = String(url || '').toLowerCase();
    const isYoutube =
      lowerUrl.includes('youtube.com') ||
      lowerUrl.includes('youtu.be') ||
      lowerUrl.includes('music.youtube.com');
    const isDrive =
      lowerUrl.includes('drive.google.com') ||
      lowerUrl.includes('drive.usercontent.google.com') ||
      lowerUrl.includes('.c.drive.google.com');
    const isPixeldrain = lowerUrl.includes('pixeldrain.com');

    const shouldTryCookies = true;

    let defaultReferer = '';
    try {
      const parsed = new URL(url);
      defaultReferer = `${parsed.protocol}//${parsed.hostname}/`;
    } catch {}

    const baseOptions = {
      dumpSingleJson: true,
      noCheckCertificates: true,
      referer: defaultReferer,
      socketTimeout: 20,
      ...(isYoutube ? { 
        noPlaylist: true,
        extractorArgs: 'youtube:player-client=android_vr'
      } : {}),
      ...(isPixeldrain ? { referer: 'https://pixeldrain.com/' } : {})
    };

    const profiles = [
      {
        name: 'primary-mp4',
        options: {
          ...baseOptions,
          format: PRIMARY_FORMAT
        }
      },
      {
        name: 'fallback-best',
        options: {
          ...baseOptions,
          format: 'best'
        }
      },
      {
        name: 'fallback-progressive-mp4',
        options: {
          ...baseOptions,
          format: 'best[ext=mp4][acodec!=none][vcodec!=none]/best[ext=mp4]/best'
        }
      }
    ];

    if (shouldTryCookies) {
      const sourceTag = isDrive ? 'drive' : isPixeldrain ? 'pixeldrain' : isYoutube ? 'youtube' : 'generic';

      ['firefox', 'chrome', 'edge', 'brave'].forEach((browser) => {
        profiles.push({
          name: `${sourceTag}-cookies-${browser}`,
          options: {
            ...baseOptions,
            format: PRIMARY_FORMAT,
            cookiesFromBrowser: browser,
            ...(isPixeldrain
              ? {
                  addHeader: [
                    `User-Agent: ${DESKTOP_USER_AGENT}`,
                    'Accept-Language: en-US,en;q=0.9'
                  ]
                }
              : {})
          }
        });
        profiles.push({
          name: `${sourceTag}-cookies-${browser}-best`,
          options: {
            ...baseOptions,
            format: 'best',
            cookiesFromBrowser: browser,
            ...(isPixeldrain
              ? {
                  addHeader: [
                    `User-Agent: ${DESKTOP_USER_AGENT}`,
                    'Accept-Language: en-US,en;q=0.9'
                  ]
                }
              : {})
          }
        });
      });
    }

    return profiles;
  };

  const shouldBypassProxyForDirectMediaHost = (host) => String(host || '').toLowerCase().includes(DIRECT_MEDIA_BYPASS_HOST);

  return {
    DIRECT_MEDIA_BYPASS_HOST,
    shouldBypassProxyForDirectMediaHost,
    getExtractorProfiles
  };
}

// ── Shared Media Helpers ─────────────────────────────────────────────────────

function createSharedMediaHelpers(deps) {
  const {
    maybeProxifyUrl,
    isPixeldrainHost,
    isDriveMediaHost,
    normalizeManifestQueryUrl
  } = deps;

  const isKnownPlayableStreamUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const mimeType = String(parsed.searchParams.get('mime') || '').toLowerCase();

      if (
        host === '127.0.0.1' &&
        (pathname === '/proxy' || pathname === '/local-media' || pathname === '/pixeldrain-stream')
      ) {
        return true;
      }
      if (isPixeldrainHost(host) && pathname.startsWith('/api/file/')) return true;
      if (
        isDriveMediaHost(host) &&
        (pathname.includes('videoplayback') || pathname.startsWith('/uc') || pathname.startsWith('/download'))
      ) {
        return true;
      }

      return (
        /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m3u8|mpd)$/i.test(pathname) ||
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
      const matched = finalSubtitles.find(
        (sub) => String(sub.url || '').trim() === maybeProxifyUrl(requestedDefault, sub?.proxyHeaders || payload?.proxyHeaders || null)
      );
      if (matched?.url) return matched.url;
      const directMatch = finalSubtitles.find((sub) => String(sub.url || '').trim() === requestedDefault);
      return directMatch?.url || null;
    })();

    const finalPayload = {
      ...normalized,
      subtitles: finalSubtitles,
      defaultSubtitleUrl: resolvedDefaultSubtitleUrl
    };

    console.log('>>> PLAYING URL:', finalPayload.url);
    event.reply('media-stream-ready', finalPayload);
  };

  const resolveDirectMediaUrl = (rawUrl) => {
    try {
      const parsed = new URL(normalizeManifestQueryUrl(String(rawUrl || '').trim()));
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      const mimeType = String(parsed.searchParams.get('mime') || '').toLowerCase();
      const hasDirectExtension = /\.(mp4|webm|ogg|mkv|mov|avi|m4v|m3u8|mpd)$/i.test(parsed.pathname);
      const isDriveVideoPlayback =
        pathname.includes('videoplayback') ||
        host.endsWith('.c.drive.google.com') ||
        host.includes('googlevideo.com') ||
        (host.includes('drive.google.com') && pathname.includes('videoplayback'));
      const hasVideoMime =
        mimeType.startsWith('video/') ||
        mimeType.includes('mpegurl') ||
        mimeType.includes('x-mpegurl') ||
        mimeType.includes('dash') ||
        mimeType.includes('mpd');

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

  return {
    isKnownPlayableStreamUrl,
    sanitizeMediaStreamPayload,
    sendMediaReady,
    resolveDirectMediaUrl,
    parseSubtitleTimecode,
    parseSubtitleTextToCues,
    mapDemuxTracksForRenderer
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createProviderRegistry,
  createOptionalSiteSections,
  createSitePolicyHelpers,
  createSharedMediaHelpers
};
