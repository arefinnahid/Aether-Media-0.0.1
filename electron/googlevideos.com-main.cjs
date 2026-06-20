/**
 * googlevideos.com-main.cjs
 *
 * Consolidated YouTube + Google Drive extraction logic.
 * Moved from main.cjs and youtube-drive-main.cjs to keep
 * main.cjs focused on proxy / IPC orchestration.
 *
 * Usage in main.cjs:
 *   const createGoogleVideosModule = require('./googlevideos.com-main.cjs');
 *   const gvm = createGoogleVideosModule({ ...earlyDeps });
 *   // later, after proxy server is created:
 *   gvm.setDeps({ maybeProxifyUrl, buildOnlineStreamPayload });
 */

module.exports = function createGoogleVideosModule(deps) {
  const {
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
  } = deps;

  // Late-bound dependencies (set via setDeps after proxy server is created)
  const lateDeps = {
    buildOnlineStreamPayload: null,
    maybeProxifyUrl: null,
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – Audio / Codec helpers
  // ═══════════════════════════════════════════════════════════════════

  const pickBalancedAudio = (list) => {
    if (!Array.isArray(list) || list.length === 0) return null;
    const sorted = [...list].sort((a, b) => {
      if (a.ext === 'm4a' && b.ext !== 'm4a') return -1;
      if (b.ext === 'm4a' && a.ext !== 'm4a') return 1;
      return Number(b?.abr || 0) - Number(a?.abr || 0);
    });

    return (
      sorted.find((format) => Number(format?.abr || 0) >= 96 && Number(format?.abr || 0) <= 160) ||
      sorted.find((format) => Number(format?.abr || 0) <= 192) ||
      sorted[0] ||
      null
    );
  };

  const getYoutubeCodecPriority = (codec, height = 0) => {
    const value = String(codec || '').toLowerCase();
    if (!value || value === 'none') return 0;
    if (value.startsWith('avc1') || value.includes('h264')) return 4;
    if (value.startsWith('vp9') || value.startsWith('vp09')) return height > 1080 ? 3.5 : 3;
    if (value.startsWith('av01')) return height > 1080 ? 2.5 : 2;
    return 1;
  };

  const getYoutubeContainerPriority = (ext) => {
    const value = String(ext || '').toLowerCase();
    if (value === 'mp4' || value === 'm4v') return 3;
    if (value === 'webm') return 2;
    return 1;
  };

  const getYoutubeBitrateFitScore = (height, bitrate, fps = 0) => {
    const normalizedHeight = Number(height || 0);
    const normalizedBitrate = Number(bitrate || 0);
    const normalizedFps = Number(fps || 0);
    const target = normalizedHeight >= 2160
      ? 22000
      : normalizedHeight >= 1440
        ? 16000
        : normalizedHeight >= 1080
          ? 10000
          : normalizedHeight >= 720
            ? 6500
            : 3500;

    if (normalizedBitrate <= 0) return 2;
    if (normalizedBitrate <= target) return normalizedFps > 30 ? 2.5 : 3;
    if (normalizedBitrate <= target * 1.35) return 2;
    if (normalizedBitrate <= target * 1.8) return 1;
    return 0;
  };

  const compareYoutubeCandidates = (a, b) => {
    const score = (candidate) => {
      const height = Number(candidate?.height || 0);
      const fps = Number(candidate?.fps || 0);
      const bitrate = Number(candidate?.bitrate || 0);
      const codecPriority = getYoutubeCodecPriority(candidate?.codec, height);
      const containerPriority = getYoutubeContainerPriority(candidate?.ext);
      const bitrateFit = getYoutubeBitrateFitScore(height, bitrate, fps);
      return [
        candidate.preferred ? 1 : 0,
        candidate.playbackFriendly ? 1 : 0,
        codecPriority,
        containerPriority,
        candidate.hasAudio ? 1 : 0,
        candidate.audioUrl ? 1 : 0,
        fps > 30 ? 0 : 1,
        bitrateFit,
        height,
        -fps,
        -bitrate
      ];
    };

    const left = score(a);
    const right = score(b);
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return right[i] - left[i];
    }
    return 0;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – Language map & helpers
  // ═══════════════════════════════════════════════════════════════════

  const YOUTUBE_LANGUAGE_MAP = {
    'en': 'English',
    'es': 'Spanish',
    'hi': 'Hindi',
    'bn': 'Bangla',
    'ta': 'Tamil',
    'te': 'Telugu',
    'mr': 'Marathi',
    'gu': 'Gujarati',
    'kn': 'Kannada',
    'ml': 'Malayalam',
    'pa': 'Punjabi',
    'ur': 'Urdu',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'zh-hans': 'Chinese (Simplified)',
    'zh-hant': 'Chinese (Traditional)',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'ru': 'Russian',
    'pt': 'Portuguese',
    'pt-br': 'Portuguese (Brazil)',
    'ar': 'Arabic',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'tr': 'Turkish',
    'pl': 'Polish',
    'nl': 'Dutch',
    'sv': 'Swedish',
    'no': 'Norwegian',
    'da': 'Danish',
    'fi': 'Finnish',
    'uk': 'Ukrainian',
    'cs': 'Czech',
    'el': 'Greek',
    'th': 'Thai',
    'ms': 'Malay',
    'fa': 'Persian',
    'he': 'Hebrew'
  };

  const getCleanAudioCodecName = (format) => {
    const acodec = String(format?.acodec || '').toLowerCase();
    const ext = String(format?.ext || '').toLowerCase();
    if (acodec.includes('opus')) return 'OPUS';
    if (acodec.includes('mp4a') || acodec.includes('aac')) return 'AAC';
    if (acodec.includes('mp3')) return 'MP3';
    if (acodec.includes('wav') || acodec.includes('pcm')) return 'WAV';
    if (ext === 'm4a') return 'AAC';
    if (ext === 'mp3') return 'MP3';
    if (ext === 'wav') return 'WAV';
    const match = acodec.match(/^([a-zA-Z0-9_-]+)/);
    return match ? match[1].toUpperCase() : (acodec.toUpperCase() || ext.toUpperCase() || 'AUDIO');
  };

  const getYoutubeLanguageName = (langCode, formatNote) => {
    const code = String(langCode || '').toLowerCase().trim();
    if (YOUTUBE_LANGUAGE_MAP[code]) {
      return YOUTUBE_LANGUAGE_MAP[code];
    }
    const baseCode = code.split('-')[0];
    if (YOUTUBE_LANGUAGE_MAP[baseCode]) {
      return YOUTUBE_LANGUAGE_MAP[baseCode];
    }
    if (formatNote && typeof formatNote === 'string') {
      const parts = formatNote.split(',').map(p => p.trim());
      if (parts[0] && parts[0].length > 1) {
        const pLower = parts[0].toLowerCase();
        if (!['low', 'medium', 'high', 'tiny', 'original', 'default'].includes(pLower)) {
          let cleanPart = parts[0].replace(/\boriginal\b/gi, '').replace(/\bdefault\b/gi, '').trim();
          cleanPart = cleanPart.replace(/\s+/g, ' ');
          if (cleanPart) return cleanPart;
        }
      }
    }
    return null;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – Audio track grouping
  // ═══════════════════════════════════════════════════════════════════

  const groupYoutubeAudioTracks = (audioCandidates, reliableAudioCandidates) => {
    // Build a fast-lookup set of reliable format IDs/URLs so we can prefer
    // non-MISSING-POT candidates when multiple URLs exist for the same language.
    const reliableKeys = new Set(
      (reliableAudioCandidates || []).map(f => String(f.format_id || f.url || ''))
    );

    const groups = new Map();
    for (const format of audioCandidates) {
      const lang = String(format.language || 'original').toLowerCase();
      if (!groups.has(lang)) groups.set(lang, { reliable: [], all: [] });
      const g = groups.get(lang);
      if (reliableKeys.has(String(format.format_id || format.url || ''))) {
        g.reliable.push(format);
      }
      g.all.push(format);
    }

    const tracks = [];
    let index = 0;
    for (const [lang, { reliable, all }] of groups.entries()) {
      // Prefer a reliable (non-MISSING-POT) URL; only fall back to an iOS/POT
      // URL if no reliable alternative exists for this language.
      const hasReliable = reliable.length > 0;
      const candidatePool = hasReliable ? reliable : all;
      const bestAudio = pickBalancedAudio(candidatePool);
      if (!bestAudio) continue;

      // isMissingPot=true means every URL for this language requires a PO token
      // and will return HTTP 403 when proxied without one.
      const isMissingPot = !hasReliable;

      let isOriginal = lang === 'original' || lang === 'und' || bestAudio.language === null || !!bestAudio.is_original_audio || !!bestAudio.is_default;
      if (bestAudio.format_note && typeof bestAudio.format_note === 'string') {
        if (bestAudio.format_note.toLowerCase().includes('original')) isOriginal = true;
      }

      const rawLangName = getYoutubeLanguageName(bestAudio.language, bestAudio.format_note);
      const languageName = rawLangName || (isOriginal ? 'Original' : String(bestAudio.language || 'Unknown').toUpperCase());
      const codec = getCleanAudioCodecName(bestAudio);
      const label = `[${codec}] ${languageName}${isOriginal ? ' (Original)' : ''}`;

      tracks.push({
        id: `yt-audio-${lang}`,
        index: index++,
        label,
        title: label,
        badge: codec,
        url: bestAudio.url,
        selectedQuality: bestAudio.url,
        qualities: [{ label: 'Source', value: bestAudio.url, audioTrackId: `yt-audio-${lang}` }],
        isOriginal,
        isMissingPot,
      });
    }

    // Sort: Original first, then alphabetical by label
    tracks.sort((a, b) => {
      if (a.isOriginal && !b.isOriginal) return -1;
      if (!a.isOriginal && b.isOriginal) return 1;
      return a.label.localeCompare(b.label);
    });

    tracks.forEach((t, i) => { t.index = i; });
    return tracks;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – POT / format helpers
  // ═══════════════════════════════════════════════════════════════════

  // Formats from iOS client that lack a PO Token are tagged "MISSING POT" in format_note.
  // These URLs will return HTTP 403 when streamed, so we must exclude them from video
  // and primary audio selection while still allowing them in the dubbed audio track list.
  const isMissingPotFormat = (format) => {
    const note = String(format?.format_note || '').toLowerCase();
    return note.includes('missing pot');
  };

  const parseYoutubeiPlayerResponse = (playerJson, pageUrl) => {
    const adaptiveFormats = playerJson?.streamingData?.adaptiveFormats || [];
    const formatsList = playerJson?.streamingData?.formats || [];
    const allFormats = [...adaptiveFormats, ...formatsList];

    const title = playerJson?.videoDetails?.title || 'YouTube Video';

    const formats = allFormats.map((format, idx) => {
      const isAudio = String(format.mimeType || '').startsWith('audio/');
      const mimeType = String(format.mimeType || '');

      // Parse codecs
      const codecsMatch = mimeType.match(/codecs="([^"]+)"/);
      const codecs = codecsMatch ? codecsMatch[1] : '';

      const isOriginal = format.audioTrack?.id ? format.audioTrack.id.includes('default') : true;

      // Map language
      let lang = null;
      if (format.audioTrack?.id) {
        lang = format.audioTrack.id.split('.')[0];
      }

      return {
        url: format.url,
        vcodec: isAudio ? 'none' : (codecs || 'video'),
        acodec: isAudio ? (codecs || 'audio') : 'none',
        protocol: 'https',
        format_id: String(format.itag),
        height: format.height || 0,
        fps: format.fps || 0,
        tbr: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
        vbr: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
        abr: isAudio ? (format.bitrate ? Math.round(format.bitrate / 1000) : 128) : 0,
        ext: mimeType.includes('webm') ? 'webm' : 'mp4',
        language: lang,
        format_note: format.audioTrack?.displayName || (isAudio ? (isOriginal ? 'Original' : 'Audio') : ''),
        is_original_audio: isOriginal,
        is_default: !!format.audioTrack?.audioIsDefault,
        http_headers: {
          'User-Agent': DESKTOP_USER_AGENT,
          'Referer': 'https://www.youtube.com/'
        }
      };
    });

    return {
      title,
      formats,
      manifest_url: playerJson?.streamingData?.dashManifestUrl || '',
      hls_manifest_url: playerJson?.streamingData?.hlsManifestUrl || '',
      http_headers: {
        'User-Agent': DESKTOP_USER_AGENT,
        'Referer': 'https://www.youtube.com/'
      }
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – Session builder
  // ═══════════════════════════════════════════════════════════════════

  const buildYoutubeSession = (rawOutput) => {
    const output = pickMediaNode(rawOutput);
    const formats = Array.isArray(output?.formats) ? output.formats : [];

    // Separate reliable formats (android_vr) from potentially broken ones (iOS MISSING POT)
    const reliableFormats = formats.filter(f => !isMissingPotFormat(f));
    // ALL audio candidates (including MISSING POT) for the dubbed track list
    const allAudioCandidates = formats.filter(
      (format) =>
        !!format?.url &&
        format.vcodec === 'none' &&
        format.acodec &&
        format.acodec !== 'none' &&
        typeof format.protocol === 'string' &&
        isDirectHttpProtocol(format.protocol) &&
        format.protocol !== 'http_dash_segments'
    );

    // Reliable audio candidates only (for primary audio pairing with video)
    const reliableAudioCandidates = allAudioCandidates.filter(f => !isMissingPotFormat(f));

    const audioTracks = groupYoutubeAudioTracks(allAudioCandidates, reliableAudioCandidates);
    // bestAudio must use a reliable (non-MISSING-POT) URL for primary playback
    const reliableBestAudio = reliableAudioCandidates.length > 0
      ? pickBalancedAudio(reliableAudioCandidates)
      : null;
    const bestAudioFormat = reliableBestAudio || allAudioCandidates[0] || null;
    if (bestAudioFormat && !bestAudioFormat.proxyHeaders) {
      bestAudioFormat.proxyHeaders = pickSafeProxyHeaders(bestAudioFormat.http_headers || output?.http_headers);
    }
    const bestAudio = bestAudioFormat ? { url: bestAudioFormat.url } : (audioTracks.length > 0 ? { url: audioTracks[0].url } : null);
    const bestAudioAny = bestAudio;
    const dashManifestUrl = String(output?.manifest_url || '').trim();
    const hlsManifestUrl = String(output?.hls_manifest_url || '').trim();

    const entriesByLabel = new Map();

    const addFormats = (list, meta) => {
      list.forEach((format) => {
        const label = makeQualityLabel(format);
        const formatId = getFormatId(format);
        const candidate = {
          id: label,
          label,
          height: getNormalizedHeight(format) || 0,
          fps: Number(format?.fps || 0),
          url: format.url,
          hasAudio: meta.hasAudio,
          audioUrl: meta.hasAudio ? null : meta.audioUrl || null,
          formatId,
          preferred: meta.preferred,
          playbackFriendly: meta.playbackFriendly,
          bitrate: Number(format?.tbr || format?.vbr || 0),
          codec: String(format?.vcodec || ''),
          audioCodec: String(format?.acodec || ''),
          ext: format.ext || 'mp4',
          isManifestBacked: meta.transport === 'dash-manifest' || meta.transport === 'hls-manifest',
          transport: meta.transport || 'direct',
          proxyHeaders: pickSafeProxyHeaders(format.http_headers || output?.http_headers)
        };

        const existing = entriesByLabel.get(label);
        if (!existing || compareYoutubeCandidates(existing, candidate) > 0) {
          entriesByLabel.set(label, candidate);
        }
      });
    };

    // Use reliableFormats for all video selection to avoid MISSING POT (403) URLs
    const progressiveAvc = reliableFormats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          isSupportedVideoCodec(format.vcodec) &&
          (format.ext === 'mp4' || format.ext === 'm4v') &&
          format.acodec &&
          format.acodec !== 'none' &&
          isSupportedAudioCodec(format.acodec) &&
          !!getNormalizedHeight(format) &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol) &&
          format.protocol !== 'http_dash_segments'
      )
      .sort(scoreByQuality);

    const adaptiveAvc = reliableFormats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          isSupportedVideoCodec(format.vcodec) &&
          (format.ext === 'mp4' || format.ext === 'm4v') &&
          (!format.acodec || format.acodec === 'none') &&
          !!getNormalizedHeight(format) &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol) &&
          format.protocol !== 'http_dash_segments'
      )
      .sort(scoreByQuality);

    const progressiveExtended = reliableFormats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          isExtendedVideoCodec(format.vcodec) &&
          (format.ext === 'mp4' || format.ext === 'm4v' || format.ext === 'webm') &&
          format.acodec &&
          format.acodec !== 'none' &&
          !!getNormalizedHeight(format) &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol) &&
          format.protocol !== 'http_dash_segments'
      )
      .sort(scoreByQuality);

    const adaptiveExtended = reliableFormats
      .filter(
        (format) =>
          !!format?.url &&
          format.vcodec &&
          format.vcodec !== 'none' &&
          isExtendedVideoCodec(format.vcodec) &&
          (format.ext === 'mp4' || format.ext === 'm4v' || format.ext === 'webm') &&
          (!format.acodec || format.acodec === 'none') &&
          !!getNormalizedHeight(format) &&
          typeof format.protocol === 'string' &&
          isDirectHttpProtocol(format.protocol) &&
          format.protocol !== 'http_dash_segments'
      )
      .sort(scoreByQuality);

    addFormats(progressiveAvc, {
      hasAudio: true,
      audioUrl: null,
      preferred: true,
      playbackFriendly: true,
      transport: 'direct'
    });

    addFormats(adaptiveAvc, {
      hasAudio: false,
      audioUrl: bestAudio?.url || null,
      preferred: true,
      playbackFriendly: true,
      transport: 'direct'
    });

    addFormats(progressiveExtended, {
      hasAudio: true,
      audioUrl: null,
      preferred: true,
      playbackFriendly: true,
      transport: 'direct'
    });

    addFormats(adaptiveExtended, {
      hasAudio: false,
      audioUrl: bestAudio?.url || bestAudioAny?.url || null,
      preferred: true,
      playbackFriendly: true,
      transport: 'direct'
    });

    const qualities = Array.from(entriesByLabel.values()).sort((a, b) => {
      if (b.height !== a.height) return b.height - a.height;
      if ((a.hasAudio ? 1 : 0) !== (b.hasAudio ? 1 : 0)) {
        return (b.hasAudio ? 1 : 0) - (a.hasAudio ? 1 : 0);
      }
      if ((a.playbackFriendly ? 1 : 0) !== (b.playbackFriendly ? 1 : 0)) {
        return (b.playbackFriendly ? 1 : 0) - (a.playbackFriendly ? 1 : 0);
      }
      return b.fps - a.fps;
    });

    const pickBestCandidate = (list) => {
      if (!list.length) return null;
      return [...list].sort(compareYoutubeCandidates)[0];
    };

    const smoothMuxed = qualities.filter((entry) => entry.hasAudio && (!entry.fps || entry.fps <= 30));
    const preferredMuxed = qualities.filter((entry) => entry.hasAudio && entry.preferred);
    const smoothPreferred = qualities.filter((entry) => entry.preferred && (!entry.fps || entry.fps <= 30));
    const smoothPlaybackFriendly = qualities.filter(
      (entry) => entry.playbackFriendly && (!entry.fps || entry.fps <= 30)
    );
    const preferredPlaybackFriendly = qualities.filter((entry) => entry.playbackFriendly);

    const ultraHdPreferred = qualities.filter((entry) => entry.height >= 2160);
    const quadHdPreferred = qualities.filter((entry) => entry.height >= 1440 && entry.height < 2160);
    const fullHdPreferred = qualities.filter((entry) => entry.height === 1080);
    const hdPreferred = qualities.filter((entry) => entry.height === 720);

    const selected =
      pickBestCandidate(ultraHdPreferred.filter((entry) => entry.playbackFriendly)) ||
      pickBestCandidate(ultraHdPreferred) ||
      pickBestCandidate(quadHdPreferred.filter((entry) => entry.playbackFriendly)) ||
      pickBestCandidate(quadHdPreferred) ||
      pickBestCandidate(fullHdPreferred.filter((entry) => entry.playbackFriendly && (!entry.fps || entry.fps <= 30))) ||
      pickBestCandidate(fullHdPreferred.filter((entry) => entry.playbackFriendly)) ||
      pickBestCandidate(fullHdPreferred) ||
      pickBestCandidate(hdPreferred.filter((entry) => entry.playbackFriendly && (!entry.fps || entry.fps <= 30))) ||
      pickBestCandidate(hdPreferred.filter((entry) => entry.playbackFriendly)) ||
      pickBestCandidate(hdPreferred) ||
      pickBestCandidate(smoothPreferred.filter((entry) => entry.height >= 480)) ||
      pickBestCandidate(smoothPlaybackFriendly) ||
      pickBestCandidate(smoothPreferred) ||
      pickBestCandidate(preferredPlaybackFriendly) ||
      pickBestCandidate(preferredMuxed) ||
      pickBestCandidate(qualities) ||
      null;

    const startupSelected =
      pickBestCandidate(smoothMuxed.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(preferredMuxed.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(smoothPlaybackFriendly.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(preferredPlaybackFriendly.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(smoothPreferred.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(qualities.filter((entry) => entry.height === 1080)) ||
      pickBestCandidate(smoothMuxed.filter((entry) => entry.height === 720)) ||
      pickBestCandidate(preferredMuxed.filter((entry) => entry.height === 720)) ||
      pickBestCandidate(smoothPlaybackFriendly.filter((entry) => entry.height === 720)) ||
      pickBestCandidate(preferredPlaybackFriendly.filter((entry) => entry.height === 720)) ||
      pickBestCandidate(smoothMuxed.filter((entry) => entry.height >= 480 && entry.height < 1080)) ||
      pickBestCandidate(preferredMuxed.filter((entry) => entry.height >= 480 && entry.height < 1080)) ||
      selected ||
      null;

    const manifestSelected = (() => {
      if (dashManifestUrl) {
        return {
          id: 'youtube-dash-manifest',
          label: selected?.label || (selected?.height ? `${selected.height}p` : 'Auto'),
          height: selected?.height || 1080,
          fps: selected?.fps || 0,
          url: dashManifestUrl,
          audioUrl: null,
          hasAudio: true,
          formatId: 'youtube-dash-manifest',
          preferred: true,
          playbackFriendly: true,
          bitrate: selected?.bitrate || 0,
          codec: 'manifest',
          audioCodec: 'manifest',
          ext: 'mpd',
          isManifestBacked: true,
          transport: 'dash-manifest',
          proxyHeaders: pickSafeProxyHeaders(output?.http_headers)
        };
      }

      if (hlsManifestUrl) {
        return {
          id: 'youtube-hls-manifest',
          label: selected?.label || (selected?.height ? `${selected.height}p` : 'Auto'),
          height: selected?.height || 1080,
          fps: selected?.fps || 0,
          url: hlsManifestUrl,
          audioUrl: null,
          hasAudio: true,
          formatId: 'youtube-hls-manifest',
          preferred: true,
          playbackFriendly: true,
          bitrate: selected?.bitrate || 0,
          codec: 'manifest',
          audioCodec: 'manifest',
          ext: 'm3u8',
          isManifestBacked: true,
          transport: 'hls-manifest',
          proxyHeaders: pickSafeProxyHeaders(output?.http_headers)
        };
      }

      return null;
    })();

    const qualityMap = Object.fromEntries(qualities.map((entry) => [entry.formatId, entry]));
    if (manifestSelected?.formatId) {
      qualityMap[manifestSelected.formatId] = manifestSelected;
    }

    const qualitiesForUi = manifestSelected
      ? [manifestSelected, ...qualities.filter((entry) => entry.formatId !== manifestSelected.formatId)]
      : qualities;

    return {
      title: output?.title || 'YouTube Video',
      bestAudioUrl: bestAudio?.url || null,
      audioFormat: bestAudioFormat,
      audioTracks: audioTracks,
      qualities: qualitiesForUi,
      qualityMap,
      selected: manifestSelected || selected,
      startupSelected: manifestSelected || startupSelected || selected,
      manifestSelected,
      isLive: output?.live_status === 'is_live' || !!output?.is_live,
      duration: Number(output?.duration || 0),
      rawData: rawOutput
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  //  YouTube – DASH MPD generator
  // ═══════════════════════════════════════════════════════════════════

  const generateYoutubeDashMpd = (videoFormat, audioFormat, duration) => {
    const isVideoWebm = videoFormat.ext === 'webm' ||
      (videoFormat.codec || '').toLowerCase().includes('vp9') ||
      (videoFormat.codec || '').toLowerCase().includes('av01');

    const videoMime = isVideoWebm ? 'video/webm' : 'video/mp4';

    let videoCodec = videoFormat.codec || 'avc1.4d400c';

    const videoBandwidth = Math.round((videoFormat.bitrate || 1000) * 1000);

    const videoProxyUrl = lateDeps.maybeProxifyUrl(videoFormat.url, videoFormat.proxyHeaders);

    const esc = (str) => {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // ── Muxed-only mode (Google Drive) ──
    // When there is no separate audio format, the video file contains both
    // video and audio tracks.  We emit a single AdaptationSet with
    // contentType="video" so dash.js treats the muxed MP4 as the sole source.
    if (!audioFormat) {
      return `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT${duration}S"
     minBufferTime="PT1.5S">
  <Period>
    <AdaptationSet contentType="video" segmentAlignment="true" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="${esc(videoFormat.formatId)}" mimeType="${videoMime}" codecs="${esc(videoCodec)}" width="${videoFormat.width || 1280}" height="${videoFormat.height || 720}" bandwidth="${videoBandwidth}">
        <BaseURL>${esc(videoProxyUrl)}</BaseURL>
        <SegmentBase indexRange="${videoFormat.indexRange.start}-${videoFormat.indexRange.end}">
          <Initialization range="${videoFormat.initRange.start}-${videoFormat.initRange.end}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
    }

    // ── Separate video + audio mode (YouTube) ──
    const isAudioWebm = audioFormat.ext === 'webm' ||
      (audioFormat.acodec || audioFormat.codec || audioFormat.audioCodec || '').toLowerCase().includes('opus');
    const audioMime = isAudioWebm ? 'audio/webm' : 'audio/mp4';
    const audioBandwidth = Math.round((audioFormat.tbr || 128) * 1000);
    const audioProxyUrl = lateDeps.maybeProxifyUrl(audioFormat.url, audioFormat.proxyHeaders || videoFormat.proxyHeaders);

    return `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT${duration}S"
     minBufferTime="PT1.5S">
  <Period>
    <!-- Video Adaptation Set -->
    <AdaptationSet segmentAlignment="true" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="${esc(videoFormat.formatId)}" mimeType="${videoMime}" codecs="${esc(videoCodec)}" width="${videoFormat.width || 1280}" height="${videoFormat.height || 720}" bandwidth="${videoBandwidth}">
        <BaseURL>${esc(videoProxyUrl)}</BaseURL>
        <SegmentBase indexRange="${videoFormat.indexRange.start}-${videoFormat.indexRange.end}">
          <Initialization range="${videoFormat.initRange.start}-${videoFormat.initRange.end}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <!-- Audio Adaptation Set -->
    <AdaptationSet segmentAlignment="true" subsegmentAlignment="true" subsegmentStartsWithSAP="1">
      <Representation id="${esc(audioFormat.format_id || 'audio')}" mimeType="${audioMime}" codecs="${esc(audioFormat.acodec || 'mp4a.40.2')}" bandwidth="${audioBandwidth}">
        <BaseURL>${esc(audioProxyUrl)}</BaseURL>
        <SegmentBase indexRange="${audioFormat.indexRange.start}-${audioFormat.indexRange.end}">
          <Initialization range="${audioFormat.initRange.start}-${audioFormat.initRange.end}"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
  };

  // ═══════════════════════════════════════════════════════════════════
  //  Google Drive – Host / URL helpers
  // ═══════════════════════════════════════════════════════════════════

  const isDriveMediaHost = (host) => {
    const value = String(host || '').toLowerCase();
    return (
      value === 'drive.google.com' ||
      value.endsWith('.c.drive.google.com') ||
      value === 'drive.usercontent.google.com' ||
      value.includes('googlevideo.com')
    );
  };

  const isDriveLikeUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      return isDriveMediaHost(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  const isDrivePlaybackLike = (rawUrl) => {
    const value = String(rawUrl || '').toLowerCase();
    if (!value) return false;
    return (
      value.includes('videoplayback') &&
      (value.includes('.c.drive.google.com') || value.includes('drive.google.com') || value.includes('googlevideo.com'))
    );
  };

  const extractDriveIdFromUrl = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || '').trim());
      const host = parsed.hostname.toLowerCase();
      const isGoogleDriveHost =
        host === 'drive.google.com' ||
        host === 'drive.usercontent.google.com' ||
        host.endsWith('.c.drive.google.com') ||
        host.includes('googlevideo.com');

      if (!isGoogleDriveHost) return null;

      const byQuery = parsed.searchParams.get('driveid') || parsed.searchParams.get('id');
      if (byQuery) return byQuery;

      const parts = parsed.pathname.split('/').filter(Boolean);
      const dIndex = parts.findIndex((part) => part === 'd');
      if (dIndex >= 0 && parts[dIndex + 1]) return parts[dIndex + 1];
      return null;
    } catch {
      return null;
    }
  };

  const getDriveFallbackUrl = (driveId) => {
    if (!driveId) return null;
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveId)}`;
  };

  const isDriveRequest = (rawUrl) => {
    try {
      const parsed = new URL(String(rawUrl || ''));
      return isDriveMediaHost(parsed.hostname.toLowerCase());
    } catch {
      return false;
    }
  };

  // ═══════════════════════════════════════════════════════════════════


  // ═══════════════════════════════════════════════════════════════════
  //  Module exports
  // ═══════════════════════════════════════════════════════════════════

  return {
    // ── YouTube functions ──
    pickBalancedAudio,
    compareYoutubeCandidates,
    getCleanAudioCodecName,
    getYoutubeLanguageName,
    groupYoutubeAudioTracks,
    isMissingPotFormat,
    parseYoutubeiPlayerResponse,
    buildYoutubeSession,
    generateYoutubeDashMpd,

    // ── Google Drive functions ──
    isDriveMediaHost,
    isDriveLikeUrl,
    isDrivePlaybackLike,
    extractDriveIdFromUrl,
    getDriveFallbackUrl,
    isDriveRequest,

    // ── Dependency injection ──
    setDeps(newDeps) { Object.assign(lateDeps, newDeps); }
  };
};
