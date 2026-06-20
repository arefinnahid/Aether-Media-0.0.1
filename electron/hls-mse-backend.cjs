const http = require('http');
const https = require('https');
const { URL } = require('url');

function fetchText(targetUrl, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(String(targetUrl || '').trim());
    } catch {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'aether-HLS-MSE/1.0',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: '*/*',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode || 0} for ${targetUrl}`));
            return;
          }
          resolve({ body, headers: res.headers, finalUrl: res.headers.location || url.toString() });
        });
      }
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout fetching ${targetUrl}`)));
    req.on('error', reject);
    req.end();
  });
}

function fetchBuffer(targetUrl, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(String(targetUrl || '').trim());
    } catch {
      reject(new Error(`Invalid URL: ${targetUrl}`));
      return;
    }

    const client = url.protocol === 'http:' ? http : https;
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'aether-HLS-MSE/1.0',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: '*/*',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
            reject(new Error(`HTTP ${res.statusCode || 0} for ${targetUrl}`));
            return;
          }
          resolve({ body, headers: res.headers });
        });
      }
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout fetching ${targetUrl}`)));
    req.on('error', reject);
    req.end();
  });
}

function resolveUrl(baseUrl, value) {
  try {
    return new URL(String(value || '').trim(), String(baseUrl || '').trim()).toString();
  } catch {
    return String(value || '').trim();
  }
}

function parseAttributes(line) {
  const attrs = {};
  const raw = String(line || '').split(':').slice(1).join(':');
  const regex = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
  let match;
  while ((match = regex.exec(raw))) {
    const key = String(match[1] || '').trim();
    const value = String(match[2] || '').trim().replace(/^"|"$/g, '');
    attrs[key] = value;
  }
  return attrs;
}

function parseMediaPlaylist(playlistText, playlistUrl) {
  const lines = String(playlistText || '').replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  let pendingDuration = null;
  let start = 0;
  let sequenceBase = 0;
  let mapUrl = null;
  let targetDuration = 0;
  let endList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;

    if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(line)) {
      sequenceBase = Number.parseInt(line.split(':')[1] || '0', 10) || 0;
      continue;
    }

    if (/^#EXT-X-TARGETDURATION:/i.test(line)) {
      targetDuration = Number.parseFloat(line.split(':')[1] || '0') || 0;
      continue;
    }

    if (/^#EXT-X-MAP:/i.test(line)) {
      const attrs = parseAttributes(line);
      if (attrs.URI) {
        mapUrl = resolveUrl(playlistUrl, attrs.URI);
      }
      continue;
    }

    if (/^#EXTINF:/i.test(line)) {
      pendingDuration = Number.parseFloat(line.split(':')[1] || '0') || 0;
      continue;
    }

    if (/^#EXT-X-ENDLIST/i.test(line)) {
      endList = true;
      continue;
    }

    if (line.startsWith('#')) continue;

    const duration = Number.isFinite(pendingDuration) ? Number(pendingDuration || 0) : 0;
    const seq = sequenceBase + segments.length;
    const url = resolveUrl(playlistUrl, line);
    segments.push({ seq, start, duration, url });
    start += duration;
    pendingDuration = null;
  }

  return {
    playlistUrl,
    initUrl: mapUrl,
    segments,
    duration: segments.length > 0 ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0,
    targetDuration,
    endList,
  };
}

async function parseMasterManifest(masterUrl) {
  const { body } = await fetchText(masterUrl);
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const videoVariants = [];
  const audioTracks = [];
  const subtitleTracks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) continue;

    if (/^#EXT-X-MEDIA:/i.test(line)) {
      const attrs = parseAttributes(line);
      const type = String(attrs.TYPE || '').toUpperCase();
      if (type === 'AUDIO' && attrs.URI) {
        const id = String(attrs.GROUP - ID || attrs.NAME || `audio-${audioTracks.length}`);
        audioTracks.push({
          id,
          name: attrs.NAME || id,
          language: attrs.LANGUAGE || null,
          default: String(attrs.DEFAULT || '').toUpperCase() === 'YES',
          uri: resolveUrl(masterUrl, attrs.URI),
          groupId: attrs['GROUP-ID'] || null,
        });
      }
      if (type === 'SUBTITLES' && attrs.URI) {
        const id = String(attrs.GROUP - ID || attrs.NAME || `sub-${subtitleTracks.length}`);
        subtitleTracks.push({
          id,
          name: attrs.NAME || id,
          language: attrs.LANGUAGE || null,
          default: String(attrs.DEFAULT || '').toUpperCase() === 'YES',
          uri: resolveUrl(masterUrl, attrs.URI),
          groupId: attrs['GROUP-ID'] || null,
        });
      }
      continue;
    }

    if (/^#EXT-X-STREAM-INF:/i.test(line)) {
      const attrs = parseAttributes(line);
      const nextLine = String(lines[i + 1] || '').trim();
      if (!nextLine || nextLine.startsWith('#')) continue;
      const uri = resolveUrl(masterUrl, nextLine);
      const resolution = String(attrs.RESOLUTION || '');
      const heightMatch = resolution.match(/x(\d+)/i);
      const height = heightMatch ? Number.parseInt(heightMatch[1], 10) : 0;
      videoVariants.push({
        id: String(attrs.BANDWIDTH || height || `video-${videoVariants.length}`),
        label: height > 0 ? `${height}p` : `Variant ${videoVariants.length + 1}`,
        bandwidth: Number.parseInt(attrs.BANDWIDTH || '0', 10) || 0,
        codecs: attrs.CODECS || '',
        audioGroupId: attrs.AUDIO || null,
        subtitleGroupId: attrs.SUBTITLES || null,
        uri,
      });
      i += 1;
    }
  }

  if (videoVariants.length === 0) {
    const media = parseMediaPlaylist(body, masterUrl);
    videoVariants.push({
      id: 'default',
      label: 'Auto',
      bandwidth: 0,
      codecs: '',
      audioGroupId: null,
      subtitleGroupId: null,
      uri: masterUrl,
      media,
    });
  }

  const variantMedia = await Promise.all(
    videoVariants.map(async (variant) => ({
      ...variant,
      media: variant.media || parseMediaPlaylist((await fetchText(variant.uri)).body, variant.uri),
    }))
  );

  const audioMedia = await Promise.all(
    audioTracks.map(async (track) => ({
      ...track,
      media: parseMediaPlaylist((await fetchText(track.uri)).body, track.uri),
    }))
  );

  return {
    sourceUrl: masterUrl,
    duration: variantMedia[0]?.media?.duration || 0,
    videoTracks: variantMedia,
    audioTracks: audioMedia,
    subtitleTracks,
  };
}

module.exports = function createHlsMseBackend() {
  const state = {
    manifest: null,
  };

  async function load(url) {
    console.log('[HLS][LOAD]', url);
    state.manifest = await parseMasterManifest(url);
    return getManifest();
  }

  function getManifest() {
    if (!state.manifest) {
      throw new Error('No HLS source loaded');
    }

    return {
      sourceUrl: state.manifest.sourceUrl,
      duration: state.manifest.duration,
      videoTracks: state.manifest.videoTracks.map((track) => ({
        id: track.id,
        label: track.label,
        bandwidth: track.bandwidth,
        codecs: track.codecs,
        initUrl: track.media.initUrl,
        segments: track.media.segments,
      })),
      audioTracks: state.manifest.audioTracks.map((track) => ({
        id: track.id,
        name: track.name,
        language: track.language,
        default: track.default,
        initUrl: track.media.initUrl,
        segments: track.media.segments,
      })),
      subtitleTracks: state.manifest.subtitleTracks.map((track) => ({
        id: track.id,
        name: track.name,
        language: track.language,
        default: track.default,
      })),
    };
  }

  async function getInitVideo(trackId) {
    const manifest = state.manifest;
    if (!manifest) throw new Error('No HLS source loaded');
    const track = manifest.videoTracks.find((entry) => String(entry.id) === String(trackId)) || manifest.videoTracks[0];
    if (!track?.media?.initUrl) throw new Error('Video init segment not found');
    console.log('[HLS][INIT][VIDEO]', track.id, track.media.initUrl);
    return fetchBuffer(track.media.initUrl);
  }

  async function getInitAudio(trackId) {
    const manifest = state.manifest;
    if (!manifest) throw new Error('No HLS source loaded');
    const track = manifest.audioTracks.find((entry) => String(entry.id) === String(trackId));
    if (!track?.media?.initUrl) throw new Error(`Audio init segment not found for ${trackId}`);
    console.log('[HLS][INIT][AUDIO]', track.id, track.media.initUrl);
    return fetchBuffer(track.media.initUrl);
  }

  async function getVideoSegment(trackId, seq) {
    const manifest = state.manifest;
    if (!manifest) throw new Error('No HLS source loaded');
    const track = manifest.videoTracks.find((entry) => String(entry.id) === String(trackId)) || manifest.videoTracks[0];
    const segment = track?.media?.segments?.find((entry) => Number(entry.seq) === Number(seq));
    if (!segment) throw new Error(`Video segment not found: ${seq}`);
    console.log('[SEGMENT][VIDEO]', track.id, segment.seq, segment.start);
    return {
      meta: segment,
      response: await fetchBuffer(segment.url),
    };
  }

  async function getAudioSegment(trackId, seq) {
    const manifest = state.manifest;
    if (!manifest) throw new Error('No HLS source loaded');
    const track = manifest.audioTracks.find((entry) => String(entry.id) === String(trackId));
    const segment = track?.media?.segments?.find((entry) => Number(entry.seq) === Number(seq));
    if (!segment) throw new Error(`Audio segment not found: ${trackId}/${seq}`);
    console.log('[SEGMENT][AUDIO]', track.id, segment.seq, segment.start);
    return {
      meta: segment,
      response: await fetchBuffer(segment.url),
    };
  }

  async function getMergedSubtitles(trackId) {
    const manifest = state.manifest;
    if (!manifest) throw new Error('No HLS source loaded');
    const track = manifest.subtitleTracks.find((entry) => String(entry.id) === String(trackId));
    if (!track?.uri) throw new Error(`Subtitle track not found: ${trackId}`);
    console.log('[HLS][SUBTITLES]', track.id, track.uri);
    const playlist = parseMediaPlaylist((await fetchText(track.uri)).body, track.uri);
    const parts = ['WEBVTT', ''];
    for (const segment of playlist.segments) {
      const { body } = await fetchText(segment.url);
      const cleaned = String(body || '').replace(/^WEBVTT\s*/i, '').trim();
      if (cleaned) parts.push(cleaned, '');
    }
    return parts.join('\n');
  }

  return {
    load,
    getManifest,
    getInitVideo,
    getInitAudio,
    getVideoSegment,
    getAudioSegment,
    getMergedSubtitles,
  };
};
