'use strict';
const { startStealthHider } = require('./stealth-hider.cjs');

module.exports = function createGenericCaptureHelpers(deps) {
  const {
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
  } = deps;

  /* ═══════════════════════════════════════════════════════════════
   *  Tuning constants
   * ═══════════════════════════════════════════════════════════════ */
  const OVERALL_TIMEOUT_MS = 60_000;  // increased for slow networks
  const SETTLE_DELAY_MS = 2_500;
  const FAST_SETTLE_DELAY_MS = 800;
  const NAV_TIMEOUT_MS = 45_000;  // increased for slow networks
  const NAV_RETRY_COUNT = 2;       // NEW: number of navigation retries
  const NAV_RETRY_DELAY_MS = 2_000;   // NEW: delay between retries
  const DOM_POLL_INTERVAL_MS = 1_200;
  const HIGH_CONF_SCORE = 400;
  const MIN_SETTLE_SCORE = 80;     // NEW: minimum score to bother triggering settle
  const FLOOD_THRESHOLD = 5;
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const MAX_JSON_BODY = 512_000;
  const MAX_HTML_BODY = 1_024_000;
  const RESPONSE_BODY_TIMEOUT_MS = 3_000;
  const CDN_HOSTNAME_BONUS = 50;
  const LARGE_FILE_BONUS = 200;    // NEW: bonus for responses > 10 MB
  const MEDIUM_FILE_BONUS = 100;    // NEW: bonus for responses > 1 MB
  const PREVIEW_PENALTY = 200;    // NEW: penalty for preview/thumbnail videos
  const SEGMENT_PENALTY = 80;     // NEW: penalty for HLS/DASH segments
  const SMALL_FILE_PENALTY = 120;    // NEW: penalty for very small media files
  const CONSENT_DISMISS_DELAY_MS = 300;  // Reduced: modern sites react instantly to clicks
  const CONSENT_MAX_ATTEMPTS = 3;      // NEW: max attempts to dismiss overlays
  const VERY_HIGH_CONF_SCORE = 600;
  const SAME_SITE_BONUS = 300;     // NEW: strong preference for site-hosted media
  const AD_MEDIA_PENALTY = 2000;   // NEW: heavy penalty for heuristic-detected ads

  /* ═══════════════════════════════════════════════════════════════
   *  Pre-emptive bypass cookies (injected before navigation)
   *  These silently bypass age gates and consent modals on many sites
   * ═══════════════════════════════════════════════════════════════ */
  const BYPASS_COOKIES = [
    // Age verification
    { name: 'age_verified', value: '1' },
    { name: 'age-verified', value: '1' },
    { name: 'ageVerified', value: 'true' },
    { name: 'is_adult', value: '1' },
    { name: 'isAdult', value: 'true' },
    { name: 'adult', value: '1' },
    { name: 'over18', value: '1' },
    { name: 'over_18', value: '1' },
    { name: '18plus', value: '1' },
    { name: 'age_gate_passed', value: '1' },
    { name: 'age_check', value: 'passed' },
    { name: 'mature_content', value: '1' },
    { name: 'confirm_age', value: '1' },
    { name: 'dob', value: '1990-01-01' },
    { name: 'birth_year', value: '1990' },
    // General confirmation/consent
    { name: 'confirmed', value: 'true' },
    { name: 'agreed', value: 'true' },
    { name: 'consent', value: '1' },
    { name: 'consented', value: 'true' },
    { name: 'accepted', value: 'true' },
    { name: 'terms_accepted', value: '1' },
    { name: 'tos_accepted', value: '1' },
    { name: 'disclaimer', value: 'accepted' },
    { name: 'warning_shown', value: '1' },
    { name: 'splash_closed', value: '1' },
    { name: 'popup_closed', value: '1' },
    { name: 'modal_closed', value: '1' },
    { name: 'overlay_dismissed', value: '1' },
    { name: 'first_visit', value: '0' },
    { name: 'returning_user', value: '1' },
    // GDPR/Cookie consent
    { name: 'cookie_consent', value: 'accepted' },
    { name: 'cookies_accepted', value: '1' },
    { name: 'gdpr_consent', value: '1' },
    { name: 'privacy_policy', value: 'accepted' },
    { name: 'euconsent', value: '1' },
    { name: 'cookieconsent_status', value: 'allow' },
    { name: 'CookieConsent', value: 'true' },
    // Site-specific common patterns
    { name: 'enterSite', value: '1' },
    { name: 'entered', value: '1' },
    { name: 'entry_confirmed', value: '1' },
    { name: 'kt_tcookie', value: '1' },  // Common adult site cookie
    { name: 'kt_agecheck', value: '1' },
    { name: 'has_js', value: '1' },
    { name: 'player_quality', value: '1080' },  // Some sites check this
  ];

  /* ═══════════════════════════════════════════════════════════════
   *  Pre-compiled patterns
   * ═══════════════════════════════════════════════════════════════ */
  const RE_MEDIA_EXT = /\.(m3u8|mpd|mp4|webm|mkv|mov|avi|m4v|flv|wmv|ts|m4s|f4v|ogv)(?:\/)?(?:\?|#|$)/i;
  const RE_SUBTITLE_EXT = /\.(vtt|srt|ass|ssa)(?:\/)?(?:\?|#|$)/i;
  const RE_BLANK_MP4 = /blank\.mp4/i;
  const RE_MASTER_M3U8 = /(?:master|main|_TPL_|hls-|dash-)\.m3u8/i;
  const RE_INDEX_M3U8 = /index\.m3u8/i;
  const RE_MPD = /\.mpd(?:\/)?(?:\?|#|$)/i;
  const RE_M3U8 = /\.m3u8(?:\/)?(?:\?|#|$)/i;
  const RE_MP4 = /\.mp4(?:\/)?(?:\?|#|$)/i;
  const RE_WEBM = /\.webm(?:\/)?(?:\?|#|$)/i;
  const RE_HOST_EXTRACT = /^https?:\/\/([^/:]+)/;
  const RE_RES_PATH = /\/(\d{3,4})(?:p|i)?\/(?:manifest|index|playlist|master)\.(?:mpd|m3u8)/i;
  const RE_RES_SEG = /(?:^|[/\-_])(240|360|480|720|1080|1440|2160)(?:p|i|m)?(?:\/|\?|#|-|_|$)/i;
  const RE_RES_FILE = /(?:^|[\/\-_.])(240|360|480|540|576|720|1080|1440|2160|4320)(?:p|i|m)?\.(?:mp4|webm|mkv|m3u8|mpd)(?:\/)?(?:\?|#|$)/i;
  const RE_AD_KEYWORDS = /(?:ads|adserver|banner|tracking|analytics|doubleclick|googlead|vast|vpaid|syndication|tsyndicate|trafficstars|exoclick|afcdn|pt-static|pre-?roll|mid-?roll|post-?roll|sponsored|monetiz|advert|marketing|popunder|interstitial|delivery|serve-?ads|pixel|beacon)/i;
  const RE_MEDIA_PATH = /\/(?:hls|dash)\/|\/manifest|mime=video\/|\/v\/[a-f0-9.|_\-]{15,}/i;
  const RE_BLOB_DATA = /^(?:blob:|data:)/;
  const RE_STATIC_ASSET = /\.(js|css|woff2?|ttf|eot|svg|ico|png|jpg|jpeg|gif|webp|avif|wasm)(\?|$)/i;
  const DOWNLOAD_PATH_PATTERNS = [
    /\/dload\//i,
    /\/download\//i,
    /\/get\//i,
    /\/dl\//i,
    /\/file\//i
  ];

  /* ── NEW: Thumbnail / preview / page URL detection ──────────── */
  const RE_THUMBNAIL_PATH = /\/(?:pics|gifs|thumbs?|thumbnails?|previews?|posters?|storyboards?|sprites?|images?|avatars?|covers?|banners?|icons?|screenshots?)[\/_]/i;
  const RE_PREVIEW_FILENAME = /[_\-.](?:thumb|preview|poster|small|mini|tiny|gif|sprite|placeholder|loading|sample_thumb|hover)[_\-.\d]*\.(?:mp4|webm|mkv)/i;
  const RE_PAGE_URL = /\.(?:php|html?|aspx?|jsp|do|action|cgi|py|rb|pl)(?:\?|#|$)/i;
  const RE_PAGE_PATH = /\/(?:view_video|watch|embed_player|play_video|show|article|post|page|index)\.(?:php|html?|aspx?)/i;

  /* ── NEW: Analytics / non-media CDN exclusion ───────────────── */
  const RE_ANALYTICS_HOSTNAME = /(?:debugbear|newrelic|datadoghq|datadog|sentry|bugsnag|logrocket|fullstory|hotjar|clarity|heap|mixpanel|amplitude|segment|rudderstack|mux\.com|rollbar|airbrake|appsignal|elastic|splunk|sumo|logz|papertrail|honeycomb|lightstep|instana|dynatrace|appdynamics|raygun|trackjs|atatus|whatfix|walkme|pendo|intercom|drift|crisp|zendesk|freshdesk|tawk|olark|livechat|hubspot|marketo|pardot|eloqua|mailchimp|sendgrid|twilio|braze|clevertap|onesignal|firebase|branch|adjust|appsflyer|kochava|singular|tune|impact|partnerize|cj\.com|shareasale|rakuten|tradedoubler|awin|webgains|admitad|skimlinks|viglink|rewardstyle|geniuslink|optimizely|vwo|abtasty|kameleoon|omniconvert|monetate|qubit|conductrics|evolv|statsig|launchdarkly|configcat|split\.io|flagsmith|unleash|growthbook|eppo|cloudflare-web-analytics)\./i;

  /* ── CDN / media-server hostname (refined) ──────────────────── */
  const RE_CDN_HOSTNAME = /(?:^|\.)(?:cache|cdn|media|video|stream|vod|play|content|assets|storage|userstorage|gfs|dl|download|files?|sv|node|edge|origin|proxy|deliver)[a-z0-9\-_]*\./i;
  const RE_MEDIA_SERVE_PATH = /\/(?:v|video|stream|play|watch|embed|media|file|get|dl|download|serve|content|view)\/[a-zA-Z0-9\-_\\.|%]{4,}/i;
  const RE_MEDIA_CONTENT_TYPE = /^(?:video\/|audio\/|application\/(?:x-mpegurl|vnd\.apple\.mpegurl|dash\+xml|octet-stream|mp4))/i;
  const RE_MEDIA_DISPOSITION = /filename[*]?=(?:UTF-8''|")?[^";\n]*\.(?:mp4|webm|mkv|m3u8|mpd|avi|mov|m4v|flv|ts|wmv)/i;
  const RE_RES_IN_TEXT = /(?:^|\D)(4k|8k|2160p?|1440p?|1080p?|720p?|480p?|360p?|240p?)(?:\D|$)/i;
  const RE_VIDEO_URL_IN_TEXT = /https?:[\\\/]+[^\s"'<>\]}{]+?(?:\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:[^\s"'<>\]}{]*)|\/(?:hls|dash|manifest|playlist|index|master)(?:[^\s"'<>\]}{]*))/gi;
  const RE_TEMPLATE_MEDIA = /(?:^|[\/_\-.])(?:template)(?:[\/_\-.]|$)/i;
  const RE_NUMERIC_MEDIA_ID = /(?:^|\D)(\d{6,12})(?!\d)/g;

  /* ── NEW: HLS/DASH segment detection (not the main manifest) ── */
  const RE_SEGMENT_URL = /\/(?:seg(?:ment)?|chunk|fragment|part|init)[_\-]\d|\.ts\?|\/[a-f0-9]+\.ts(?:\?|$)/i;
  const RE_SEGMENT_M3U8 = /(?:chunklist|media|audio|video|stream)_?\d*\.m3u8/i;

  /* ═══════════════════════════════════════════════════════════════
   *  Minimal nuclear-block domains (worst popup/redirect offenders)
   *  Comprehensive blocking is handled by adBlockManager's engine.
   * ═══════════════════════════════════════════════════════════════ */
  const NUCLEAR_BLOCK_DOMAINS = new Set([
    'popads.net', 'popcash.net', 'realsrv.com',
    'playhubconnect.com', 'acquiredeceasedundress.com'
  ]);
  const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font']);

  /* ═══════════════════════════════════════════════════════════════
   *  Shared helpers
   * ═══════════════════════════════════════════════════════════════ */

  /** Extract hostname without full URL parse (faster hot-path) */
  const extractHostname = (url) => {
    const m = RE_HOST_EXTRACT.exec(url);
    return m ? m[1].toLowerCase() : '';
  };

  /** Walk hostname labels to check against the nuclear-block set */
  const isNuclearBlockedDomain = (hostname) => {
    if (!hostname) return false;
    const parts = hostname.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      if (NUCLEAR_BLOCK_DOMAINS.has(parts.slice(i).join('.'))) return true;
    }
    return false;
  };

  /** Fast pre-filter for scoring penalties (regex keywords + nuclear domains).
   *  NOT used for route-level blocking — that uses adBlockManager.shouldBlockForCapture(). */
  const isLikelyAdUrl = (url) => {
    if (isNuclearBlockedDomain(extractHostname(url))) return true;
    return RE_AD_KEYWORDS.test(url);
  };

  /** Check if hostname looks like a CDN/media server (REFINED: excludes analytics) */
  const isCdnHostname = (hostname) => {
    if (!hostname) return false;
    if (RE_ANALYTICS_HOSTNAME.test(hostname)) return false;
    return RE_CDN_HOSTNAME.test(hostname);
  };

  /** Check if URL looks like a media-serving path (extensionless) */
  const isMediaServePath = (url) => RE_MEDIA_SERVE_PATH.test(url);

  /** NEW: Check if URL looks like a web page rather than media content */
  const isLikelyPageUrl = (url) => {
    if (RE_PAGE_URL.test(url)) return true;
    if (RE_PAGE_PATH.test(url)) return true;
    // URLs with no path extension that look like page routes
    try {
      const u = new URL(url);
      const path = u.pathname;
      // If it has a media extension, it's not a page
      if (RE_MEDIA_EXT.test(path)) return false;
      // If the path looks like a typical page route
      if (/\/(?:view|watch|video|embed|play|episode|movie|show|series|channel|user|profile|category|tag|search)(?:\/|$)/i.test(path) && !RE_MEDIA_EXT.test(url)) {
        // Only a page URL if there's no media-related query params AND it's on a non-CDN host
        if (!u.searchParams.has('file') && !u.searchParams.has('source') && !u.searchParams.has('src')) {
          const host = extractHostname(url);
          if (!isCdnHostname(host)) return true;
        }
      }
    } catch { }
    return false;
  };

  /** NEW: Check if URL looks like a preview/thumbnail video (not main content) */
  const isLikelyPreviewMedia = (url) => {
    const lower = String(url || '').toLowerCase();
    // Path contains thumbnail/preview directories
    if (RE_THUMBNAIL_PATH.test(lower)) return true;
    // Filename indicates preview/thumbnail
    if (RE_PREVIEW_FILENAME.test(lower)) return true;
    // Very short GIF-like patterns (e.g., /gifs/, small numbered files)
    if (/\/gifs?\//i.test(lower) && RE_MP4.test(lower)) return true;
    return false;
  };

  /** NEW: Check if URL looks like an HLS/DASH segment or byte-range chunk (not a manifest) */
  const isLikelySegment = (url) => {
    const lower = String(url || '').toLowerCase();
    if (RE_SEGMENT_URL.test(lower)) return true;
    // .ts and .m4s files that aren't manifests
    if (/\.(ts|m4s)(\?|$)/i.test(lower) && !/manifest|master|playlist|index/i.test(lower)) return true;
    // Removed range-chunk regex because it falsely flags legitimate high-res MP4/WebM CDN URLs
    return false;
  };

  const isTemplateMediaUrl = (url) => RE_TEMPLATE_MEDIA.test(String(url || ''));
  const isTemplatePlaceholderMp4Url = (url) => {
    const value = String(url || '');
    return /(?:^|[\/_.-])_tpl_(?:[\/_.-]|$)/i.test(value) && RE_MP4.test(value) && !RE_M3U8.test(value) && !RE_MPD.test(value);
  };

  const collectAlphanumericSlugs = (value) => {
    const text = String(value || '');
    const ids = new Set();

    // Pattern 1: Pure digits (original numeric ID logic)
    const digitRe = /(?:^|\D)(\d{6,12})(?!\d)/g;
    let m;
    while ((m = digitRe.exec(text)) !== null) ids.add(m[1]);

    // Pattern 2: Alphanumeric slugs (common for Filester, etc.)
    // Look for 4-128 char alphanumeric strings after / or = (allowing dots, dashes, pipes, and percents as boundaries)
    const slugRe = /(?:[\/=])([a-zA-Z0-9\\.-]{4,128})(?:[|/%?#&]|$)/g;
    while ((m = slugRe.exec(text)) !== null) ids.add(m[1]);

    return ids;
  };

  const countSharedMediaIds = (left, right) => {
    const a = collectAlphanumericSlugs(left);
    const b = collectAlphanumericSlugs(right);
    let count = 0;
    for (const id of a) {
      if (b.has(id)) count += 1;
    }
    return count;
  };

  const STANDARD_RESOLUTIONS = [144, 240, 360, 480, 540, 576, 720, 1080, 1440, 2160, 4320];
  const isValidRes = (n) => {
    if (n < 100 || n > 5000) return false;
    // Reject year-like values
    if (n >= 1900 && n <= 2099) return false;
    // Must be within 40px of a known standard resolution to prevent
    // video IDs (e.g. 23413 → 3413) from being misidentified as resolutions
    return STANDARD_RESOLUTIONS.some(std => Math.abs(n - std) <= 40);
  };

  const extractResolutionFromUrl = (url) => {
    const rawValue = String(url || '').trim();
    if (!rawValue) return 0;
    const lower = rawValue.toLowerCase();

    const multiMatch = lower.match(/multi=(.*?)(?:\/|$)/);
    if (multiMatch) {
      const resMatches = [...multiMatch[1].matchAll(/(\d{3,4})p/g)];
      if (resMatches.length > 0) {
        const highest = Math.max(...resMatches.map((match) => parseInt(match[1], 10)));
        if (isValidRes(highest)) return highest;
      }
    }

    const fileQualityMatch = lower.match(/[-_](2160|1440|1080|720|480|360|240)p?(?:[-_.]|\?|#|$)/i);
    if (fileQualityMatch) {
      const n = parseInt(fileQualityMatch[1], 10);
      if (isValidRes(n)) return n;
    }

    const interlaceMatch = lower.match(/[-_]1080i(?:\.|\?|#|$)/i);
    if (interlaceMatch) {
      return 1080;
    }

    let m = RE_RES_FILE.exec(lower);
    if (m) { const n = parseInt(m[1], 10); if (isValidRes(n)) return n; }
    m = RE_RES_PATH.exec(lower);
    if (m) { const n = parseInt(m[1], 10); if (isValidRes(n)) return n; }
    m = RE_RES_SEG.exec(lower);
    if (m) { const n = parseInt(m[1], 10); if (isValidRes(n) && n !== 4172) return n; }
    try {
      const u = new URL(rawValue);
      for (const p of ['quality', 'res', 'height', 'h', 'resolution']) {
        const v = u.searchParams.get(p);
        if (!v) continue;
        const n = parseInt(v, 10);
        if (!Number.isNaN(n) && isValidRes(n)) return n;
      }
    } catch { }
    return 0;
  };

  /** Extract resolution context from page title or filename */
  const extractResolutionFromText = (text) => {
    if (!text) return 0;
    const m = RE_RES_IN_TEXT.exec(text);
    if (!m) return 0;
    const label = m[1].toLowerCase();
    if (label === '4k' || label === '2160p' || label === '2160') return 2160;
    if (label === '8k') return 4320;
    if (label === '1440p' || label === '1440') return 1440;
    if (label === '1080p' || label === '1080') return 1080;
    if (label === '720p' || label === '720') return 720;
    if (label === '480p' || label === '480') return 480;
    if (label === '360p' || label === '360') return 360;
    if (label === '240p' || label === '240') return 240;
    return 0;
  };

  /* ── URL scoring (SIGNIFICANTLY ENHANCED) ────────────────────── */
  const scoreUrl = (url, context = {}) => {
    let score = 0;
    const lower = String(url || '').toLowerCase();
    const hostname = extractHostname(url);

    // ── 0. Ad detection (HEAVY PENALTY) ──
    if (isLikelyAdUrl(url)) {
      return -5000;
    }
    if (adBlockManager?.isPotentialAdMedia({
      url,
      contentType: context.confirmedByContentType ? 'video/mp4' : null,
      contentLength: context.contentLength,
      pageUrl: context.pageUrl || null
    })) {
      score -= AD_MEDIA_PENALTY;
    }

    // ── 1. Extension-based scoring ──
    if (RE_MASTER_M3U8.test(lower)) score += 260;
    else if (RE_INDEX_M3U8.test(lower)) score += 240;
    else if (/manifest\.mpd/i.test(lower)) score += 230;
    else if (RE_M3U8.test(lower)) score += 210;
    else if (RE_MPD.test(lower)) score += 200;
    else if (RE_MP4.test(lower) && !RE_BLANK_MP4.test(lower)) score += 150;
    else if (RE_WEBM.test(lower)) score += 80;
    else if (RE_MEDIA_EXT.test(lower)) score += 70;

    // ── 1b. Filename/Path bonuses ──
    if (/(?:^|[\/_\-.])(?:hls-|dash-)/i.test(lower)) score += 100; // Strong signal for main manifest
    if (isCdnHostname(hostname) || isMediaServePath(url)) score += 120;
    if (isCdnHostname(hostname) && /\/(?:v|view|download)\//i.test(lower)) score += 150;

    // ── 2. Resolution scoring ──
    const isManifest = RE_M3U8.test(lower) || RE_MPD.test(lower);
    const res = extractResolutionFromUrl(url);
    if (res >= 2000) score += isManifest ? 700 : 420;
    else if (res >= 1000) score += isManifest ? 400 : 240;
    else if (res >= 700) score += isManifest ? 220 : 120;
    else if (res >= 400) score += isManifest ? 80 : 40;

    // ── 3. Context-based bonuses ──
    if (context.fromVideoElement) score += 600; // Increased from DIRECT_SRC_SCORE_BONUS to guarantee winning
    if (context.fromStructuredData) score += 150;
    if (context.fromApiJson) score += 250;
    if (context.source === 'json-dash-scan') score += 300;
    if (context.source === 'json-mine' || context.source === 'json-cdn-mine' || context.source === 'json-relative-mine') score += 150;
    if (context.fromDownloadLink) score += 200;
    if (context.fromPreloadLink) score += 260;
    if (context.confirmedByContentType) score += 200;
    if (context.isCurrentPageMedia) score += 120;
    if (context.sharedPageMediaIds > 0) score += Math.min(90, context.sharedPageMediaIds * 45);
    if (context.sameOriginAsPage) score += 100;
    if (context.sameSiteAsPage || context.hasBrandAffinity) score += SAME_SITE_BONUS;
    else if (context.fuzzySiteMatch) score += (SAME_SITE_BONUS / 2); // NEW: bonus for brand-matched CDNs
    if (context.observedAsCurrentPlayback) score += 600; // Increased to guarantee winning
    if (isCdnHostname(hostname)) score += CDN_HOSTNAME_BONUS;

    const size = context.contentLength || 0;
    if (size > 20_000_000) score += LARGE_FILE_BONUS * 2;  // > 20 MB → definitely main video
    else if (size > 10_000_000) score += LARGE_FILE_BONUS; // > 10 MB
    else if (size > 1_000_000) score += MEDIUM_FILE_BONUS;

    // Penalize small files if they are NOT same-site (likely ads)
    if (size > 0 && size < 5_000_000 && !context.sameSiteAsPage && !context.hasBrandAffinity && !isManifest) {
      score -= SMALL_FILE_PENALTY * 2;
    }
    else if (size > 0 && size < 100_000 && RE_MP4.test(lower)) {
      score -= SMALL_FILE_PENALTY * 5;  // Extremely small MP4 is almost always an ad/thumbnail
    }

    // ── 5. Penalties ──
    // Preview / thumbnail detection (ENHANCED)
    if (isLikelyPreviewMedia(url)) score -= PREVIEW_PENALTY;
    if (/(?:preview|sample|trailer|teaser|thumb)/i.test(lower)) score -= PREVIEW_PENALTY;
    if (isTemplateMediaUrl(url)) score -= 500;
    if (context.isForeignFeedMedia && !context.hasBrandAffinity) {
      if (isManifest || context.fromVideoElement || context.confirmedByContentType) {
        score -= 50;
      } else {
        score -= 420;
      }
    }
    if (context.isExactPageUrl && !RE_MEDIA_EXT.test(lower) && !context.fromVideoElement && !context.fromMediaResource && !context.confirmedByContentType) score -= 2000;

    // HLS/DASH segments (not the manifest we want)
    if (isLikelySegment(url)) score -= SEGMENT_PENALTY;
    if (RE_SEGMENT_M3U8.test(lower) && !RE_MASTER_M3U8.test(lower)) score -= 30;

    // Sub-manifests (lower than master)
    if (RE_M3U8.test(lower) && !RE_MASTER_M3U8.test(lower) && !RE_INDEX_M3U8.test(lower)) {
      // Could be a variant playlist – still useful but less than master
      score -= 20;
    }

    // ── 6. Manifest path bonus ──
    // URLs containing /hls/ or /dash/ in path are strong signals
    if (/\/hls\//i.test(lower)) score += 40;
    if (/\/dash\//i.test(lower)) score += 40;

    // Prefer AV1 streams when present
    if (/(?:^|[\/_\-.,])(?:av1|av01)(?:[\/_\-.,]|$)/i.test(lower)) score += 5;

    // ── 7. Bitrate / quality indicators in URL ──
    const bitrateMatch = lower.match(/(\d{3,5})k/i);
    if (bitrateMatch) {
      const kbps = parseInt(bitrateMatch[1], 10);
      if (kbps >= 4000) score += 60;
      else if (kbps >= 2000) score += 30;
      else if (kbps >= 1000) score += 15;
    }

    return score;
  };

  /* ── Proxy headers (ENHANCED with segment support) ────────────── */
  const buildFallbackProxyHeaders = (sourcePageUrl, mediaUrl, options = {}) => {
    try {
      const pg = new URL(String(sourcePageUrl || '').trim());
      const md = new URL(String(mediaUrl || '').trim());
      const mediaStr = md.toString();
      const isBinary = isDirectBinaryMediaPath(md.pathname || mediaStr);
      const isHls = RE_M3U8.test(mediaStr);
      const isDash = RE_MPD.test(mediaStr);
      const isSegment = /\.(ts|m4s|fmp4|mp4|jpg|png|jpeg)(\?|$)/i.test(mediaStr) &&
        (/seg|chunk|fragment|init|index\d/i.test(mediaStr) || options.isSegment);

      // For segments within HLS playlists, the referer should be the playlist URL
      // or the media origin (some CDNs check this)
      let refererUrl = pg.toString();
      if (isSegment && options.playlistUrl) {
        refererUrl = options.playlistUrl;
      } else if (isSegment && options.useMediaOriginReferer) {
        refererUrl = md.origin + '/';
      }

      const headers = {
        'user-agent': DESKTOP_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9',
        accept: isSegment || isBinary
          ? '*/*'
          : isHls
            ? 'application/vnd.apple.mpegurl,application/x-mpegurl,audio/mpegurl,*/*'
            : isDash
              ? 'application/dash+xml,text/xml,application/xml,*/*'
              : 'video/webm,video/ogg,video/mp4,video/*;q=0.9,*/*;q=0.8',
        referer: refererUrl,
        origin: pg.origin,
        'accept-encoding': isSegment ? 'identity' : 'gzip, deflate, br, identity',
        connection: 'keep-alive',
        'sec-fetch-site': pg.origin !== md.origin ? 'cross-site' : 'same-origin',
        'sec-fetch-mode': (isHls || isDash || isSegment) ? 'cors' : 'no-cors',
        'sec-fetch-dest': (isHls || isDash || isSegment) ? 'empty' : 'video',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      };

      // Add range header support hint for segments
      if (isSegment || isBinary) {
        headers['accept-ranges'] = 'bytes';
      }

      return headers;
    } catch {
      return {
        'user-agent': DESKTOP_USER_AGENT,
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'identity',
        referer: String(sourcePageUrl || ''),
        connection: 'keep-alive'
      };
    }
  };

  /* ── Build base URL for resolving relative HLS/DASH paths ──────── */
  const getMediaBaseUrl = (mediaUrl) => {
    try {
      const url = new URL(mediaUrl);
      const pathParts = url.pathname.split('/');
      pathParts.pop(); // Remove filename
      url.pathname = pathParts.join('/') + '/';
      url.search = ''; // Base URL shouldn't have query params for resolution
      return url.toString();
    } catch {
      return null;
    }
  };

  /* ── Extract URL without query string (for some referer uses) ──── */
  const getUrlWithoutQuery = (mediaUrl) => {
    try {
      const url = new URL(mediaUrl);
      url.search = '';
      return url.toString();
    } catch {
      return mediaUrl;
    }
  };

  /* ── Resolve relative URL against a base URL (for HLS/DASH) ──────── */
  const resolveRelativeUrl = (relativePath, baseUrl, mediaOrigin) => {
    if (!relativePath) return null;
    // Already absolute
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      return relativePath;
    }
    // Absolute path (starts with /)
    if (relativePath.startsWith('/')) {
      if (mediaOrigin) {
        return mediaOrigin + relativePath;
      }
      try {
        return new URL(relativePath, baseUrl).toString();
      } catch {
        return null;
      }
    }
    // Relative path
    if (baseUrl) {
      try {
        // Ensure baseUrl ends with /
        const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
        return new URL(relativePath, base).toString();
      } catch {
        return null;
      }
    }
    return null;
  };

  /* ── Preserve query params when resolving (some CDNs need auth params) ── */
  const resolveUrlPreservingQuery = (relativePath, manifestUrl) => {
    if (!relativePath || !manifestUrl) return relativePath;
    // Already absolute with query - return as-is
    if (relativePath.startsWith('http') && relativePath.includes('?')) {
      return relativePath;
    }
    try {
      const manifest = new URL(manifestUrl);
      const resolved = resolveRelativeUrl(relativePath, getMediaBaseUrl(manifestUrl), manifest.origin);
      if (!resolved) return relativePath;

      // If resolved URL has no query but manifest does, append manifest's query
      const resolvedUrl = new URL(resolved);
      if (!resolvedUrl.search && manifest.search) {
        resolvedUrl.search = manifest.search;
        return resolvedUrl.toString();
      }
      return resolved;
    } catch {
      return relativePath;
    }
  };

  /* ═══════════════════════════════════════════════════════════════
   *  HLS/DASH Manifest Rewriter (for proxy to use)
   *  Rewrites relative URLs in manifests to absolute proxy URLs
   * ═══════════════════════════════════════════════════════════════ */

  /**
   * Rewrite an HLS (m3u8) manifest, converting all relative URLs to absolute
   * proxy URLs so the player fetches everything through the proxy.
   * 
   * @param {string} manifestContent - Raw m3u8 content
   * @param {string} manifestUrl - Full URL of this manifest (for resolving relative URLs)
   * @param {string} proxyBaseUrl - Base URL of your proxy, e.g. 'http://127.0.0.1:18652/proxy?url='
   * @param {object} options - Optional: { preserveQuery: true, rid: 'session-id' }
   * @returns {string} - Rewritten manifest content
   */
  const rewriteHlsManifest = (manifestContent, manifestUrl, proxyBaseUrl, options = {}) => {
    if (!manifestContent || !manifestUrl || !proxyBaseUrl) return manifestContent;

    const { preserveQuery = true, rid = '', extraParams = '' } = options;
    const lines = manifestContent.split('\n');
    const result = [];

    try {
      const manifestUrlObj = new URL(manifestUrl);
      const baseUrl = getMediaBaseUrl(manifestUrl);
      const origin = manifestUrlObj.origin;
      const manifestQuery = manifestUrlObj.search; // For auth token inheritance

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines and comments (but not URI attributes)
        if (!trimmed || (trimmed.startsWith('#') && !trimmed.includes('URI='))) {
          result.push(line);
          continue;
        }

        // Handle #EXT-X-KEY, #EXT-X-MAP, #EXT-X-I-FRAME-STREAM-INF with URI="..."
        if (trimmed.includes('URI="')) {
          const rewritten = trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
            const resolved = resolveManifestUrl(uri, baseUrl, origin, manifestQuery, preserveQuery);
            const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
            return `URI="${proxyUrl}"`;
          });
          result.push(rewritten);
          continue;
        }

        // Handle #EXT-X-STREAM-INF and similar tags (the URL is on the next line)
        if (trimmed.startsWith('#')) {
          result.push(line);
          continue;
        }

        // This is a URL line (playlist or segment)
        const resolved = resolveManifestUrl(trimmed, baseUrl, origin, manifestQuery, preserveQuery);
        const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
        result.push(proxyUrl);
      }

      return result.join('\n');
    } catch (e) {
      console.error('[HLS-REWRITE] Error:', e.message);
      return manifestContent;
    }
  };

  /**
   * Rewrite a DASH (mpd) manifest, converting all relative URLs to absolute proxy URLs.
   * 
   * @param {string} manifestContent - Raw MPD XML content  
   * @param {string} manifestUrl - Full URL of this manifest
   * @param {string} proxyBaseUrl - Base URL of your proxy
   * @param {object} options - Optional: { preserveQuery: true, rid: 'session-id' }
   * @returns {string} - Rewritten manifest content
   */
  const rewriteDashManifest = (manifestContent, manifestUrl, proxyBaseUrl, options = {}) => {
    if (!manifestContent || !manifestUrl || !proxyBaseUrl) return manifestContent;

    const { preserveQuery = true, rid = '', extraParams = '' } = options;

    try {
      const manifestUrlObj = new URL(manifestUrl);
      const baseUrl = getMediaBaseUrl(manifestUrl);
      const origin = manifestUrlObj.origin;
      const manifestQuery = manifestUrlObj.search;

      // Pattern to match URLs in common DASH attributes
      const urlAttributes = [
        'initialization', 'media', 'sourceURL', 'href',
        'BaseURL', 'baseURL', 'contentURL'
      ];

      let result = manifestContent;

      // Rewrite BaseURL elements
      result = result.replace(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/gi, (match, url) => {
        const trimmedUrl = url.trim();
        if (!trimmedUrl || trimmedUrl.startsWith('http')) {
          // Already absolute or empty
          const resolved = trimmedUrl.startsWith('http') ? trimmedUrl : baseUrl;
          const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
          return match.replace(url, proxyUrl);
        }
        const resolved = resolveManifestUrl(trimmedUrl, baseUrl, origin, manifestQuery, preserveQuery);
        const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
        return match.replace(url, proxyUrl);
      });

      // Rewrite URL-containing attributes
      for (const attr of urlAttributes) {
        const attrPattern = new RegExp(`(${attr}\\s*=\\s*["'])([^"']+)(["'])`, 'gi');
        result = result.replace(attrPattern, (match, prefix, url, suffix) => {
          if (url.startsWith('http')) {
            // Already absolute
            const proxyUrl = buildProxyUrl(url, proxyBaseUrl, rid, extraParams);
            return prefix + proxyUrl + suffix;
          }
          // Handle template URLs like $RepresentationID$/$Number$.m4s
          // Handle template URLs like $RepresentationID$/$Number$.m4s
          // We still want to prepend the proxy URL so that the DASH engine
          // fetches the resolved segments through our proxy.
          if (url.includes('$')) {
            const resolved = resolveManifestUrl(url, baseUrl, origin, manifestQuery, preserveQuery);
            const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
            return prefix + proxyUrl + suffix;
          }
          const resolved = resolveManifestUrl(url, baseUrl, origin, manifestQuery, preserveQuery);
          const proxyUrl = buildProxyUrl(resolved, proxyBaseUrl, rid, extraParams);
          return prefix + proxyUrl + suffix;
        });
      }

      return result;
    } catch (e) {
      console.error('[DASH-REWRITE] Error:', e.message);
      return manifestContent;
    }
  };

  /**
   * Helper to resolve a URL from manifest against base
   */
  const resolveManifestUrl = (url, baseUrl, origin, manifestQuery, preserveQuery) => {
    if (!url) return url;

    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    // Absolute path
    if (url.startsWith('/')) {
      const resolved = origin + url;
      // Preserve auth query params if the resolved URL has none
      if (preserveQuery && manifestQuery && !url.includes('?')) {
        return resolved + manifestQuery;
      }
      return resolved;
    }

    // Relative path
    try {
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      const resolvedUrl = new URL(url, base);

      // Preserve auth query params if needed
      if (preserveQuery && manifestQuery && !resolvedUrl.search) {
        resolvedUrl.search = manifestQuery;
      }

      return resolvedUrl.toString();
    } catch {
      return url;
    }
  };

  /**
   * Build a proxy URL from an absolute media URL
   */
  const buildProxyUrl = (absoluteUrl, proxyBaseUrl, rid, extraParams) => {
    if (!absoluteUrl || !proxyBaseUrl) return absoluteUrl;

    let proxyUrl = proxyBaseUrl + encodeURIComponent(absoluteUrl);

    if (rid) {
      proxyUrl += (proxyUrl.includes('?') ? '&' : '?') + 'rid=' + encodeURIComponent(rid);
    }

    if (extraParams) {
      proxyUrl += (proxyUrl.includes('?') ? '&' : '?') + extraParams;
    }

    return proxyUrl;
  };

  /**
   * Detect manifest type and rewrite accordingly
   */
  const rewriteManifest = (content, manifestUrl, proxyBaseUrl, options = {}) => {
    if (!content || !manifestUrl) return content;

    // Detect type by URL or content
    const isHls = RE_M3U8.test(manifestUrl) || content.trim().startsWith('#EXTM3U');
    const isDash = RE_MPD.test(manifestUrl) || content.includes('<MPD') || content.includes('</MPD>');

    if (isHls) {
      return rewriteHlsManifest(content, manifestUrl, proxyBaseUrl, options);
    }
    if (isDash) {
      return rewriteDashManifest(content, manifestUrl, proxyBaseUrl, options);
    }

    // Unknown type - return as-is
    return content;
  };

  /* ═══════════════════════════════════════════════════════════════
   *  URL cleaning / normalizing helper
   * ═══════════════════════════════════════════════════════════════ */
  const cleanExtractedUrl = (raw) => {
    if (!raw) return null;
    let cleaned = raw
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/\\$/g, '')
      .replace(/["'\\,;}\]]+$/g, '')
      .trim();
    cleaned = cleaned.replace(/#$/, '');
    if (!cleaned || cleaned.length < 10) return null;
    try { new URL(cleaned); return cleaned; } catch { return null; }
  };

  /** Normalize a URL for deduplication (strip ONLY unambiguous cache-busting params).
   *  IMPORTANT: This blacklist must stay narrow. Never strip params that could be
   *  auth tokens, signed URLs, or access keys — doing so causes 403 Forbidden errors
   *  when the captured URL is forwarded to the proxy/player.
   *  Safe to strip: pure cache-busters with no security value.
   *  Never strip: anything that looks like a token, signature, hash, or key. */
  const normalizeForDedup = (url) => {
    try {
      const u = new URL(url);
      // BLACKLIST: only unambiguous cache-busting / tracking noise params.
      // Do NOT add generic single-letter params (e.g. 's', 'k', 'h') — they are
      // frequently used as abbreviated auth tokens on video CDNs.
      const VOLATILE_PARAMS = new Set([
        '_',          // jQuery cache-bust
        'cachebust',  // explicit cache-bust
        'nocache',    // explicit no-cache
        'rand',       // random cache-bust
        'random',     // random cache-bust
        'nc',         // no-cache (only safe when clearly not an auth param)
        'cb',         // cache-bust (only safe without other auth params present)
      ]);
      // Safety gate: if the URL has any params that look like auth tokens
      // (long alphanumeric strings, hashes, signatures), skip normalization entirely
      // to preserve the full URL and avoid accidental token stripping.
      const AUTH_LIKE = /^(?:token|sig(?:nature)?|auth|key|secret|hash|hmac|expires?|exp|iat|access|credential|x-amz|x-goog|awt|awsaccesskeyid)/i;
      for (const [key] of u.searchParams) {
        if (AUTH_LIKE.test(key)) return url; // Bail out — don't normalize auth URLs
        // Long opaque values (>= 20 chars) are likely tokens — skip normalization
        const val = u.searchParams.get(key);
        if (val && val.length >= 20 && /^[a-zA-Z0-9+/=_\-]+$/.test(val)) return url;
      }
      for (const p of VOLATILE_PARAMS) u.searchParams.delete(p);
      return u.toString();
    } catch {
      return url;
    }
  };

  const resolveCapturedUrlAgainstPage = (candidateUrl, basePageUrl) => {
    const value = String(candidateUrl || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) {
      try {
        return new URL(value, basePageUrl).toString();
      } catch {
        return value;
      }
    }
    return value;
  };

  const extractMediaUrlsFromJson = (input, onUrl, depth = 0) => {
    if (!input || typeof input !== 'object' || typeof onUrl !== 'function' || depth > 6) return;
    if (Array.isArray(input)) {
      input.forEach((entry) => extractMediaUrlsFromJson(entry, onUrl, depth + 1));
      return;
    }

    const type = String(input['@type'] || '').toLowerCase();
    const mediaProps = ['contentUrl', 'embedUrl', 'url', 'thumbnailUrl', 'sourceUrl', 'videoUrl', 'streamUrl'];

    if (type && /video|media/i.test(type)) {
      for (const value of Object.values(input)) {
        if (typeof value === 'string' && value.startsWith('http') && /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts|m4s|mp4a|mp4v)(?:$|\?|#)/i.test(value)) {
          onUrl(value, { fromStructuredData: true });
        }
      }
    }

    for (const prop of mediaProps) {
      const value = input[prop];
      if (typeof value === 'string' && value.startsWith('http') && /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts|m4s|mp4a|mp4v)(?:$|\?|#)/i.test(value)) {
        onUrl(value, { fromStructuredData: true });
      }
    }

    Object.values(input).forEach((entry) => extractMediaUrlsFromJson(entry, onUrl, depth + 1));
  };

  /* ═══════════════════════════════════════════════════════════════
   *  Headful mode detection (module-level, persists across calls)
   *  Modern Playwright's headless: true uses the "new" headless
   *  engine (full Chrome with WASM/GPU). Some extreme anti-bot
   *  sites still detect even new-headless, so we fall back to
   *  headful with a standard human resolution for those domains.
   * ═══════════════════════════════════════════════════════════════ */
  // Win32 stealth hider is now managed by stealth-hider.cjs


  /* ═══════════════════════════════════════════════════════════════
   *  Main capture function
   * ═══════════════════════════════════════════════════════════════ */
  let globalActiveBrowser = null;
  let globalActiveCaptureResolver = null;

  function abortActiveCapture() {
    if (globalActiveBrowser) {
      console.log('[PLAYWRIGHT] Aborting previous active capture session due to new request');
      try { globalActiveBrowser.close(); } catch (e) { }
      globalActiveBrowser = null;
    }
    if (globalActiveCaptureResolver) {
      try { globalActiveCaptureResolver(null); } catch (e) { }
      globalActiveCaptureResolver = null;
    }
  }
  async function fetchMainPlayableVideoUrl(pageUrl, onProgress, depth = 0, customReferer = null) {
    let globalCapturedDrmKeys = null;
    const reportProgress = (msg) => {
      console.log(`[PROGRESS] ${msg}`);
      if (typeof onProgress === 'function') onProgress(msg);
    };
    if (!playwright) {
      console.log('Playwright not available for generic extraction');
      return null;
    }


    /* ── Header builder ────────────────────────────────────────── */
    const buildGenericProxyHeaders = (mediaUrl) => {
      if (providerRegistry?.buildProxyHeaders) {
        return providerRegistry.buildProxyHeaders(pageUrl, mediaUrl, buildFallbackProxyHeaders);
      }
      return buildFallbackProxyHeaders(pageUrl, mediaUrl);
    };

    /* ── Cache check ───────────────────────────────────────────── */
    const cacheKey = `generic:${pageUrl}`;
    const cached = genericPlaywrightCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('Using cached generic Playwright result for:', pageUrl);
      return cached.payload;
    }

    /* ── Per-request state ─────────────────────────────────────── */
    let browser = null;
    const capturedUrls = new Set();
    const capturedNormalized = new Set();   // NEW: normalized URLs for dedup
    const capturedSubtitles = new Map();
    const providerState = {};
    const startTime = Date.now();

    // Track context about how each URL was discovered
    const urlContext = new Map();
    const capturedRequestHeaders = new Map();
    const setUrlContext = (url, ctx) => {
      const existing = urlContext.get(url) || {};
      urlContext.set(url, { ...existing, ...ctx });
    };
    const pickSafeBrowserHeaders = (headers) => {
      if (!headers || typeof headers !== 'object') return null;
      const allowed = new Set([
        'user-agent', 'referer', 'origin', 'cookie', 'authorization',
        'accept-language', 'accept', 'range', 'sec-fetch-site',
        'sec-fetch-mode', 'sec-fetch-dest'
      ]);
      const result = {};
      for (const [key, value] of Object.entries(headers)) {
        if (!key || value == null) continue;
        const normalizedKey = String(key).toLowerCase();
        if (!allowed.has(normalizedKey)) continue;
        result[normalizedKey] = String(value);
      }
      return Object.keys(result).length > 0 ? result : null;
    };
    const rememberRequestHeaders = (url, headers) => {
      if (!url) return;
      const safe = pickSafeBrowserHeaders(headers);
      if (!safe) return;
      const existing = capturedRequestHeaders.get(url) || {};
      capturedRequestHeaders.set(url, { ...existing, ...safe });
    };

    /** NEW: Deduplicating add – returns true if the URL was actually new */
    const addCapturedUrl = (url) => {
      const resolvedUrl = resolveCapturedUrlAgainstPage(url, pageUrl);
      if (!resolvedUrl) return false;
      if (capturedUrls.has(resolvedUrl)) return false;
      const norm = normalizeForDedup(resolvedUrl);
      if (capturedNormalized.has(norm)) return false;
      capturedUrls.add(resolvedUrl);
      capturedNormalized.add(norm);
      return true;
    };

    /* ── Settle mechanism (ENHANCED: min score gate) ───────────── */
    let _settleResolve;
    let _settleTimer;
    let bestCapturedScore = 0;
    let mediaCaptureCount = 0;
    const settlePromise = new Promise(r => { _settleResolve = r; });

    const scheduleSettle = (delayMs) => {
      if (_settleTimer) clearTimeout(_settleTimer);
      _settleTimer = setTimeout(() => _settleResolve('settled'), delayMs);
    };

    const onMediaCaptured = (url, context = {}) => {
      mediaCaptureCount++;
      const score = scoreUrl(url, context);

      // NEW: Don't trigger settle on very low-score captures (thumbnails, previews, etc.)
      if (score < MIN_SETTLE_SCORE) {
        console.log(`[PLAYWRIGHT][LOW-SCORE] ${score} – skipping settle trigger for: ${url}`);
        return;
      }

      if (bestCapturedScore >= HIGH_CONF_SCORE && score < HIGH_CONF_SCORE) return;
      if (mediaCaptureCount > FLOOD_THRESHOLD && score <= bestCapturedScore) return;
      if (score > bestCapturedScore) bestCapturedScore = score;

      scheduleSettle(
        bestCapturedScore >= VERY_HIGH_CONF_SCORE ? 2000 :
          bestCapturedScore >= HIGH_CONF_SCORE ? FAST_SETTLE_DELAY_MS : SETTLE_DELAY_MS
      );
    };

    /* ── Media-URL checker (REFINED) ───────────────────────────── */
    const isMediaUrl = (url) => {
      const lower = String(url || '').toLowerCase();

      // Skip blobs, data URIs
      if (RE_BLOB_DATA.test(lower)) return false;
      // Skip static assets (JS, CSS, fonts, images)
      if (RE_STATIC_ASSET.test(lower)) return false;
      // NEW: Skip page URLs
      if (isLikelyPageUrl(url)) return false;

      if (DOWNLOAD_PATH_PATTERNS.some((pattern) => pattern.test(lower))) return true;

      // Layer 1: Extension match
      if (RE_MEDIA_EXT.test(lower)) return true;
      // Layer 2: Media path keywords
      if (RE_MEDIA_PATH.test(lower)) return true;
      // Layer 3: Provider-specific (generic hook)
      if (providerRegistry?.shouldCaptureUrl?.({ pageUrl, url })) return true;
      // Layer 4: CDN hostname + media-serve path pattern
      const hostname = extractHostname(url);
      if (isCdnHostname(hostname) && isMediaServePath(url)) return true;
      // Layer 5: URL has video-related query parameters
      try {
        const u = new URL(url);
        if (u.searchParams.has('mime') && u.searchParams.get('mime').startsWith('video/')) return true;
        if (u.searchParams.has('type') && /^video\//i.test(u.searchParams.get('type'))) return true;
        if (u.searchParams.has('format') && /^(mp4|webm|hls|dash|m3u8|mpd)$/i.test(u.searchParams.get('format'))) return true;
      } catch { }
      return false;
    };

    /** NEW: Comprehensive validation before accepting a URL from any source.
     *  This runs AFTER isMediaUrl and provides a second layer of filtering
     *  to reject URLs that passed basic detection but are actually junk. */
    const shouldAcceptCapturedUrl = (url, source = 'unknown') => {
      if (!url) return false;
      if (RE_BLANK_MP4.test(url)) return false;
      if (isTemplatePlaceholderMp4Url(url)) return false;
      if (isTemplateMediaUrl(url)) return false;
      if (isLikelyAdUrl(url)) return false;
      if (adBlockManager?.isPotentialAdMedia({ url, pageUrl })) return false;
      if (isLikelyPageUrl(url)) return false;
      if (DOWNLOAD_PATH_PATTERNS.some((pattern) => pattern.test(url))) return true;
      // For DOM-DISCOVER source, be stricter
      if (source === 'dom-discover') {
        if (RE_STATIC_ASSET.test(url)) return false;
        // Require either media extension or strong CDN+path signal
        const hostname = extractHostname(url);
        const isKnownMediaNode = isCdnHostname(hostname) && !RE_ANALYTICS_HOSTNAME.test(hostname);
        if (!isMediaUrl(url) && !isKnownMediaNode) return false;

        // If it looks like a v/view/download link on a CDN, it's likely the stream
        if (isKnownMediaNode && /\/(?:v|view|download)\//i.test(url)) return true;
      }

      // Special case: if it's on a known media subdomain and has a v/view/download keyword, accept it
      if (isCdnHostname(extractHostname(url)) && /\/(?:v|view|download)\//i.test(url)) return true;
      return true;
    };

    /* ── DOM polling helper ──────────────────────────── */
    const pollDom = async (page) => {
      try {
        // Get in-page captured URLs from our injected interceptors
        // Also scan inline script content for ClearKey DRM patterns
        const intercepted = await page.evaluate(() => {
          const result = {
            mutationUrls: (window.__capturedMediaUrls || []).splice(0),
            fetchUrls: (window.__interceptedMediaFetches || []).splice(0),
            drmKeys: window.__aetherDrmKeys || null
          };

          // If hooks didn't capture DRM keys, scan script content directly
          if (!result.drmKeys) {
            try {
              const scripts = document.querySelectorAll('script:not([src])');
              for (const script of scripts) {
                const text = script.textContent || '';
                if (!text) continue;
                // Pattern 1: clearKeys: { 'hexKid': 'hexKey' } or clearKeys: { "hexKid": "hexKey" }
                const ckMatch = text.match(/clearKeys\s*:\s*\{([^}]+)\}/i);
                if (ckMatch) {
                  const inner = ckMatch[1];
                  const pairs = {};
                  // Match hex key pairs like 'kid': 'key' or "kid": "key"
                  const pairRe = /['"]([0-9a-fA-F]{16,64})['"]\s*:\s*['"]([0-9a-fA-F]{16,64})['"]/g;
                  let m;
                  while ((m = pairRe.exec(inner)) !== null) {
                    pairs[m[1]] = m[2];
                  }
                  if (Object.keys(pairs).length > 0) {
                    result.drmKeys = pairs;
                    window.__aetherDrmKeys = pairs;
                    console.log('[PLAYWRIGHT] Extracted DRM ClearKeys from script content:', JSON.stringify(pairs));
                    break;
                  }
                }
              }
            } catch (e) {
              // Script scanning failed, non-fatal
            }
          }

          // Polling-based shaka hook: if shaka.Player exists but hooks didn't fire
          if (!result.drmKeys) {
            try {
              if (typeof shaka !== 'undefined' && shaka && shaka.Player && shaka.Player.prototype) {
                // Check if any existing player instances have DRM config
                const videos = document.querySelectorAll('video');
                for (const v of videos) {
                  // Shaka attaches itself as v['shaka.Player']
                  const p = v['shaka.Player'];
                  if (p && typeof p.getConfiguration === 'function') {
                    const config = p.getConfiguration();
                    if (config && config.drm && config.drm.clearKeys && Object.keys(config.drm.clearKeys).length > 0) {
                      result.drmKeys = config.drm.clearKeys;
                      window.__aetherDrmKeys = config.drm.clearKeys;
                      console.log('[PLAYWRIGHT] Extracted DRM ClearKeys from shaka player instance:', JSON.stringify(config.drm.clearKeys));
                      break;
                    }
                  }
                }
              }
            } catch (e) {
              // Shaka polling failed, non-fatal
            }
          }

          return result;
        }).catch(() => ({ mutationUrls: [], fetchUrls: [], drmKeys: null }));

        // Also drain captured URLs from child frames (cross-origin iframes).
        // addInitScript injects interceptors into ALL frames via
        // Page.addScriptToEvaluateOnNewDocument, but page.evaluate() only
        // reads the main frame. We must read child frames separately.
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          try {
            const frameUrl = frame.url();
            const frameIntercepted = await Promise.race([
              frame.evaluate(() => {
                const r = {
                  mutationUrls: (window.__capturedMediaUrls || []).splice(0),
                  fetchUrls: (window.__interceptedMediaFetches || []).splice(0),
                  drmKeys: window.__aetherDrmKeys || null
                };
                // Scan inline scripts in iframe for ClearKey patterns
                if (!r.drmKeys) {
                  try {
                    const scripts = document.querySelectorAll('script:not([src])');
                    for (const script of scripts) {
                      const text = script.textContent || '';
                      const ckMatch = text.match(/clearKeys\s*:\s*\{([^}]+)\}/i);
                      if (ckMatch) {
                        const inner = ckMatch[1];
                        const pairs = {};
                        const pairRe = /['"]([0-9a-fA-F]{16,64})['"]\s*:\s*['"]([0-9a-fA-F]{16,64})['"]/g;
                        let m;
                        while ((m = pairRe.exec(inner)) !== null) { pairs[m[1]] = m[2]; }
                        if (Object.keys(pairs).length > 0) {
                          r.drmKeys = pairs;
                          window.__aetherDrmKeys = pairs;
                          console.log('[PLAYWRIGHT] Extracted DRM ClearKeys from iframe script:', JSON.stringify(pairs));
                          break;
                        }
                      }
                    }
                  } catch (e) { }
                }
                return r;
              }),
              new Promise(r => setTimeout(() => r({ mutationUrls: [], fetchUrls: [], drmKeys: null }), 1000))
            ]).catch(() => ({ mutationUrls: [], fetchUrls: [], drmKeys: null }));
            if (frameIntercepted.mutationUrls.length > 0 || frameIntercepted.fetchUrls.length > 0) {
              console.log(`[PLAYWRIGHT][IFRAME-DRAIN] Frame ${frameUrl}: ${frameIntercepted.mutationUrls.length} mutation URLs, ${frameIntercepted.fetchUrls.length} fetch URLs`);
            }
            if (frameIntercepted.drmKeys && !intercepted.drmKeys) {
              console.log(`[PLAYWRIGHT][IFRAME-DRAIN] Frame ${frameUrl}: Found DRM Keys!`);
              intercepted.drmKeys = frameIntercepted.drmKeys;
            }
            intercepted.mutationUrls.push(...frameIntercepted.mutationUrls);
            intercepted.fetchUrls.push(...frameIntercepted.fetchUrls);
          } catch (e) {
            console.log(`[PLAYWRIGHT][IFRAME-DRAIN] Frame access error: ${e.message}`);
          }
        }

        // Comprehensive DOM scrape
        const domResult = await page.evaluate(() => {
          const videoSrcs = [];
          const discoveredUrls = [];
          const subs = [];
          const seen = new Set();

          const addVideo = (src) => {
            if (!src || src.startsWith('blob:') || src.startsWith('data:') || seen.has(src)) return;
            // Ignore empty src attributes that resolved to the page URL
            try {
              if (src === window.location.href) return;
              const srcUrl = new URL(src, window.location.href);
              const pageUrl = new URL(window.location.href);
              if (srcUrl.origin === pageUrl.origin && srcUrl.pathname === pageUrl.pathname) return;
            } catch (e) { }
            seen.add(src);
            videoSrcs.push(src);
            console.log('[DEBUG-pollDom] Added video src:', src);
          };
          const addDiscovered = (src, source = 'dom') => {
            if (!src || src.startsWith('blob:') || src.startsWith('data:') || seen.has(src)) return;
            seen.add(src);
            discoveredUrls.push({ url: src, source });
          };

          /* ── 1. Native <video> / <source> elements ── */
          document.querySelectorAll('video').forEach(v => {
            addVideo(v.currentSrc || v.src);
            if (v.src) addVideo(v.src);
            ['data-src', 'data-video-src', 'data-url', 'data-file',
              'data-stream-url', 'data-hls', 'data-dash', 'data-mp4'].forEach(attr => {
                const val = v.getAttribute(attr);
                if (val) addVideo(val);
              });
            v.querySelectorAll('source').forEach(src => {
              if (src.src) addVideo(src.src);
              const dataSrc = src.getAttribute('data-src');
              if (dataSrc) addVideo(dataSrc);
            });
          });

          /* ── 2. <track> elements (subtitles) ── */
          document.querySelectorAll('track').forEach(t => {
            if (t.src) subs.push({
              src: t.src, srclang: t.srclang || '', label: t.label || '', kind: t.kind || 'subtitles'
            });
          });

          /* ── 3. <meta> tags (og:video, twitter:player) ── */
          const metaSelectors = [
            'meta[property="og:video"]', 'meta[property="og:video:url"]',
            'meta[property="og:video:secure_url"]', 'meta[name="twitter:player:stream"]',
            'meta[itemprop="contentUrl"]', 'meta[itemprop="embedUrl"]'
          ];
          metaSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
              const content = el.getAttribute('content');
              if (content && content.startsWith('http')) addDiscovered(content, 'meta');
            });
          });

          /* ── 4. Data attributes on any element ── */
          const dataAttrs = [
            'data-video-url', 'data-video-src', 'data-src', 'data-stream-url',
            'data-file-url', 'data-media-url', 'data-hls-url', 'data-dash-url',
            'data-mp4-url', 'data-source', 'data-video', 'data-hls', 'data-dash'
          ];
          dataAttrs.forEach(attr => {
            document.querySelectorAll(`[${attr}]`).forEach(el => {
              const val = el.getAttribute(attr);
              if (val && val.startsWith('http')) addDiscovered(val, 'data-attr');
            });
          });

          /* ── 4.5. Preloaded media/manifests via <link> ── */
          document.querySelectorAll('link[href]').forEach((el) => {
            const href = el.getAttribute('href') || '';
            const rel = String(el.getAttribute('rel') || '').toLowerCase();
            const asValue = String(el.getAttribute('as') || '').toLowerCase();
            const typeValue = String(el.getAttribute('type') || '').toLowerCase();
            if (!href) return;
            const looksMedia = /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:$|\?|#)/i.test(href) || /mpegurl|dash\+xml|video\//i.test(typeValue);
            if (!looksMedia) return;
            if (rel.includes('preload') || rel.includes('prefetch') || asValue === 'fetch' || asValue === 'video') {
              const finalHref = href.startsWith('//') ? window.location.protocol + href : href;
              if (finalHref.startsWith('http')) addDiscovered(finalHref, 'preload');
            }
          });

          /* ── 5. Schema.org / JSON-LD structured data ── */
          document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
            try {
              const data = JSON.parse(el.textContent);
              const extractMediaUrls = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > 6) return;
                if (Array.isArray(obj)) {
                  obj.forEach(item => extractMediaUrls(item, depth + 1));
                  return;
                }
                const type = obj['@type'] || '';
                if (typeof type === 'string' && /video|media/i.test(type)) {
                  for (const [, val] of Object.entries(obj)) {
                    if (typeof val === 'string' && val.startsWith('http')) {
                      if (/\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:$|\?|#)/i.test(val)) {
                        addDiscovered(val, 'jsonld');
                      }
                    }
                  }
                }
                const mediaProps = ['contentUrl', 'embedUrl', 'url', 'thumbnailUrl', 'sourceUrl', 'videoUrl', 'streamUrl'];
                for (const prop of mediaProps) {
                  const val = obj[prop];
                  if (typeof val === 'string' && val.startsWith('http') && /\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:$|\?|#)/i.test(val)) {
                    addDiscovered(val, 'jsonld');
                  }
                }
                Object.values(obj).forEach(v => extractMediaUrls(v, depth + 1));
              };
              extractMediaUrls(data, 0);
            } catch { }
          });

          /* ── 6. Download / direct links ── */
          const downloadSelectors = [
            'a[download]',
            'a[href*="download"]',
            'a[href*="/dload/"]',
            'a[href*="/dl/"]',
            'a[href*="/get/"]',
            'a[href*="/file/"]',
            'a[href*="/stream/"]',
            'a[class*="download"]'
          ];
          document.querySelectorAll(downloadSelectors.join(',')).forEach(a => {
            if (a.href && a.href.startsWith('http')) addDiscovered(a.href, 'download');
          });

          // Additional generic direct media links
          document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href && /\.(mp4|webm|mkv|m3u8|mpd)(?:\?|$)/i.test(href)) {
              if (a.href && a.href.startsWith('http')) addDiscovered(a.href, 'a-media-link');
            }
          });

          // Noscript tag fallbacks (common on tube sites for no-JS/direct playback)
          document.querySelectorAll('noscript').forEach(el => {
            const content = el.textContent || el.innerHTML || '';
            if (!content) return;
            const srcMatch = content.match(/(?:src|href)=["']([^"']+\.(?:mp4|webm|m3u8|mpd)[^"']*)["']/gi);
            if (srcMatch) {
              srcMatch.forEach(m => {
                const url = m.replace(/^(?:src|href)=["']/, '').replace(/["']$/g, '');
                if (url.startsWith('http') || url.startsWith('//')) {
                  const finalUrl = url.startsWith('//') ? window.location.protocol + url : url;
                  addDiscovered(finalUrl, 'noscript');
                }
              });
            }
          });

          /* ── 7. Inline <script> text mining (ENHANCED) ── */
          document.querySelectorAll('script:not([src])').forEach(el => {
            const text = el.textContent || '';
            if (text.length > 3000000) return; // Increased to 3MB to catch large state objects
            // ── 7a. Direct URL pattern: HTTP links with media extensions ──
            const urlPattern = /https?:[\\\/]+[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
            let match;
            while ((match = urlPattern.exec(text)) !== null) {
              let url = match[0].replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\$/g, '').replace(/["'\\,;}\]]+$/g, '');
              if (url.startsWith('http')) addDiscovered(url);
            }
            // ── 7b. Extensionless CDN-like URLs ──
            const cdnPattern = /https?:\/\/(?:cache|cdn|media|video|stream|files?|sv|node|edge)\d*\.[^\s"'<>\]}{]{20,}/gi;
            while ((match = cdnPattern.exec(text)) !== null) {
              let url = match[0].replace(/["'\\,;}\]]+$/g, '');
              if (url.startsWith('http')) addDiscovered(url);
            }

            // ── 7c. JS object literal extraction ──
            // Extract blocks assigned to variables: var x={...} / window.x={...}
            // Then mine key:value pairs where key implies media and value is a URL.
            // This captures resolution-annotated sources (e.g. "1080p":"https://...")
            // that JSON.parse would fail on because they're JS object literals, not JSON.
            try {
              const objLiteralPat = /(?:(?:var|let|const)\s+\w+|window\.\w+|\w+)\s*=\s*(\{[^{}]{15,3000}\})/g;
              let om;
              while ((om = objLiteralPat.exec(text)) !== null) {
                const block = om[1];
                if (!block.includes('http')) continue;
                // Key : "url-value" pairs
                const kvPat = /["']?([\w.$-]{1,40})["']?\s*:\s*["'](https?:[^"']{10,600})["']/g;
                let kv;
                while ((kv = kvPat.exec(block)) !== null) {
                  const key = (kv[1] || '').toLowerCase();
                  const val = kv[2];
                  if (!val || !val.startsWith('http')) continue;
                  const isMediaKey = /url|src|file|stream|hls|dash|mp4|webm|video|media|play|link|path|cdn|direct|progressive|hd|sd|4k|2k|1080|720|480|360|240|quality|resolution|format|source|alt|fallback|backup|mirror/i.test(key);
                  const isMediaVal = /\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:\/)?(?:\?|#|$)/i.test(val) ||
                    /\/(?:hls|dash|manifest|stream|video|media)\//i.test(val);
                  if (isMediaKey || isMediaVal) {
                    const cleaned = val.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/["'\\,;}\]]+$/g, '');
                    if (cleaned.startsWith('http')) addDiscovered(cleaned);
                  }
                }
              }
            } catch { }

            // ── 7d. Array of source objects: [{src:"...", type:"..."}, ...] ──
            // Captures Video.js / JW Player / custom multi-source arrays
            try {
              const srcArrayPat = /\[\s*\{[^\[\]]{10,3000}\}\s*\]/g;
              let am;
              while ((am = srcArrayPat.exec(text)) !== null) {
                const block = am[0];
                if (!block.includes('http')) continue;
                const srcKvPat = /["'](?:src|file|url|source|link)["']\s*:\s*["'](https?:[^"']{10,600})["']/gi;
                let sm;
                while ((sm = srcKvPat.exec(block)) !== null) {
                  const url = sm[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
                  if (url.startsWith('http')) addDiscovered(url);
                }
              }
            } catch { }

            // ── 7e. player.src("url") / player.source("url") patterns ──
            const playerSrcPattern = /(?:player|video|media)\.(?:src|source)\s*\(\s*["'](https?:\/\/[^"']+)["']/gi;
            let psMatch;
            while ((psMatch = playerSrcPattern.exec(text)) !== null) {
              addDiscovered(psMatch[1]);
            }
          });

          /* ── 8. Global JS variables (common player configs) ── */
          // EXPANDED: includes Flash-era naming, white-label player conventions,
          // Fluid Player globals, SSR data containers, and generic wrapper names.
          const globalVars = [
            // Modern standard names
            'videoUrl', 'videoSrc', 'videoSource', 'fileStreamURL', 'streamUrl',
            'hlsUrl', 'dashUrl', 'mp4Url', 'mediaUrl', 'playbackUrl',
            'playerSrc', 'sourceUrl', 'contentUrl', 'fileUrl', 'directUrl',
            // Flash-era / legacy PHP-embed variable passing
            'flashvars', 'flashVars', 'playerVars', 'embedVars',
            'file', 'filePath', 'fileURL', 'videoFile', 'videoPath',
            'video_url', 'video_src', 'video_file', 'stream_url', 'stream_file',
            'hls_url', 'dash_url', 'mp4_url', 'webm_url',
            // White-label / generic player option objects
            'playerOptions', 'videoOptions', 'mediaOptions', 'playerSettings',
            'videoSettings', 'mediaSettings', 'playerData', 'videoData', 'mediaData',
            'initVars', 'pageVars', 'siteVars', 'appVars',
            // Fluid Player and derivatives
            'fluidPlayerOptions', 'fpConfig',
            // Other prevalent white-label globals
            'xPlayerConfig', 'myPlayerConfig', 'vConfig', 'pConfig',
            'playerSetup', 'playerInit', 'videoInit', 'mediaInit',
            'jwConfig', 'vjsConfig',
            // SSR data containers
            '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APP_STATE__',
            '__SERVER_DATA__', '__data__',
            // Uppercase env-style constants sometimes set on window
            'VIDEO_URL', 'STREAM_URL', 'HLS_URL', 'MEDIA_URL',
          ];
          const dynamicGlobalVars = [];
          try {
            for (const key in window) {
              const lowerKey = key.toLowerCase();
              if (lowerKey.startsWith('flashvars') || lowerKey.startsWith('player') || lowerKey.startsWith('media') || lowerKey.startsWith('video')) {
                dynamicGlobalVars.push(key);
              }
            }
          } catch { }

          const allGlobalVars = Array.from(new Set([...globalVars, ...dynamicGlobalVars]));
          allGlobalVars.forEach(varName => {
            try {
              const val = window[varName];
              if (typeof val === 'string' && val.startsWith('http')) {
                addDiscovered(val);
              } else if (val && typeof val === 'object') {
                // Also mine object-typed globals shallowly for nested URL strings
                try {
                  const json = JSON.stringify(val).substring(0, 300000);
                  const urlPat = /https?:[\\\/]+[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
                  let m;
                  while ((m = urlPat.exec(json)) !== null) {
                    let u = m[0].replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/["'\\,;}\]]+$/g, '');
                    if (u.startsWith('http')) addDiscovered(u);
                  }
                } catch { }
              }
            } catch { }
          });

          // Check common config objects — EXPANDED list
          const configVars = [
            // Modern SSR / framework stores
            'playerConfig', 'videoConfig', 'mediaConfig', 'embedConfig',
            '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__', '__INITIAL_DATA__',
            '__REDUX_STATE__', '__MOBX_STATE__',
            // Fluid Player specific
            'fluidPlayerConfig', 'fluidPlayerInstance',
            // Site-specific but generically named config containers
            'siteConfig', 'appConfig', 'pageConfig', 'pageData', 'initialData',
            'bootstrapData', 'serverData', 'clientData', 'renderData',
            // Shaka / THEOplayer / Bitmovin configs
            'shakaConfig', 'theoplayerConfig', 'bitmovinConfig',
            // Generic wrapper names used by white-label streaming platforms
            'playerInfo', 'videoInfo', 'mediaInfo', 'streamInfo', 'contentInfo',
            'clipInfo', 'movieInfo', 'episodeInfo',
            'playlist', 'jwPlaylist', 'jwconfig',
          ];
          configVars.forEach(varName => {
            try {
              const obj = window[varName];
              if (!obj || typeof obj !== 'object') return;
              const json = JSON.stringify(obj).substring(0, 500000);
              const urlPattern = /https?:[\\\/]+[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
              let match;
              while ((match = urlPattern.exec(json)) !== null) {
                let url = match[0].replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/["'\\,;}\]]+$/g, '');
                if (url.startsWith('http')) addDiscovered(url);
              }
            } catch { }
          });

          /* ── 9. Player API probes ── */
          // JW Player
          try {
            const jw = typeof jwplayer === 'function' ? jwplayer() : null;
            if (jw?.getPlaylistItem) {
              const item = jw.getPlaylistItem();
              if (item?.file) addVideo(item.file);
              if (item?.sources) item.sources.forEach(s => { if (s.file) addVideo(s.file); });
              if (item?.allSources) item.allSources.forEach(s => { if (s.file) addVideo(s.file); });
              const caps = jw.getCaptionsList?.() || [];
              caps.forEach(c => {
                if (c.id && c.id !== 'off') subs.push({ src: c.id, label: c.label || '', kind: 'subtitles', srclang: '' });
              });
            }
            if (typeof jwplayer === 'function' && jwplayer.api) {
              const instances = jwplayer.api.getPlayers?.() || [];
              instances.forEach(p => {
                try {
                  const item = p.getPlaylistItem?.();
                  if (item?.file) addVideo(item.file);
                  if (item?.sources) item.sources.forEach(s => { if (s.file) addVideo(s.file); });
                } catch { }
              });
            }
          } catch { }

          // Video.js
          try {
            const players = typeof videojs === 'function' && videojs.getPlayers ? videojs.getPlayers() : null;
            if (players) Object.values(players).forEach(p => {
              try {
                const s = p?.currentSource?.()?.src || p?.src?.();
                if (s && !s.startsWith('blob:')) addVideo(s);
                const sources = p?.currentSources?.() || [];
                sources.forEach(src => {
                  if (src.src && !src.src.startsWith('blob:')) addVideo(src.src);
                });
              } catch { }
            });
          } catch { }

          // Plyr
          try {
            const plyrEl = document.querySelector('.plyr');
            const plyr = plyrEl?.plyr;
            if (plyr?.source?.sources) {
              plyr.source.sources.forEach(s => {
                if (s.src && !s.src.startsWith('blob:')) addVideo(s.src);
              });
            }
            const media = plyrEl?.querySelector('video, audio');
            if (media?.src && !media.src.startsWith('blob:')) addVideo(media.src);
            if (media?.currentSrc && !media.currentSrc.startsWith('blob:')) addVideo(media.currentSrc);
          } catch { }

          // Flowplayer / generic flowplayer-style wrappers
          try {
            document.querySelectorAll('.flowplayer').forEach(fp => {
              if (fp.player?.video?.src) addVideo(fp.player.video.src);
              if (fp.player?.video?.sources && Array.isArray(fp.player.video.sources)) {
                fp.player.video.sources.forEach(s => {
                  const src = typeof s === 'string' ? s : (s?.src || s?.url || s?.file);
                  if (src && !src.startsWith('blob:')) addVideo(src);
                });
              }
            });

            const collectFlowplayerLikeInstance = (inst) => {
              if (!inst || typeof inst !== 'object') return;
              try {
                const direct = inst.video?.src || inst.src || inst.currentSrc || inst.source?.src || inst.clip?.url;
                if (typeof direct === 'string' && direct.startsWith('http') && !direct.startsWith('blob:')) {
                  addVideo(direct);
                }
                const sources = inst.video?.sources || inst.sources || inst.source?.sources || inst.playlist || [];
                if (Array.isArray(sources)) {
                  sources.forEach(s => {
                    const src = typeof s === 'string' ? s : (s?.src || s?.url || s?.file);
                    if (src && src.startsWith('http') && !src.startsWith('blob:')) addVideo(src);
                  });
                }
              } catch { }
            };

            if (typeof window.flowplayer === 'function') {
              try {
                const fps = window.flowplayer();
                if (Array.isArray(fps)) fps.forEach(collectFlowplayerLikeInstance);
                else collectFlowplayerLikeInstance(fps);
              } catch { }
            }

            if (window.flowplayer && typeof window.flowplayer === 'object') {
              try {
                Object.values(window.flowplayer).forEach(collectFlowplayerLikeInstance);
              } catch { }
            }

            [window.player, window.fp, window.fpPlayer, window.flowplayerInstance, window.flowplayerPlayers].forEach(v => {
              if (Array.isArray(v)) v.forEach(collectFlowplayerLikeInstance);
              else collectFlowplayerLikeInstance(v);
            });
          } catch { }

          // Clappr
          try {
            if (window.player?.options?.source) addVideo(window.player.options.source);
            if (window.player?.options?.sources) {
              window.player.options.sources.forEach(s => {
                const src = typeof s === 'string' ? s : s?.src;
                if (src) addVideo(src);
              });
            }
          } catch { }

          // MediaElement.js
          try {
            document.querySelectorAll('.mejs__container').forEach(el => {
              const media = el.querySelector('video, audio');
              if (media?.src) addVideo(media.src);
              if (media?.currentSrc) addVideo(media.currentSrc);
            });
          } catch { }

          // hls.js instance
          try {
            if (window.hls?.url) addVideo(window.hls.url);
            if (window.hlsPlayer?.url) addVideo(window.hlsPlayer.url);
          } catch { }

          // dash.js instance
          try {
            if (window.dashPlayer?.getSource?.()) addVideo(window.dashPlayer.getSource());
            if (window.player?.getSource?.()) addDiscovered(window.player.getSource());
          } catch { }

          // ── Fluid Player (ADDED) ──
          // Fluid Player exposes a global array `window.fluidPlayerObjects` containing
          // all active player instances. Each instance has an internal `_options` config
          // and holds a reference to its <video> DOM element.
          try {
            const fpObjects = window.fluidPlayerObjects || window.fluidPlayers || [];
            if (Array.isArray(fpObjects)) {
              fpObjects.forEach(fp => {
                try {
                  // Direct DOM video reference
                  const vid = fp.domRef?.player || fp.videoPlayer || fp._video;
                  if (vid) {
                    if (vid.currentSrc && !vid.currentSrc.startsWith('blob:')) addVideo(vid.currentSrc);
                    if (vid.src && !vid.src.startsWith('blob:')) addVideo(vid.src);
                    vid.querySelectorAll?.('source').forEach(s => {
                      if (s.src && !s.src.startsWith('blob:')) addVideo(s.src);
                    });
                  }
                  // Internal options / config
                  const opts = fp._options || fp.options || fp.config || {};
                  const sources = opts.sources || opts.src || opts.file || opts.videoSources || [];
                  if (typeof sources === 'string' && sources.startsWith('http')) addVideo(sources);
                  if (Array.isArray(sources)) {
                    sources.forEach(s => {
                      const src = typeof s === 'string' ? s : (s?.src || s?.file || s?.url);
                      if (src && !src.startsWith('blob:')) addVideo(src);
                    });
                  }
                } catch { }
              });
            }
            // Also check the Fluid Player constructor registry on window
            if (typeof fluidPlayer !== 'undefined' && fluidPlayer.instances) {
              Object.values(fluidPlayer.instances).forEach(fp => {
                try {
                  const el = fp.domRef?.player;
                  if (el?.currentSrc && !el.currentSrc.startsWith('blob:')) addVideo(el.currentSrc);
                } catch { }
              });
            }
          } catch { }

          // ── Shaka Player ──
          try {
            const shaka = window.shakaPlayer || window.player;
            if (shaka?.getAssetUri?.()) {
              const uri = shaka.getAssetUri();
              if (uri && !uri.startsWith('blob:')) addVideo(uri);
            }
            // Shaka can also be attached to a video element
            document.querySelectorAll('video').forEach(v => {
              if (v.shakaPlayer?.getAssetUri?.()) {
                const uri = v.shakaPlayer.getAssetUri();
                if (uri && !uri.startsWith('blob:')) addVideo(uri);
              }
            });
          } catch { }

          // ── THEOplayer ──
          try {
            const theo = window.player || window.theoPlayer;
            if (theo?.source?.sources) {
              theo.source.sources.forEach(s => {
                if (s.src && !s.src.startsWith('blob:')) addVideo(s.src);
              });
            }
          } catch { }

          // ── Bitmovin Player ──
          try {
            const bitmovin = window.bitmovinPlayer || window.player;
            if (bitmovin?.getSource?.()) {
              const src = bitmovin.getSource();
              if (src?.hls) addVideo(src.hls);
              if (src?.dash) addVideo(src.dash);
              if (src?.progressive) {
                const p = src.progressive;
                if (typeof p === 'string') addVideo(p);
                else if (Array.isArray(p)) p.forEach(e => { if (e?.url) addVideo(e.url); });
              }
            }
          } catch { }

          // ── Generic: scan all named window properties for player instances ──
          // Catches custom global player handles (e.g. window.myPlayer, window.vPlayer)
          try {
            const playerNamePat = /^(?:player|vplayer|xplayer|myplayer|videoPlayer|mediaPlayer|flvPlayer|hlsPlayer|playlist|jwPlaylist|jwconfig|jwplayer)$/i;
            Object.keys(window).forEach(key => {
              if (!playerNamePat.test(key)) return;
              try {
                const inst = window[key];
                if (!inst || typeof inst !== 'object') return;
                // Try common source-getter patterns
                const src = inst.currentSrc || inst.src || inst.url || inst.file ||
                  (typeof inst.getSource === 'function' ? inst.getSource() : null) ||
                  (typeof inst.getPlaylistItem === 'function' ? inst.getPlaylistItem()?.file : null);
                if (src && typeof src === 'string' && !src.startsWith('blob:') && src.startsWith('http')) {
                  addDiscovered(src);
                }

                // Handle sources or playlist arrays (common in JS-based players)
                let items = [];
                if (Array.isArray(inst)) {
                  items = inst;
                } else {
                  // Some players have sources/playlist as property, others as a function result
                  const rawList = inst.sources || inst.playlist || inst.videoSources || inst.clip?.sources;
                  if (Array.isArray(rawList)) {
                    items = rawList;
                  } else if (typeof inst.getSources === 'function') {
                    items = inst.getSources() || [];
                  } else if (typeof inst.playlist === 'function') {
                    items = inst.playlist() || [];
                  }
                }

                if (Array.isArray(items)) {
                  items.forEach(item => {
                    if (!item) return;
                    // item could be a direct source string or an object with file/src/url
                    const u = typeof item === 'string' ? item : (item.file || item.src || item.url);
                    if (u && typeof u === 'string' && u.startsWith('http') && !u.startsWith('blob:')) {
                      addDiscovered(u);
                    }
                    // Recursive check (playlist item containing its own sources array)
                    if (item.sources && Array.isArray(item.sources)) {
                      item.sources.forEach(s => {
                        const uu = typeof s === 'string' ? s : (s.file || s.src || s.url);
                        if (uu && typeof uu === 'string' && uu.startsWith('http') && !uu.startsWith('blob:')) {
                          addDiscovered(uu);
                        }
                      });
                    }
                  });
                }
              } catch { }
            });
          } catch { }

          /* ── 10. <object> / <embed> elements ── */
          document.querySelectorAll('object[data], embed[src]').forEach(el => {
            const src = el.getAttribute('data') || el.getAttribute('src');
            if (src && src.startsWith('http')) addDiscovered(src);
          });

          /* ── 11. <iframe> sources ── */
          document.querySelectorAll('iframe[src]').forEach(el => {
            let src = el.getAttribute('src');
            // Handle protocol-relative URLs (e.g. //mydaddy.cc/video/...)
            if (src && src.startsWith('//')) {
              src = window.location.protocol + src;
            }
            if (src && src.startsWith('http') && /(?:embed|video|player|watch)/i.test(src)) {
              addDiscovered(src, 'iframe-candidate');
            }
          });

          return { videoSrcs, discoveredUrls, subs };
        });

        return {
          videoSrcs: [...(domResult.videoSrcs || []), ...(intercepted.mutationUrls || [])],
          discoveredUrls: [
            ...(domResult.discoveredUrls || []),
            ...((intercepted.fetchUrls || []).map((url) => ({ url, source: 'intercepted-fetch' })))
          ],
          subs: domResult.subs || [],
          drmKeys: intercepted.drmKeys || null
        };
      } catch {
        return { videoSrcs: [], discoveredUrls: [], subs: [], drmKeys: null };
      }
    };

    /* ── Deep iframe polling ─────────────────────────────────────── */
    const pollIframes = async (page) => {
      const urls = [];
      try {
        const frames = page.frames();
        for (const frame of frames) {
          if (frame === page.mainFrame()) continue;
          const frameUrl = frame.url();
          try {
            const frameSrcs = await Promise.race([
              frame.evaluate(() => {
                const found = [];
                document.querySelectorAll('video').forEach(v => {
                  // Trigger play if not already playing — without this,
                  // currentSrc is empty because no play was ever initiated
                  try { v.muted = true; } catch { }
                  try { v.play().catch(() => { }); } catch { }
                  const s = v.currentSrc || v.src;
                  if (s && !s.startsWith('blob:') && !s.startsWith('data:')) found.push(s);
                  v.querySelectorAll('source').forEach(src => {
                    if (src.src && !src.src.startsWith('blob:') && !src.src.startsWith('data:')) found.push(src.src);
                  });
                });
                try {
                  const jw = typeof jwplayer === 'function' ? jwplayer() : null;
                  // Also trigger JWPlayer play to populate the playlist item
                  if (jw && typeof jw.play === 'function') {
                    try { jw.setMute(true); } catch { }
                    try { jw.play(); } catch { }
                  }
                  if (jw?.getPlaylistItem?.()?.file) found.push(jw.getPlaylistItem().file);
                  if (jw?.getPlaylistItem?.()?.sources) {
                    jw.getPlaylistItem().sources.forEach(s => {
                      if (s?.file && !s.file.startsWith('blob:')) found.push(s.file);
                    });
                  }
                } catch { }
                // Also drain any intercepted URLs from this frame's injected script
                try {
                  const captured = (window.__capturedMediaUrls || []).splice(0);
                  found.push(...captured);
                } catch { }
                return found;
              }),
              new Promise(r => setTimeout(() => r([]), 1000))
            ]).catch(() => []);
            urls.push(...frameSrcs);
          } catch { }
        }
      } catch { }
      return urls;
    };

    /* ── Play-click helper ──────────────────────────────────────── */
    const PLAY_SELECTORS = [
      '.plyr__control--overlaid',
      '.plyr__poster',
      '.jw-display-icon-container',
      '.jw-icon-display',
      // ── Accessible ARIA play buttons ──
      'button[aria-label="Play"]',
      'button[aria-label="play"]',
      '[role="button"][aria-label="Play"]',
      // ── Video.js ──
      '.vjs-big-play-button',
      '.vjs-play-control',
      // ── Generic named classes ──
      '.play-button',
      '.play-btn',
      '.btn-play',
      '.icon-play',
      // ── Fluid Player and derivatives: full-player-sized overlay divs ──
      // Fluid Player uses a large <div> overlay that traps the first click
      '.fluid_initial_play',
      '.fluid_initial_play_button',
      '.fluid_video_wrapper',
      '.fp-ui',
      '.fp-play',
      '.fp-controls .fp-play',
      '[class*="fluid_"][class*="play"]',
      '[class*="fluid_"][class*="overlay"]',
      '[class*="fluid_initial"]',
      // ── onclick-bound triggers ──
      '[onclick*="loadVideo"]',
      '[onclick*="playVideo"]',
      '[onclick*="initVideo"]',
      '[onclick*="startPlay"]',
      '[onclick*="loadPlayer"]',
      '[onclick*="setupVideo"]',
      // ── Generic overlay / ui-wrapper patterns (white-label players) ──
      '#videoPlayOverlay',
      '[id*="play"][id*="overlay" i]',
      '[class*="play"][class*="overlay" i]',
      '[id*="video"][id*="overlay" i]',
      '[class*="initial"][class*="play" i]',
      '[class*="play"][class*="overlay" i]',
      '[class*="overlay"][class*="play" i]',
      '[class*="ui-wrapper"][class*="play" i]',
      '[class*="player"][class*="overlay" i]',
      '[class*="cover"][class*="play" i]',
      '[class*="splash"][class*="play" i]',
      '[class*="start"][class*="play" i]',
      // ── Common generic class fragments ──
      '[class*="play" i]',
      '.play-pause',
      '.poster',
      '[class*="poster" i]',
      // ── Plyr / MEJS / Fluid ──
      '.plyr__control--overlaid',
      '[data-plyr="play"]',
      '.mejs__overlay-play',
      '.fluid_initial_play',
      '.fluid_initial_play_button',
      '.fp-play',
      // ── YouTube-like ──
      '.ytp-large-play-button',
      '.html5-video-player .ytp-play-button',
      // ── JW Player ──
      '.jw-icon-display',
      '.jw-display-icon-container',
      // ── VideoPress / WordPress video ──
      '.vp-player-ui-overlays button',
      // ── Kaltura ──
      '.playkit-pre-playback-play-button',
      '.playkit-icon-play',
      // ── Brightcove ──
      '.vjs-big-play-button',
      // ── Wistia ──
      '.w-big-play-button',
      '[class*="wistia"][class*="play"]',
      // ── Dailymotion ──
      '.PlayerPlayButton',
      '[class*="playButton"]',
      // ── Generic data-action / data-event triggers ──
      '[data-action="play"]',
      '[data-event="play"]',
      '[data-cmd="play"]',
      // ── Native video element (fallback) ──
      'video'
    ];

    const DOWNLOAD_SELECTORS = [
      'a[download]',
      'a[href*="download"]',
      'button:has-text("Download")',
      '[class*="download"]',
      'a:has-text("Download")',
      '#downloadButton',
      '.download-btn',
      '.download-button'
    ];

    const tryClickPlay = async (page) => {
      // Brief delay to allow critical player scripts to initialize
      await new Promise(r => setTimeout(r, 200));

      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 800));
        let mainFrameClicked = false;

        // Give custom players a chance to finish attaching controls after overlay removal
        await page.evaluate(() => {
          try {
            const video = document.querySelector('video');
            if (video) {
              video.scrollIntoView({ block: 'center', inline: 'center' });
            }
          } catch { }
        }).catch(() => { });

        // Main frame - try each selector
        for (const sel of PLAY_SELECTORS) {
          try {
            const el = await page.$(sel);
            if (el) {
              const isVisible = await el.isVisible().catch(() => false);
              const box = await el.boundingBox().catch(() => null);

              if (box && box.width > 0 && box.height > 0) {
                // Use force: true to click even if element is covered by invisible overlays
                // This is crucial for custom players that stack wrappers over the media surface
                await el.click({
                  timeout: 2000,
                  force: true,
                  noWaitAfter: true
                }).catch(async () => {
                  await el.evaluate(e => e.click()).catch(() => { });
                });
                console.log(`[PLAYWRIGHT] Clicked: ${sel} (attempt ${attempt + 1}, visible=${isVisible})`);
                mainFrameClicked = true;
                break;
              }
            }
          } catch { }
        }

        // Try programmatic play plus click on the most likely media surface
        if (!mainFrameClicked) try {
          const surface = await page.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll(
              'video, [class*="player"], [class*="video"], [class*="play"], [class*="poster"], [class*="overlay"]'
            ));
            let best = null;
            let bestScore = -1;
            for (const el of candidates) {
              const rect = el.getBoundingClientRect();
              if (rect.width < 80 || rect.height < 40) continue;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
              let score = rect.width * rect.height;
              const cls = String(el.className || '');
              if (/player|video|play|poster|overlay/i.test(cls)) score += 50000;
              if (el.tagName === 'VIDEO') score += 100000;
              if (score > bestScore) {
                bestScore = score;
                best = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: el.tagName, cls };
              }
            }

            const video = document.querySelector('video');
            if (video) {
              try { video.muted = true; } catch { }
              try { video.play().catch(() => { }); } catch { }
              try { video.click(); } catch { }
            }
            // Strategy 1: Call any globally registered video-loader functions
            const globalVideoFns = [
              'loadVideo', 'playVideo', 'startVideo', 'initPlayer', 'initVideo',
              'startPlay', 'loadPlayer', 'play', 'startStream', 'loadStream',
              'setupVideo', 'renderVideo', 'initStream', 'triggerPlay'
            ];
            for (const fn of globalVideoFns) {
              try { if (typeof window[fn] === 'function') window[fn](); } catch { }
            }

            // Strategy 2: Click the largest visible element inside a video container
            // (Common for "click-to-load" custom players that use positioned overlays)
            try {
              const containers = document.querySelectorAll('video, [class*="player" i], [class*="video-wrap" i], [id*="player" i]');
              for (const container of containers) {
                const overlays = container.parentElement ? container.parentElement.querySelectorAll('[style*="position: absolute"], [style*="position:absolute"], [style*="position: fixed"]') : [];
                for (const overlay of overlays) {
                  const rect = overlay.getBoundingClientRect();
                  if (rect.width > 100 && rect.height > 100) {
                    overlay.click();
                  }
                }
              }
            } catch { }

            // Strategy 3: Framework-specific triggers (Plyr, Video.js, etc.)
            try { if (window.player && typeof window.player.play === 'function') window.player.play(); } catch { }
            try {
              if (typeof videojs !== 'undefined' && videojs.getPlayers) {
                const players = videojs.getPlayers();
                for (const p in players) players[p].play();
              }
            } catch { }

            return best;
          }).catch(() => null);

          if (surface) {
            await page.mouse.click(surface.x, surface.y).catch(() => { });
            console.log(`[PLAYWRIGHT] Clicked likely media surface (${surface.tag}) (attempt ${attempt + 1})`);
            mainFrameClicked = true;
          }
        } catch { }

        // Try clicking at the center of any video element
        if (!mainFrameClicked) try {
          const videoBox = await page.evaluate(() => {
            const video = document.querySelector('video');
            if (video) {
              const rect = video.getBoundingClientRect();
              if (rect.width > 100 && rect.height > 50) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
              }
            }
            return null;
          }).catch(() => null);

          if (videoBox) {
            await page.mouse.click(videoBox.x, videoBox.y);
            console.log(`[PLAYWRIGHT] Clicked at video center (${videoBox.x}, ${videoBox.y})`);
            mainFrameClicked = true;
          }
        } catch { }

        // ALWAYS also try inside iframes (even if main frame was clicked)
        // This is critical for sites like HQPorner where the real player
        // is inside a cross-origin iframe (e.g. mydaddy.cc)
        const frames = page.frames();
        const childFrames = frames.filter(f => f !== page.mainFrame());
        console.log(`[PLAYWRIGHT][IFRAME-DEBUG] Found ${childFrames.length} child frame(s): ${childFrames.map(f => f.url()).join(', ')}`);
        for (const frame of childFrames) {
          let iframeClicked = false;
          try {
            // Test if frame is alive and find matching selector in one shot inside the browser context
            const matchingSel = await Promise.race([
              frame.evaluate((selectors) => {
                for (const sel of selectors) {
                  if (document.querySelector(sel)) return sel;
                }
                return null;
              }, PLAY_SELECTORS),
              new Promise(r => setTimeout(() => r('TIMEOUT'), 500))
            ]).catch(() => null);

            if (matchingSel === 'TIMEOUT') {
              console.log(`[PLAYWRIGHT][IFRAME-DEBUG] Frame unresponsive, skipping...`);
              continue; // Skip this dead frame completely
            }

            if (matchingSel) {
              const el = await frame.$(matchingSel).catch(() => null);
              if (el) {
                await el.click({ timeout: 1500, force: true }).catch(() => { });
                console.log(`[PLAYWRIGHT] Clicked in iframe: ${matchingSel}`);
                mainFrameClicked = true;
                iframeClicked = true;
              }
            }
          } catch { }
          // Always try to trigger play programmatically inside the iframe
          try {
            // Wrap evaluate in a timeout because it hangs FOREVER if the frame is detached/stuck
            const frameSurface = await Promise.race([
              frame.evaluate(() => {
                const video = document.querySelector('video');
                if (video) {
                  try { video.muted = true; } catch { }
                  try { video.play().catch(() => { }); } catch { }
                  try { video.click(); } catch { }
                  const rect = video.getBoundingClientRect();
                  if (rect.width > 100 && rect.height > 50) {
                    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                  }
                }
                // Also try JWPlayer inside iframe
                try {
                  const jw = typeof jwplayer === 'function' ? jwplayer() : null;
                  if (jw && typeof jw.play === 'function') {
                    try { jw.setMute(true); } catch { }
                    try { jw.play(); } catch { }
                  }
                } catch { }
                return null;
              }),
              new Promise(r => setTimeout(() => r(null), 1000))
            ]).catch(() => null);

            if (frameSurface) {
              console.log('[PLAYWRIGHT] Triggered video play inside iframe');
              mainFrameClicked = true;
            }
          } catch { }
        }

        if (mainFrameClicked) return true;
      }
      return false;
    };

    /** NEW: Directly execute global initialization functions.
     * This bypasses ad overlays that hijack click events in tryClickPlay. */
    const tryProgrammaticVideoInit = async (page) => {
      await Promise.race([
        page.evaluate(() => {
          const globalVideoFns = [
            'loadVideo', 'playVideo', 'startVideo', 'initPlayer', 'initVideo',
            'startPlay', 'loadPlayer', 'play', 'startStream', 'loadStream',
            'setupVideo', 'renderVideo', 'initStream', 'triggerPlay'
          ];
          let triggered = false;
          for (const fn of globalVideoFns) {
            try {
              if (typeof window[fn] === 'function') {
                window[fn]();
                triggered = true;
              }
            } catch { }
          }

          // Also try specific known player APIs directly
          try { if (window.player && typeof window.player.play === 'function') window.player.play(); triggered = true; } catch { }
          try {
            if (typeof videojs !== 'undefined' && videojs.getPlayers) {
              const players = videojs.getPlayers();
              for (const p in players) { players[p].play(); triggered = true; }
            }
          } catch { }

          return triggered;
        }),
        new Promise(r => setTimeout(() => r(false), 2000))
      ]).catch(() => false);
    };

    const tryClickDownload = async (page) => {
      for (const sel of DOWNLOAD_SELECTORS) {
        try {
          const el = await page.$(sel);
          if (el) {
            const box = await el.boundingBox().catch(() => null);
            if (box && box.width > 0 && box.height > 0) {
              const tagName = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
              if (tagName === 'a') {
                const href = await el.evaluate(e => e.href).catch(() => '');
                if (href && href.startsWith('http') && href !== pageUrl) {
                  console.log(`[PLAYWRIGHT][DOWNLOAD-LINK] ${href}`);
                  return href;
                }
              }
              console.log(`[PLAYWRIGHT] Clicked download: ${sel}`);
              await el.click({ timeout: 2000 }).catch(() => { });
              await new Promise(r => setTimeout(r, 1500));
              return null;
            }
          }
        } catch { }
      }
      return null;
    };

    /* ═══════════════════════════════════════════════════════════════
     *  Age Gate / Consent Modal Dismissal (NEW)
     *  Text-based heuristics to find and click affirmative buttons
     * ═══════════════════════════════════════════════════════════════ */

    // Text patterns that indicate an affirmative/enter button (case-insensitive)
    const CONSENT_TEXT_PATTERNS = [
      // Age verification - exact phrases
      /^i am 18/i,
      /^i'm 18/i,
      /^im 18/i,
      /^18 or older/i,
      /^18\+/i,
      /^i am over 18/i,
      /^i am 18 or older/i,
      /^i am 18 years/i,
      /^i am an adult/i,
      /^i am of legal age/i,
      /^over 18/i,
      /^18 years/i,
      /^21\+/i,
      /^i am 21/i,
      /^i am over 21/i,
      // Entry confirmation
      /^enter$/i,
      /^enter site/i,
      /^enter now/i,
      /^continue$/i,
      /^continue to/i,
      /^proceed$/i,
      /^go to site/i,
      /^access site/i,
      /^view content/i,
      /^view site/i,
      /^let me in/i,
      /^i understand/i,
      /^i agree/i,
      /^i accept/i,
      /^agree$/i,
      /^accept$/i,
      /^ok$/i,
      /^okay$/i,
      /^yes$/i,
      /^yes,/i,
      /^confirm$/i,
      /^got it/i,
      /^i consent/i,
      /^accept.*continue/i,
      /^agree.*continue/i,
      // Cookie consent
      /^accept all/i,
      /^accept cookies/i,
      /^allow all/i,
      /^allow cookies/i,
      // Generic affirmative
      /^submit$/i,
      /^start$/i,
      /^begin$/i,
      /^launch$/i,
      /^watch$/i,
      /^play$/i,
    ];

    // CSS selectors for common consent/age gate containers
    const CONSENT_CONTAINER_SELECTORS = [
      '#age-gate', '#agegate', '#age_gate', '#ageGate',
      '#age-verification', '#age_verification', '#ageVerification',
      '#age-check', '#age_check', '#ageCheck',
      '#modal-age', '#modal_age', '#modalAge',
      '#entrance', '#entry', '#splash', '#interstitial',
      '#disclaimer', '#warning', '#confirm-age',
      '[class*="age-gate"]', '[class*="agegate"]', '[class*="age_gate"]',
      '[class*="age-verification"]', '[class*="age-check"]',
      '[class*="modal-age"]', '[class*="entrance"]', '[class*="interstitial"]',
      '[class*="splash-screen"]', '[class*="disclaimer"]',
      '[data-age-gate]', '[data-agegate]',
      '.age-popup', '.age-modal', '.age-overlay',
      '.consent-modal', '.consent-popup', '.consent-overlay',
      '.entrance-modal', '.entrance-popup',
      '.warning-modal', '.warning-popup', '.warning-overlay',
    ];

    // Direct button selectors for consent/age buttons
    const CONSENT_BUTTON_SELECTORS = [
      '#okButton', '#ok-button', '#okBtn', '#ok_button',
      '#enterButton', '#enter-button', '#enterBtn', '#enter_button',
      '#agreeButton', '#agree-button', '#agreeBtn', '#agree_button',
      '#acceptButton', '#accept-button', '#acceptBtn', '#accept_button',
      '#confirmButton', '#confirm-button', '#confirmBtn', '#confirm_button',
      '#yesButton', '#yes-button', '#yesBtn', '#yes_button',
      '#continueButton', '#continue-button', '#continueBtn',
      '#ageButton', '#age-button', '#ageBtn',
      '#verifyAge', '#verify-age', '#verify_age',
      '.age-yes', '.age-enter', '.age-confirm', '.age-accept',
      '[class*="age"][class*="button"]', '[class*="age"][class*="btn"]',
      '[class*="enter"][class*="button"]', '[class*="enter"][class*="btn"]',
      '[class*="consent"][class*="button"]', '[class*="consent"][class*="btn"]',
      '[class*="agree"][class*="button"]', '[class*="agree"][class*="btn"]',
      '[data-action="enter"]', '[data-action="confirm"]', '[data-action="accept"]',
      '[data-role="enter"]', '[data-role="confirm"]', '[data-role="accept"]',
    ];

    /**
     * Dismiss age gates, consent modals, and interstitial overlays.
     * Uses multiple strategies: direct selectors, text matching, and DOM analysis.
     * Returns true if something was clicked.
     */
    const dismissConsentOverlays = async (page, attempt = 1) => {
      console.log(`[PLAYWRIGHT][CONSENT] Attempting to dismiss overlays (attempt ${attempt}/${CONSENT_MAX_ATTEMPTS})`);

      let clicked = false;

      const waitForOverlayToClear = async () => {
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 150));
          const stillBlocking = await hasBlockingOverlay(page).catch(() => false);
          if (!stillBlocking) return true;
        }
        return false;
      };

      // Strategy 1: Try direct consent button selectors first (fastest)
      for (const sel of CONSENT_BUTTON_SELECTORS) {
        try {
          const el = await page.$(sel);
          if (el) {
            const isVisible = await el.isVisible().catch(() => false);
            if (isVisible) {
              await el.click({ force: true, timeout: 2000 }).catch(() => { });
              console.log(`[PLAYWRIGHT][CONSENT] Clicked direct selector: ${sel}`);
              clicked = true;
              break;
            }
          }
        } catch { }
      }

      if (clicked) {
        await new Promise(r => setTimeout(r, CONSENT_DISMISS_DELAY_MS));
        await waitForOverlayToClear().catch(() => false);
        return true;
      }

      // Strategy 2: Text-based button search (most reliable for unknown sites)
      try {
        clicked = await page.evaluate((patterns) => {
          // Convert pattern strings back to RegExp
          const regexPatterns = patterns.map(p => new RegExp(p.source, p.flags));

          // Find all clickable elements
          const clickables = Array.from(document.querySelectorAll(
            'button, a, div[role="button"], span[role="button"], input[type="button"], input[type="submit"], ' +
            '[onclick], [class*="button"], [class*="btn"], [tabindex="0"]'
          ));

          // Also check elements inside known consent containers
          const containerSels = [
            '#age-gate', '#agegate', '#entrance', '#modal', '#overlay', '#popup',
            '[class*="age"]', '[class*="modal"]', '[class*="overlay"]', '[class*="popup"]',
            '[class*="entrance"]', '[class*="interstitial"]', '[class*="consent"]'
          ];

          for (const sel of containerSels) {
            try {
              const containers = document.querySelectorAll(sel);
              containers.forEach(c => {
                c.querySelectorAll('button, a, div, span, input').forEach(el => {
                  if (!clickables.includes(el)) clickables.push(el);
                });
              });
            } catch { }
          }

          // Score and sort candidates
          const candidates = [];

          for (const el of clickables) {
            // Skip hidden elements
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            // Get text content
            const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
            if (!text || text.length > 100) continue;

            // Check against patterns
            let score = 0;
            for (const pattern of regexPatterns) {
              if (pattern.test(text)) {
                score = 100;
                // Boost score for very specific matches
                if (/18|21|adult|age|enter|agree|accept|consent/i.test(text)) score += 50;
                break;
              }
            }

            if (score > 0) {
              // Additional scoring factors
              // Prefer larger, more prominent buttons
              score += Math.min(rect.width * rect.height / 1000, 50);
              // Prefer elements with button-like classes
              if (/btn|button/i.test(el.className)) score += 20;
              // Prefer elements that are centered (likely modal buttons)
              const centerX = rect.left + rect.width / 2;
              const windowCenter = window.innerWidth / 2;
              if (Math.abs(centerX - windowCenter) < 200) score += 30;
              // Prefer elements near the vertical center or bottom (modal placement)
              const centerY = rect.top + rect.height / 2;
              if (centerY > window.innerHeight * 0.3) score += 20;

              candidates.push({ el, score, text: text.substring(0, 50) });
            }
          }

          // Sort by score and click the best candidate
          candidates.sort((a, b) => b.score - a.score);

          if (candidates.length > 0) {
            const best = candidates[0];
            console.log('[CONSENT] Best candidate:', best.text, 'score:', best.score);
            best.el.click();
            return true;
          }

          return false;
        }, CONSENT_TEXT_PATTERNS.map(r => ({ source: r.source, flags: r.flags }))).catch(() => false);

        if (clicked) {
          console.log('[PLAYWRIGHT][CONSENT] Clicked text-matched button');
          await new Promise(r => setTimeout(r, CONSENT_DISMISS_DELAY_MS));
          await waitForOverlayToClear().catch(() => false);
          return true;
        }
      } catch (e) {
        console.log('[PLAYWRIGHT][CONSENT] Text search error:', e.message);
      }

      // Strategy 3: Look for any prominent button inside overlay containers
      try {
        for (const containerSel of CONSENT_CONTAINER_SELECTORS) {
          const container = await page.$(containerSel);
          if (container) {
            const isVisible = await container.isVisible().catch(() => false);
            if (isVisible) {
              // Find buttons inside
              const buttons = await container.$$('button, a[href="#"], div[role="button"], [class*="btn"]');
              for (const btn of buttons) {
                const btnVisible = await btn.isVisible().catch(() => false);
                if (btnVisible) {
                  await btn.click({ force: true, timeout: 2000 }).catch(() => { });
                  console.log(`[PLAYWRIGHT][CONSENT] Clicked button inside container: ${containerSel}`);
                  await new Promise(r => setTimeout(r, CONSENT_DISMISS_DELAY_MS));
                  await waitForOverlayToClear().catch(() => false);
                  return true;
                }
              }
            }
          }
        }
      } catch { }

      // Strategy 4: Force-click any large centered overlay element (nuclear option)
      try {
        const forceClicked = await page.evaluate(() => {
          // Find elements that look like fullscreen overlays
          const overlays = Array.from(document.querySelectorAll('div, section, aside'))
            .filter(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              // Large overlay covering most of screen
              const isLarge = rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.3;
              // Fixed or absolute positioning (typical for modals)
              const isPositioned = style.position === 'fixed' || style.position === 'absolute';
              // High z-index (on top of content)
              const zIndex = parseInt(style.zIndex) || 0;
              const isOnTop = zIndex > 100 || style.zIndex === 'auto';
              // Has clickable children
              const hasButtons = el.querySelector('button, a, [onclick], [class*="btn"]');

              return isLarge && isPositioned && hasButtons;
            });

          for (const overlay of overlays) {
            // Click the first button-like element
            const btn = overlay.querySelector('button, a, [onclick], [class*="btn"], div[role="button"]');
            if (btn) {
              btn.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (forceClicked) {
          console.log('[PLAYWRIGHT][CONSENT] Force-clicked overlay button');
          await new Promise(r => setTimeout(r, CONSENT_DISMISS_DELAY_MS));
          await waitForOverlayToClear().catch(() => false);
          return true;
        }
      } catch { }

      console.log('[PLAYWRIGHT][CONSENT] No consent overlay found to dismiss');
      return false;
    };

    /**
     * Check if an overlay/modal is blocking the page content
     */
    const hasBlockingOverlay = async (page) => {
      try {
        return await page.evaluate(() => {
          // Check for common overlay indicators
          const indicators = [
            // Fixed/absolute positioned elements covering viewport
            ...Array.from(document.querySelectorAll('div, section')).filter(el => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return (style.position === 'fixed' || style.position === 'absolute') &&
                rect.width > window.innerWidth * 0.5 &&
                rect.height > window.innerHeight * 0.5 &&
                parseInt(style.zIndex) > 10;
            }),
            // Known overlay selectors
            document.querySelector('#age-gate'),
            document.querySelector('#agegate'),
            document.querySelector('[class*="age-gate"]'),
            document.querySelector('[class*="age-verification"]'),
            document.querySelector('[class*="entrance"]'),
            document.querySelector('[class*="interstitial"]'),
            document.querySelector('[class*="modal"][class*="show"]'),
            document.querySelector('[class*="overlay"][class*="visible"]'),
          ].filter(Boolean);

          return indicators.length > 0;
        }).catch(() => false);
      } catch {
        return false;
      }
    };

    // Determine initial headless mode
    // Use headful mode by default for ALL domains now that it is surgically hidden.
    // This provides maximum bot detection bypass while remaining invisible.
    let useHeadful = true;

    /* ════════════════════════════════════════════════════════════
     *  Main capture flow – "stealth-wealth" browser profile
     *  Default: headless: true (modern Playwright "new" headless
     *  engine — full Chrome with WASM, GPU, WebGL). Falls back to
     *  headful with a standard human resolution for domains that
     *  still detect new-headless.
     * ════════════════════════════════════════════════════════════ */
    const launchBrowser = async (headful) => {
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-features=OutOfBlinkCors',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-dev-shm-usage',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic',
        '--use-mock-keychain',
        '--no-default-browser-check',
        '--no-zygote',
        '--autoplay-policy=no-user-gesture-required'
      ];
      if (headful) {
        // Standard human-like resolution.
        // window-state=minimized and window-position=-32000,-32000 ensure
        // the browser is born hidden even before the Win32 helper cloaks it.
        launchArgs.push('--window-size=1280,720');
        launchArgs.push('--window-position=-32000,-32000');
        launchArgs.push('--window-state=minimized');
        launchArgs.push('--mute-audio');
      }
      const detectWindowsSystemProxy = () => {
        if (process.platform !== 'win32') return null;
        try {
          const { execSync } = require('child_process');

          // Check if proxy is enabled
          const enableOutput = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
          );
          const hasEnableMatch = enableOutput.match(/ProxyEnable\s+REG_DWORD\s+0x(1|0)/i);
          if (!hasEnableMatch || hasEnableMatch[1] !== '1') {
            return null;
          }

          // Get Proxy Server address
          const serverOutput = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
          );
          const serverMatch = serverOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
          if (serverMatch && serverMatch[1]) {
            const serverVal = serverMatch[1].trim();
            let server = serverVal;
            if (server.includes(';')) {
              const parts = server.split(';');
              const httpsPart = parts.find(p => p.startsWith('https='));
              const httpPart = parts.find(p => p.startsWith('http='));
              const fallbackPart = parts[0];
              const selected = httpsPart || httpPart || fallbackPart;
              server = selected.substring(selected.indexOf('=') + 1);
            }
            if (!server.includes('://')) {
              return `http://${server}`;
            }
            return server;
          }
        } catch (err) {
          // Ignore registry lookup failures
        }
        return null;
      };

      const exePath = playwrightExecutablePath || undefined;
      console.log('[PLAYWRIGHT] Launching browser with executablePath:', exePath);

      const launchOptions = {
        headless: !headful,
        executablePath: exePath,
        args: launchArgs
      };

      // Detect and apply system/environment proxy to bypass geoblocks and connection failures
      const proxyUrl = process.env.aether_DOWNLOADER_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy || detectWindowsSystemProxy();
      if (proxyUrl) {
        console.log('[PLAYWRIGHT] Automatically routing traffic through detected proxy server:', proxyUrl);
        launchOptions.proxy = {
          server: proxyUrl
        };
      }

      return playwright.chromium.launch(launchOptions);
    };

    try {
      reportProgress(`Initializing capture engine...`);
      console.log(`[PLAYWRIGHT] Launching for: ${pageUrl}${useHeadful ? ' (HEADFUL - bot detection bypass)' : ''}`);

      // ── Win32 stealth watcher — starts BEFORE browser launch ────
      // This helper polls for children of the current process with
      // the Chromium class name and strips their taskbar icons.
      if (useHeadful && process.platform === 'win32') {
        startStealthHider();
        // Give the stealth helper a head start
        await new Promise(r => setTimeout(r, 100));
      }

      browser = await launchBrowser(useHeadful);
      globalActiveBrowser = browser;
      reportProgress(`Preparing capture environment...`);

      const extraHeaders = {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      };

      // Only add Referer and Origin if NOT YouTube/Google (to prevent GFE block / HTTP 431 / bot flags)
      const isYoutubeTarget = pageUrl.toLowerCase().includes('youtube.com/') || pageUrl.toLowerCase().includes('youtu.be/');
      if (!isYoutubeTarget) {
        extraHeaders['Referer'] = customReferer || pageUrl;
        try {
          extraHeaders['Origin'] = new URL(customReferer || pageUrl).origin;
        } catch { }
      }

      const context = await browser.newContext({
        userAgent: DESKTOP_USER_AGENT,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: ['geolocation'],
        ignoreHTTPSErrors: true,
        bypassCSP: true,
        extraHTTPHeaders: extraHeaders
      });

      // Set default navigation timeout for all operations
      context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
      context.setDefaultTimeout(30_000);


      /* ═══════════════════════════════════════════════════════════
       *  Pre-emptive Cookie Injection (before page load)
       *  This silently bypasses age gates on many sites.
       *  Major sites are excluded to prevent cookie pollution & blocks.
       * ═══════════════════════════════════════════════════════════ */
      try {
        const targetUrl = new URL(pageUrl);
        const domain = targetUrl.hostname;
        // Also prepare for common CDN/media subdomains
        const baseDomain = domain.split('.').slice(-2).join('.');

        const isMajorSite = /^(?:www\.)?(?:youtube\.com|youtu\.be|google\.com|gmail\.com|netflix\.com|amazon\.com|facebook\.com|twitter\.com|instagram\.com)$/i.test(domain);

        if (domain.includes('gofile.io') || isMajorSite) {
          console.log(`[PLAYWRIGHT][COOKIES] Skipping bypass cookie injection for ${domain} to prevent conflicts`);
        } else {
          const cookiesToSet = BYPASS_COOKIES.map(c => ({
            name: c.name,
            value: c.value,
            domain: domain,
            path: '/',
            httpOnly: false,
            secure: targetUrl.protocol === 'https:',
            sameSite: 'Lax'
          }));

          // Also set for the base domain (covers subdomains)
          if (baseDomain !== domain) {
            BYPASS_COOKIES.forEach(c => {
              cookiesToSet.push({
                name: c.name,
                value: c.value,
                domain: '.' + baseDomain,
                path: '/',
                httpOnly: false,
                secure: targetUrl.protocol === 'https:',
                sameSite: 'Lax'
              });
            });
          }

          await context.addCookies(cookiesToSet);
          console.log(`[PLAYWRIGHT][COOKIES] Injected ${cookiesToSet.length} bypass cookies for ${domain}`);
        }
      } catch (e) {
        console.log('[PLAYWRIGHT][COOKIES] Failed to inject bypass cookies:', e.message);
      }

      const page = await context.newPage();

      // Inject cosmetic CSS only to avoid double-routing conflicts in Playwright page.
      // The network-level ad blocking is already handled inside the page.route handler
      // below via adBlockManager.shouldBlockForCapture().
      if (adBlockManager?.initialized) {
        try {
          // Inject cosmetic CSS to nuke ad overlays that survive network blocking
          await page.addStyleTag({
            content: `
            [id*="ad-overlay"],[id*="adOverlay"],[class*="ad-overlay"],
            [id*="popup-ad"],[class*="popup-ad"],
            [data-ad],[data-ads],[data-advertisement],
            .jw-ad-container,.jw-ima-container,
            .fp-ad,.fp-ima,
            .vjs-ad-container,.vjs-ima-container,
            div[style*="z-index: 999"],div[style*="z-index:999"],
            div[style*="position: fixed"][style*="top: 0"][style*="left: 0"]
            { display:none!important; visibility:hidden!important; pointer-events:none!important; }
          ` }).catch(() => { });
          console.log('[PLAYWRIGHT] AdBlock cosmetic CSS injected successfully');
        } catch (e) {
          console.warn('[PLAYWRIGHT] AdBlock cosmetic CSS injection skipped:', e.message);
        }
      }

      /* ── Anti-detection & in-page interceptors ─────────────── */
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

        window.open = () => {
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

        // Hook Shaka Player / video player APIs to extract DRM ClearKeys and stream URLs
        // Instead of just hooking window.player, hook the shaka prototype directly
        // so we catch it even if they don't assign the player to window.player.
        let _shakaHooked = false;
        Object.defineProperty(window, 'shaka', {
          get: () => window._shaka,
          set: (val) => {
            window._shaka = val;
            if (val && val.Player && val.Player.prototype && !_shakaHooked) {
              _shakaHooked = true;

              const origConfigure = val.Player.prototype.configure;
              val.Player.prototype.configure = function (configOrPath, optionalValue) {
                console.log('[PLAYWRIGHT] shaka.Player.configure called:', typeof configOrPath === 'string' ? configOrPath : JSON.stringify(Object.keys(configOrPath || {})));
                // Handle object-style: configure({ drm: { clearKeys: {...} } })
                if (configOrPath && typeof configOrPath === 'object') {
                  if (configOrPath.drm && configOrPath.drm.clearKeys && Object.keys(configOrPath.drm.clearKeys).length > 0) {
                    window.__aetherDrmKeys = configOrPath.drm.clearKeys;
                    console.log('[PLAYWRIGHT] Intercepted DRM ClearKeys via configure({drm}):', JSON.stringify(configOrPath.drm.clearKeys));
                  }
                }
                // Handle path-style: configure('drm.clearKeys', { kid: key })
                if (typeof configOrPath === 'string' && optionalValue) {
                  if (configOrPath === 'drm.clearKeys' || configOrPath === 'drm') {
                    const keys = configOrPath === 'drm' && optionalValue.clearKeys ? optionalValue.clearKeys : optionalValue;
                    if (keys && typeof keys === 'object' && Object.keys(keys).length > 0) {
                      window.__aetherDrmKeys = keys;
                      console.log('[PLAYWRIGHT] Intercepted DRM ClearKeys via configure(path):', JSON.stringify(keys));
                    }
                  }
                }
                return origConfigure.apply(this, arguments);
              };

              const origLoad = val.Player.prototype.load;
              val.Player.prototype.load = function (manifestUri) {
                if (manifestUri && typeof manifestUri === 'string' && manifestUri.startsWith('http')) {
                  console.log('[PLAYWRIGHT] Intercepted player.load() URL via prototype:', manifestUri);
                  if (!window.__capturedMediaUrls) window.__capturedMediaUrls = [];
                  window.__capturedMediaUrls.push(manifestUri);
                }
                return origLoad.apply(this, arguments);
              };
            }
          },
          configurable: true
        });

        // Keep the old window.player hook as a fallback for non-shaka players
        let _player = null;
        Object.defineProperty(window, 'player', {
          get: () => _player,
          set: (val) => {
            _player = val;
            if (val && typeof val === 'object') {
              if (typeof val.configure === 'function' && !val.configure.__hooked) {
                const origConfigure = val.configure;
                val.configure = function (config) {
                  if (config && config.drm && config.drm.clearKeys) {
                    window.__aetherDrmKeys = config.drm.clearKeys;
                    console.log('[PLAYWRIGHT] Intercepted DRM ClearKeys via window.player:', JSON.stringify(config.drm.clearKeys));
                  }
                  return origConfigure.apply(this, arguments);
                };
                val.configure.__hooked = true;
              }
              if (typeof val.load === 'function' && !val.load.__hooked) {
                const origLoad = val.load;
                val.load = function (manifestUri) {
                  if (manifestUri && typeof manifestUri === 'string' && manifestUri.startsWith('http')) {
                    console.log('[PLAYWRIGHT] Intercepted player.load() URL via window.player:', manifestUri);
                    if (!window.__capturedMediaUrls) window.__capturedMediaUrls = [];
                    window.__capturedMediaUrls.push(manifestUri);
                  }
                  return origLoad.apply(this, arguments);
                };
                val.load.__hooked = true;
              }
            }
          },
          configurable: true
        });

        // Universal EME Hook: Intercept MediaKeySession.prototype.update
        // This is the lowest-level browser API where the player MUST pass the decrypted 
        // license (ClearKeys) to the CDM. No matter what player is used (Shaka, Video.js, Custom),
        // the keys will pass through here in a standard JSON format.
        if (window.MediaKeySession && window.MediaKeySession.prototype && window.MediaKeySession.prototype.update) {
          const origUpdate = window.MediaKeySession.prototype.update;
          window.MediaKeySession.prototype.update = function (response) {
            console.log('[PLAYWRIGHT] MediaKeySession.update called!');
            try {
              if (response instanceof Uint8Array || response instanceof ArrayBuffer) {
                const str = new TextDecoder().decode(response);
                console.log('[PLAYWRIGHT] MediaKeySession.update payload string:', str);
                const json = JSON.parse(str);
                if (json && Array.isArray(json.keys)) {
                  // This is a standard ClearKey license payload
                  const keysObj = {};
                  json.keys.forEach(k => {
                    if (k.kid && k.k) {
                      // dash.js requires base64url keys natively, so we just capture them as-is
                      // or we convert back to hex to maintain consistency with our pipeline.
                      // Let's capture the raw base64url or hex
                      const kid = k.kid;
                      const key = k.k;
                      keysObj[kid] = key;
                    }
                  });
                  if (Object.keys(keysObj).length > 0) {
                    window.__aetherDrmKeys = keysObj;
                    console.log('[PLAYWRIGHT] Intercepted DRM ClearKeys via MediaKeySession EME Hook:', JSON.stringify(keysObj));
                  }
                }
              }
            } catch (e) {
              // Not a JSON ClearKey payload (could be Widevine binary data), ignore.
            }
            return origUpdate.apply(this, arguments);
          };
        }

        // Hook fetch() to scan API responses for ClearKey DRM configuration
        const origFetch = window.fetch;
        window.fetch = function() {
          return origFetch.apply(this, arguments).then(response => {
            if (window.__aetherDrmKeys) return response; // Already found
            const ct = (response.headers.get('content-type') || '').toLowerCase();
            if ((ct.includes('json') || ct.includes('javascript') || ct.includes('text/html')) && response.ok) {
              const cloned = response.clone();
              cloned.text().then(body => {
                if (!body || window.__aetherDrmKeys) return;
                // Pattern 1: clearKeys: { 'hexKid': 'hexKey' }
                const ckMatch = body.match(/clearKeys\s*:\s*\{([^}]+)\}/i);
                if (ckMatch) {
                  const inner = ckMatch[1];
                  const pairs = {};
                  const pairRe = /['"]([0-9a-fA-F]{16,64})['\"]\s*:\s*['"]([0-9a-fA-F]{16,64})['"]/g;
                  let m;
                  while ((m = pairRe.exec(inner)) !== null) {
                    pairs[m[1]] = m[2];
                  }
                  if (Object.keys(pairs).length > 0) {
                    window.__aetherDrmKeys = pairs;
                    console.log('[PLAYWRIGHT][FETCH-DRM] Extracted ClearKeys from fetch response:', JSON.stringify(pairs));
                  }
                }
                // Pattern 2: "kid":"hexValue","key":"hexValue" in JSON
                if (!window.__aetherDrmKeys) {
                  const kidKeyMatch = body.match(/"kid"\s*:\s*"([0-9a-fA-F]{16,64})"\s*,\s*"key"\s*:\s*"([0-9a-fA-F]{16,64})"/i);
                  if (kidKeyMatch) {
                    window.__aetherDrmKeys = { [kidKeyMatch[1]]: kidKeyMatch[2] };
                    console.log('[PLAYWRIGHT][FETCH-DRM] Extracted kid/key from JSON:', JSON.stringify(window.__aetherDrmKeys));
                  }
                }
                // Pattern 3: "keys":[{"kid":"...","k":"..."}] (JWK format in responses)
                if (!window.__aetherDrmKeys) {
                  try {
                    const json = JSON.parse(body);
                    const findKeys = (obj) => {
                      if (!obj || typeof obj !== 'object') return;
                      if (Array.isArray(obj.keys)) {
                        const keysObj = {};
                        obj.keys.forEach(k => {
                          if (k.kid && k.k) keysObj[k.kid] = k.k;
                        });
                        if (Object.keys(keysObj).length > 0) {
                          window.__aetherDrmKeys = keysObj;
                          console.log('[PLAYWRIGHT][FETCH-DRM] Extracted JWK keys from JSON response:', JSON.stringify(keysObj));
                        }
                      }
                      // Recurse into nested objects
                      for (const v of Object.values(obj)) {
                        if (typeof v === 'object' && v !== null) findKeys(v);
                        if (window.__aetherDrmKeys) return;
                      }
                    };
                    findKeys(json);
                  } catch (e) { /* not JSON */ }
                }
              }).catch(() => {});
            }
            return response;
          });
        };

        // Hook XMLHttpRequest to scan responses for ClearKey patterns
        const origXHROpen = XMLHttpRequest.prototype.open;
        const origXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function() {
          this.__aetherUrl = arguments[1];
          return origXHROpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          this.addEventListener('load', function() {
            if (window.__aetherDrmKeys) return;
            try {
              const ct = (this.getResponseHeader('content-type') || '').toLowerCase();
              if (ct.includes('json') || ct.includes('javascript') || ct.includes('text/html')) {
                const body = this.responseText;
                if (!body) return;
                const ckMatch = body.match(/clearKeys\s*:\s*\{([^}]+)\}/i);
                if (ckMatch) {
                  const inner = ckMatch[1];
                  const pairs = {};
                  const pairRe = /['"]([0-9a-fA-F]{16,64})['"]\s*:\s*['"]([0-9a-fA-F]{16,64})['"]/g;
                  let m;
                  while ((m = pairRe.exec(inner)) !== null) {
                    pairs[m[1]] = m[2];
                  }
                  if (Object.keys(pairs).length > 0) {
                    window.__aetherDrmKeys = pairs;
                    console.log('[PLAYWRIGHT][XHR-DRM] Extracted ClearKeys from XHR:', JSON.stringify(pairs));
                  }
                }
              }
            } catch (e) {}
          });
          return origXHRSend.apply(this, arguments);
        };

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
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        delete window.chrome;

        /* ── Block Service Workers ── */
        try {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
              for (let r of regs) r.unregister();
            });
            navigator.serviceWorker.register = () => new Promise(() => { });
          }
        } catch { }

        /* ═══ In-page media URL interceptors ═══ */
        window.__capturedMediaUrls = [];
        window.__interceptedMediaFetches = [];

        const mediaExtPattern = /\.(m3u8|mpd|mp4|webm|mkv|mov|avi|m4v|flv|wmv|ts|f4v|ogv)(?:\/)?(?:\?|#|$)/i;
        const cdnHostPattern = /(?:^|\.)(?:cache|cdn|media|video|stream|vod|play|content|assets|storage|userstorage|gfs|dl|download|files?|sv|node|edge|origin|proxy|deliver)[a-z0-9\-_]*\./i;
        const mediaServePattern = /\/(?:v|video|stream|play|watch|embed|media|file|get|dl|download|serve|content|view)\/[a-zA-Z0-9\-_\\.]{4,}/i;
        // Exclude analytics hostnames inside the page interceptor too
        const analyticsHostPattern = /(?:debugbear|newrelic|datadoghq|datadog|sentry|bugsnag|logrocket|fullstory|hotjar|clarity|heap|mixpanel|amplitude|segment|rudderstack)\./i;

        const isLikelyMedia = (url) => {
          if (!url || typeof url !== 'string') return false;
          const lower = url.toLowerCase();
          if (lower.startsWith('blob:') || lower.startsWith('data:')) return false;
          if (mediaExtPattern.test(lower)) return true;
          try {
            const u = new URL(url);
            if (analyticsHostPattern.test(u.hostname)) return false;
            // High confidence pattern: known CDN + media path
            if (cdnHostPattern.test(u.hostname) && mediaServePattern.test(u.pathname)) return true;
            // Also check for 'view/download' in path on CDN
            if (cdnHostPattern.test(u.hostname) && /\/(?:v|view|download)\//i.test(u.pathname)) return true;
          } catch { }
          return false;
        };

        /* ── Worker Detection ── */
        const OrigWorker = window.Worker;
        window.Worker = function (scriptURL, options) {
          console.log('[PLAYWRIGHT][PAGE] Worker created:', scriptURL);
          return new OrigWorker(scriptURL, options);
        };
        const OrigSharedWorker = window.SharedWorker;
        window.SharedWorker = function (scriptURL, options) {
          console.log('[PLAYWRIGHT][PAGE] SharedWorker created:', scriptURL);
          return new OrigSharedWorker(scriptURL, options);
        };

        /* ── MutationObserver: catch dynamically added video elements ── */
        const capturedSet = new Set();
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue;
              const checkElement = (el) => {
                if (!el || !el.tagName) return;
                const tag = el.tagName.toUpperCase();
                if (tag === 'VIDEO' || tag === 'SOURCE' || tag === 'AUDIO') {
                  const src = el.src || el.currentSrc || el.getAttribute('data-src');
                  if (src && !src.startsWith('blob:') && !src.startsWith('data:') && !capturedSet.has(src)) {
                    capturedSet.add(src);
                    window.__capturedMediaUrls.push(src);
                  }
                }
              };
              checkElement(node);
              if (node.querySelectorAll) {
                node.querySelectorAll('video, source, audio').forEach(checkElement);
              }
            }
            if (mutation.type === 'attributes' && mutation.target) {
              const el = mutation.target;
              const tag = el.tagName?.toUpperCase();
              if (tag === 'VIDEO' || tag === 'SOURCE') {
                const src = el.src || el.currentSrc;
                if (src && !src.startsWith('blob:') && !src.startsWith('data:') && !capturedSet.has(src)) {
                  capturedSet.add(src);
                  window.__capturedMediaUrls.push(src);
                }
              }
            }
          }
        });
        if (document.documentElement) {
          observer.observe(document.documentElement, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['src', 'data-src']
          });
        }

        /* ── Fetch interception ── */
        const originalFetch = window.fetch;
        window.fetch = function (...args) {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
          if (url && !url.includes('google-analytics') && !url.includes('doubleclick')) {
            console.log('[PLAYWRIGHT][PAGE-FETCH]', url);
          }
          try {
            if (url && isLikelyMedia(url) && !capturedSet.has(url)) {
              capturedSet.add(url);
              window.__interceptedMediaFetches.push(url);
            }
          } catch { }
          return originalFetch.apply(this, args);
        };

        /* ── XHR interception ── */
        const originalXHROpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
          const urlStr = String(url);
          if (urlStr && !urlStr.includes('google-analytics')) {
            console.log('[PLAYWRIGHT][PAGE-XHR]', urlStr);
          }
          try {
            if (isLikelyMedia(urlStr) && !capturedSet.has(urlStr)) {
              capturedSet.add(urlStr);
              window.__interceptedMediaFetches.push(urlStr);
            }
          } catch { }
          return originalXHROpen.apply(this, [method, url, ...rest]);
        };

        /* ── HTMLMediaElement.src / load() interception ── */
        try {
          const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
          if (originalSrcDescriptor && originalSrcDescriptor.set) {
            Object.defineProperty(HTMLMediaElement.prototype, 'src', {
              set(value) {
                try {
                  if (value && typeof value === 'string' && value.startsWith('http') && !capturedSet.has(value)) {
                    capturedSet.add(value);
                    window.__capturedMediaUrls.push(value);
                  }
                } catch { }
                return originalSrcDescriptor.set.call(this, value);
              },
              get: originalSrcDescriptor.get,
              configurable: true
            });
          }

          const originalLoad = HTMLMediaElement.prototype.load;
          HTMLMediaElement.prototype.load = function () {
            try {
              const src = this.src || this.currentSrc || this.getAttribute('src');
              if (src && typeof src === 'string' && src.startsWith('http') && !capturedSet.has(src)) {
                capturedSet.add(src);
                window.__capturedMediaUrls.push(src);
              }
            } catch { }
            return originalLoad.call(this);
          };
        } catch { }

        /* ── JWPlayer setup() interception ── */
        /* Sites like pooembed.eu use WASM to decrypt stream URLs and pass
         * them to jwplayer().setup({ file: '...' }). We intercept setup()
         * calls to capture the file URL before JWPlayer processes it. */
        window.__jwSetupCapturedUrls = [];
        window.__isLiveDetected = false;
        const tryInterceptJwplayer = () => {
          try {
            if (typeof jwplayer !== 'function') return false;
            const origJwplayer = jwplayer;
            const proxyJwplayer = function (...args) {
              const instance = origJwplayer.apply(this, args);
              if (instance && instance.setup && !instance.__setupIntercepted) {
                const origSetup = instance.setup.bind(instance);
                instance.setup = function (config) {
                  try {
                    if (config) {
                      if (config.live === true || config.isLive === true) {
                        window.__isLiveDetected = true;
                      }
                      // Extract file URL from setup config
                      const fileUrl = config.file || config.src || config.source;
                      if (fileUrl && typeof fileUrl === 'string' && fileUrl.startsWith('http') && !capturedSet.has(fileUrl)) {
                        capturedSet.add(fileUrl);
                        window.__capturedMediaUrls.push(fileUrl);
                        window.__jwSetupCapturedUrls.push(fileUrl);
                      }
                      // Also check sources array
                      const sources = config.sources || config.playlist;
                      if (Array.isArray(sources)) {
                        sources.forEach(s => {
                          const u = typeof s === 'string' ? s : (s?.file || s?.src);
                          if (u && typeof u === 'string' && u.startsWith('http') && !capturedSet.has(u)) {
                            capturedSet.add(u);
                            window.__capturedMediaUrls.push(u);
                            window.__jwSetupCapturedUrls.push(u);
                          }
                          // Nested sources within playlist items
                          if (s?.sources && Array.isArray(s.sources)) {
                            s.sources.forEach(ss => {
                              const uu = typeof ss === 'string' ? ss : (ss?.file || ss?.src);
                              if (uu && typeof uu === 'string' && uu.startsWith('http') && !capturedSet.has(uu)) {
                                capturedSet.add(uu);
                                window.__capturedMediaUrls.push(uu);
                                window.__jwSetupCapturedUrls.push(uu);
                              }
                            });
                          }
                        });
                      }
                    }
                  } catch (e) { }
                  return origSetup(config);
                };
                instance.__setupIntercepted = true;
              }
              return instance;
            };
            // Copy static properties (version, key, etc.)
            for (const key of Object.getOwnPropertyNames(origJwplayer)) {
              try { if (key !== 'length' && key !== 'name' && key !== 'prototype') proxyJwplayer[key] = origJwplayer[key]; } catch (e) { }
            }
            try { window.jwplayer = proxyJwplayer; } catch (e) { }
            return true;
          } catch (e) { return false; }
        };
        // Try immediately and then periodically (WASM may define jwplayer late)
        if (!tryInterceptJwplayer()) {
          let jwCheckCount = 0;
          const jwCheckInterval = setInterval(() => {
            if (tryInterceptJwplayer() || ++jwCheckCount > 100) clearInterval(jwCheckInterval);
          }, 200);
        }
      });

      /* ── Route handler ──────────────────────────── */
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();
        const resourceType = request.resourceType();
        const requestHeaders = request.headers();

        // 1. Block heavy resource types (skip for same-origin to prevent breakage)
        const isSameOrigin = extractHostname(url).endsWith(extractHostname(pageUrl));
        if (BLOCKED_RESOURCE_TYPES.has(resourceType) && !isSameOrigin) {
          return route.abort().catch(() => { });
        }

        // 2. Provider-specific interception (generic hook)
        const providerHandled = await providerRegistry?.runRouteInterceptors?.({
          pageUrl, route, request, page,
          capturedUrls, capturedSubtitles,
          state: providerState, parsePotentialJsonOutput
        });
        if (providerHandled?.handled) return;

        // 3. Block ads / tracking (context-aware — respects same-origin, player scripts, bot-detection)
        // The adBlockManager.shouldBlockForCapture() method uses the comprehensive
        // Ghostery engine + custom allowlists. Falls back to nuclear domain check.
        if (adBlockManager?.shouldBlockForCapture?.(url, pageUrl, resourceType)) {
          console.log(`[AdBlock][ENGINE] Blocked: ${url.substring(0, 120)}`);
          return route.abort().catch(() => { });
        }
        if (isNuclearBlockedDomain(extractHostname(url))) {
          console.log(`[AdBlock][NUCLEAR] Blocked: ${url.substring(0, 120)}`);
          return route.abort().catch(() => { });
        }
        if (url.includes('disable-devtool')) {
          console.log(`[AdBlock][CUSTOM] Blocked disable-devtool: ${url.substring(0, 120)}`);
          return route.abort().catch(() => { });
        }

        // 4. Capture subtitles
        if (RE_SUBTITLE_EXT.test(url) && !isLikelyThumbnailUrl(url)) {
          const eligible = ['fetch', 'xhr', 'other', 'media'].includes(resourceType);
          if (eligible) {
            const language = extractLanguageFromUrl(url);
            console.log(`[SUBTITLE] Captured: ${url} (lang: ${language || 'unknown'})`);
            capturedSubtitles.set(url, buildCapturedSubtitleDescriptor({
              url, language, label: null, kind: 'subtitles'
            }));
          }
        }

        // 5. Capture media URLs (ENHANCED with validation)
        const isMedia = isMediaUrl(url);
        const isMediaResource = resourceType === 'media';

        if ((isMedia || isMediaResource) && !capturedUrls.has(url)) {
          // NEW: Run acceptance check
          if (shouldAcceptCapturedUrl(url, 'route')) {
            console.log(`[PLAYWRIGHT][CAPTURE] ${url} (type=${resourceType}${isMediaResource ? ' [browser-media]' : ''})`);
            addCapturedUrl(url);
            rememberRequestHeaders(url, requestHeaders);
            if (isMediaResource) {
              setUrlContext(url, { confirmedByContentType: true, observedAsCurrentPlayback: true, fromMediaResource: true });
            } else {
              setUrlContext(url, { fromMediaResource: false });
            }
            onMediaCaptured(url, urlContext.get(url));
          }
        } else if ((isMedia || isMediaResource) && capturedUrls.has(url)) {
          rememberRequestHeaders(url, requestHeaders);
        }

        return route.continue().catch(() => { });
      });

      /* ── Response listener (ENHANCED) ──────────────────────── */
      page.on('console', msg => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          console.log(`[PLAYWRIGHT][PAGE-LOG] ${msg.type()}: ${msg.text()}`);
        }
      });

      page.on('response', async (response) => {
        try {
          const url = response.url();
          const status = response.status();
          const headers = response.headers();
          const contentType = headers['content-type'] || '';
          const contentLength = parseInt(headers['content-length'] || '0', 10);
          const resourceType = response.request().resourceType();

          // Media Heuristic Check (context-aware — passes pageUrl for same-site detection)
          if (contentType.startsWith('video/') || resourceType === 'media') {
            if (adBlockManager?.isPotentialAdMedia({ url, contentType, contentLength, pageUrl })) {
              console.log(`[AdBlock][HEURISTIC] Flagged potential ad-media: ${url} (${contentLength} bytes)`);
              setUrlContext(url, { isAd: true });
              return;
            }
          }
          const location = headers['location'];
          if (location) {
            const resolvedUrl = new URL(location, url).toString();
            if (isMediaUrl(resolvedUrl) && shouldAcceptCapturedUrl(resolvedUrl, 'redirect') && addCapturedUrl(resolvedUrl)) {
              console.log(`[PLAYWRIGHT][REDIRECT] ${resolvedUrl}`);
              onMediaCaptured(resolvedUrl);
            }
          }

          // ── ClearKey DRM extraction from HTML responses (iframe pages) ──
          // The iframe content can't be accessed via page.frames() in some cases,
          // but its HTML response IS captured here. Scan for clearKeys patterns.
          if (!globalCapturedDrmKeys && status >= 200 && status < 400) {
            const ctLower = (contentType || '').toLowerCase();
            if ((ctLower.includes('text/html') || ctLower.includes('json') || ctLower.includes('javascript')) && contentLength < 500000) {
              try {
                const body = await Promise.race([
                  response.text(),
                  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
                ]).catch(() => '');
                if (body && /clearKeys/i.test(body)) {
                  const ckMatch = body.match(/clearKeys\s*:\s*\{([^}]+)\}/i);
                  if (ckMatch) {
                    const inner = ckMatch[1];
                    const pairs = {};
                    const pairRe = /['"]([0-9a-fA-F]{16,64})['"]\s*:\s*['"]([0-9a-fA-F]{16,64})['"]/g;
                    let m;
                    while ((m = pairRe.exec(inner)) !== null) {
                      pairs[m[1]] = m[2];
                    }
                    if (Object.keys(pairs).length > 0) {
                      globalCapturedDrmKeys = pairs;
                      console.log('[PLAYWRIGHT][HTML-DRM] Extracted ClearKeys from HTML response:', url.substring(0, 80));
                      console.log('[PLAYWRIGHT][HTML-DRM] Keys:', JSON.stringify(pairs));
                    }
                  }
                }
              } catch (e) {
                // Non-fatal: body read failed
              }
            }
          }

          if (status < 200 || status >= 400) return;

          const ct = (headers['content-type'] || '').toLowerCase();
          const hostname = extractHostname(url);

          // NEW: Track content-length for all captured URLs
          if (contentLength > 0 && capturedUrls.has(url)) {
            setUrlContext(url, { contentLength });
          }

          // ─ A: Content-type based detection ─
          const isMediaCT = RE_MEDIA_CONTENT_TYPE.test(ct) && !(ct.includes('octet-stream') && !isMediaUrl(url));
          if (isMediaCT && !RE_BLANK_MP4.test(url) && shouldAcceptCapturedUrl(url, 'content-type') && addCapturedUrl(url)) {
            console.log(`[PLAYWRIGHT][CT-SNIFF] ${url} (${ct}, ${contentLength} bytes)`);
            setUrlContext(url, { confirmedByContentType: true, contentLength });
            onMediaCaptured(url, urlContext.get(url));
          }

          // ─ B: Content-Disposition based detection ─
          const disposition = headers['content-disposition'] || '';
          if (disposition && RE_MEDIA_DISPOSITION.test(disposition) && shouldAcceptCapturedUrl(url, 'disposition') && addCapturedUrl(url)) {
            console.log(`[PLAYWRIGHT][DISPOSITION] ${url} (${disposition})`);
            setUrlContext(url, { confirmedByContentType: true, contentLength });
            onMediaCaptured(url, urlContext.get(url));
          }

          // ─ C: Large response from CDN hostname ─
          if (
            contentLength > 1_000_000 &&
            isCdnHostname(hostname) &&
            !RE_STATIC_ASSET.test(url) &&
            !isLikelyAdUrl(url) &&
            !isLikelyPreviewMedia(url) &&
            (ct.includes('octet-stream') || ct.includes('video') || ct === '' || !ct) &&
            addCapturedUrl(url)
          ) {
            console.log(`[PLAYWRIGHT][LARGE-CDN] ${url} (${contentLength} bytes, ct=${ct || 'none'})`);
            setUrlContext(url, { confirmedByContentType: !!ct.includes('video'), contentLength });
            onMediaCaptured(url, urlContext.get(url));
          }

          // ─ D: Accept-Ranges + large response ─
          if (
            headers['accept-ranges'] === 'bytes' &&
            contentLength > 5_000_000 &&
            !RE_STATIC_ASSET.test(url) &&
            !isLikelyAdUrl(url) &&
            !isLikelyPreviewMedia(url) &&
            addCapturedUrl(url)
          ) {
            console.log(`[PLAYWRIGHT][RANGE-STREAM] ${url} (${contentLength} bytes)`);
            setUrlContext(url, { contentLength });
            onMediaCaptured(url, urlContext.get(url));
          }

          // ─ E: Update content-length context for already-captured URLs ─
          if (contentLength > 0 && capturedUrls.has(url)) {
            setUrlContext(url, { contentLength });
          }

          // ─ E: Network Debugging (Fetch/XHR) ─
          const rt = response.request().resourceType();
          if ((rt === 'fetch' || rt === 'xhr') && !RE_STATIC_ASSET.test(url)) {
            console.log(`[PLAYWRIGHT][DEBUG] ${rt.toUpperCase()}: ${url.substring(0, 100)} (status=${status}, ct=${ct})`);
          }

          // ─ F: JSON mining ─
          if ((ct.includes('json') || ct.includes('ld+json')) && (rt === 'fetch' || rt === 'xhr')) {
            console.log(`[PLAYWRIGHT][DEBUG] Intercepted JSON response from: ${url.substring(0, 100)}`);
            const cl = parseInt(headers['content-length'] || '0', 10);
            if (cl > MAX_JSON_BODY) {
              console.log(`[PLAYWRIGHT][DEBUG] Skipping JSON: body too large (${cl} bytes)`);
              return;
            }
            const body = await Promise.race([
              response.text(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('body timeout')), RESPONSE_BODY_TIMEOUT_MS))
            ]).catch(() => '');
            if (!body || body.length > MAX_JSON_BODY) return;

            // Pattern 1: URLs with media extensions
            const urlPattern = /https?:[\\\/]+[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts|m4s|mp4a|mp4v)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
            const matches = body.match(urlPattern);
            if (matches) {
              for (const raw of matches) {
                const cleaned = cleanExtractedUrl(raw);
                if (cleaned && shouldAcceptCapturedUrl(cleaned, 'json-mine') && addCapturedUrl(cleaned)) {
                  console.log(`[PLAYWRIGHT][JSON-MINE] ${cleaned}`);
                  onMediaCaptured(cleaned);
                }
              }
            }

            // Pattern 2: DASH objects (Deep Scanning)
            try {
              const jsonData = JSON.parse(body);
              const scanJson = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > 8) return;

                // Look for DASH structures (Bilibili, etc.)
                if (obj.dash && typeof obj.dash === 'object') {
                  const d = obj.dash;
                  const streamUrls = [];
                  if (Array.isArray(d.video)) d.video.forEach(v => { if (v.base_url || v.baseUrl) streamUrls.push(v.base_url || v.baseUrl); });
                  if (Array.isArray(d.audio)) d.audio.forEach(a => { if (a.base_url || a.baseUrl) streamUrls.push(a.base_url || a.baseUrl); });

                  for (const su of streamUrls) {
                    if (addCapturedUrl(su)) {
                      console.log(`[PLAYWRIGHT][JSON-DASH] ${su}`);
                      onMediaCaptured(su, { source: 'json-dash-scan' });
                    }
                  }
                }

                // Recursive scan
                for (const k in obj) {
                  if (Object.prototype.hasOwnProperty.call(obj, k)) scanJson(obj[k], depth + 1);
                }
              };
              scanJson(jsonData);
            } catch (e) {
              // Not a valid JSON or failed to parse
            }
            // Pattern 2b: Relative media paths in JSON (NEW)
            const relativeMediaPattern = /\/[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts|m4s|mp4a|mp4v)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
            const relMatches = body.match(relativeMediaPattern);
            if (relMatches) {
              for (const raw of relMatches) {
                try {
                  const resolved = new URL(raw, pageUrl).toString();
                  if (shouldAcceptCapturedUrl(resolved, 'json-relative-mine') && addCapturedUrl(resolved)) {
                    console.log(`[PLAYWRIGHT][JSON-REL-MINE] ${resolved}`);
                    onMediaCaptured(resolved);
                  }
                } catch { }
              }
            }
            // Pattern 2c: Extensionless CDN URLs in JSON
            const cdnPattern = /https?:[\\\/]+(?:cache|cdn|media|video|stream|files?|sv|node|edge)\d*\.[^\s"'<>\]}{]{20,}/gi;
            const cdnMatches = body.match(cdnPattern);
            if (cdnMatches) {
              for (const raw of cdnMatches) {
                const cleaned = cleanExtractedUrl(raw);
                if (cleaned && shouldAcceptCapturedUrl(cleaned, 'json-cdn-mine') && addCapturedUrl(cleaned)) {
                  console.log(`[PLAYWRIGHT][JSON-CDN-MINE] ${cleaned}`);
                  setUrlContext(cleaned, { fromCdnJsonMine: true });
                  onMediaCaptured(cleaned);
                }
              }
            }

            // Pattern 3: Parsed JSON field mining
            try {
              const json = JSON.parse(body);
              const mineObject = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > 5) return;
                if (Array.isArray(obj)) { obj.forEach(item => mineObject(item, depth + 1)); return; }
                // EXPANDED mediaKeys: covers primary, alternative/HD/SD variant keys,
                // sequentially-numbered fallback URLs, and common white-label field names.
                const mediaKeys = [
                  // Primary / universal
                  'url', 'src', 'source', 'file', 'stream', 'path', 'link',
                  'hls', 'dash', 'mp4', 'webm', 'ogv',
                  // video_* / videoX snake_case + camelCase
                  'video_url', 'videoUrl', 'video_src', 'videoSrc',
                  'video_file', 'videoFile', 'video_link', 'videoLink',
                  'video_path', 'videoPath', 'video_stream', 'videoStream',
                  // stream_* / streamX
                  'stream_url', 'streamUrl', 'stream_src', 'streamSrc',
                  'stream_file', 'streamFile', 'stream_link', 'streamLink',
                  // playback_* / playbackX
                  'playback_url', 'playbackUrl', 'playback_src', 'playbackSrc',
                  // media_* / mediaX
                  'media_url', 'mediaUrl', 'media_src', 'mediaSrc',
                  'media_file', 'mediaFile', 'media_link', 'mediaLink',
                  // download_* / downloadX
                  'download_url', 'downloadUrl', 'download_src', 'downloadSrc',
                  'download_link', 'downloadLink',
                  // view_* / viewX
                  'view_url', 'viewUrl', 'view_src', 'viewSrc', 'view_link', 'viewLink',
                  // content_* / contentX
                  'content_url', 'contentUrl', 'content_src', 'contentSrc',
                  // manifest_* / manifestX
                  'manifest_url', 'manifestUrl', 'manifest_src', 'manifestSrc',
                  // hls_* / hlsX
                  'hls_url', 'hlsUrl', 'hls_src', 'hlsSrc', 'hls_link', 'hlsLink',
                  // dash_* / dashX
                  'dash_url', 'dashUrl', 'dash_src', 'dashSrc',
                  // progressive / direct
                  'progressive_url', 'progressiveUrl', 'direct_url', 'directUrl',
                  // Alternative / HD / SD variant keys (multi-quality patterns)
                  'url_alt', 'urlAlt', 'alt_url', 'altUrl',
                  'video_alt_url', 'videoAltUrl', 'alt_video_url', 'altVideoUrl',
                  'video_alt_src', 'videoAltSrc', 'alt_video_src', 'altVideoSrc',
                  'url_hd', 'urlHd', 'hd_url', 'hdUrl', 'hd_src', 'hdSrc',
                  'url_sd', 'urlSd', 'sd_url', 'sdUrl', 'sd_src', 'sdSrc',
                  'url_4k', 'url4k', 'url_2160p', 'url2160p',
                  'url_1080p', 'url1080p', 'url_720p', 'url720p',
                  'url_480p', 'url480p', 'url_360p', 'url360p', 'url_240p', 'url240p',
                  'src_hd', 'srcHd', 'src_sd', 'srcSd',
                  'src_1080p', 'src_720p', 'src_480p', 'src_360p',
                  // Sequentially numbered fallbacks (url1, url2, src1, src2, file1 …)
                  'url1', 'url2', 'url3', 'src1', 'src2', 'src3',
                  'file1', 'file2', 'file3', 'link1', 'link2', 'link3',
                  'alt_url1', 'alt_url2', 'alt_url3', 'altUrl1', 'altUrl2', 'altUrl3',
                  'video_alt_url1', 'video_alt_url2', 'video_alt_url3',
                  'videoAltUrl1', 'videoAltUrl2', 'videoAltUrl3',
                  'fallback_url1', 'fallback_url2', 'fallback_url3',
                  'backup_url1', 'backup_url2', 'backup_url3',
                  // Flash-era / white-label field names
                  'flashvars_url', 'flvUrl', 'flv_url', 'rtmpUrl', 'rtmp_url',
                  'fileUrl', 'file_url', 'videoURL', 'streamURL', 'mediaURL',
                  // Clip / episode / show fields
                  'clip_url', 'clipUrl', 'clip_src', 'clipSrc',
                  'episode_url', 'episodeUrl', 'show_url', 'showUrl',
                  // Raw / original / encoded variants
                  'raw_url', 'rawUrl', 'original_url', 'originalUrl',
                  'encoded_url', 'encodedUrl', 'transcoded_url', 'transcodedUrl',
                  // Fallback / backup / mirror
                  'fallback_url', 'fallbackUrl', 'backup_url', 'backupUrl',
                  'mirror_url', 'mirrorUrl', 'cdn_url', 'cdnUrl',
                ];
                for (const key of mediaKeys) {
                  const rawVal = obj[key];
                  if (typeof rawVal === 'string' && rawVal.length > 0) {
                    let val = rawVal;
                    // Auto-resolve relative paths found in API responses
                    if (val.startsWith('/')) {
                      try { val = new URL(val, pageUrl).toString(); } catch { }
                    }
                    if (val.startsWith('http') && !isLikelyAdUrl(val)) {
                      // Relax the isMediaUrl check for known keys, but keep CDN check as fallback
                      if (isMediaUrl(val) || isCdnHostname(extractHostname(val)) || /view|download/i.test(key)) {
                        console.log(`[PLAYWRIGHT][JSON-KEY:${key}] Found candidate: ${val}`);
                        if (addCapturedUrl(val)) {
                          const structuredContext = {
                            fromApiJson: true,
                            apiKey: key,
                            fromStructuredData: /contenturl|embedurl|sourceurl|videourl|streamurl|viewurl|downloadurl/i.test(String(key || '').replace(/_/g, ''))
                          };
                          setUrlContext(val, structuredContext);
                          onMediaCaptured(val, structuredContext);
                        }
                      }
                    }
                  }
                }

                // Generic suffix-based mining for numbered/variant media keys not listed explicitly
                for (const [rawKey, rawVal] of Object.entries(obj)) {
                  if (typeof rawVal !== 'string' || !rawVal.startsWith('http') || isLikelyAdUrl(rawVal)) continue;
                  const key = String(rawKey || '');
                  if (!/(?:^|[_-])(url|src|file|link|stream|video|media|source)(?:\d+)?$/i.test(key) &&
                    !/(?:alt|hd|sd|4k|2160p|1080p|720p|480p|360p|240p|fallback|backup|mirror)/i.test(key)) {
                    continue;
                  }
                  if ((isMediaUrl(rawVal) || isCdnHostname(extractHostname(rawVal))) && addCapturedUrl(rawVal)) {
                    console.log(`[PLAYWRIGHT][JSON-SUFFIX-KEY:${key}] ${rawVal}`);
                    onMediaCaptured(rawVal);
                  }
                }

                Object.values(obj).forEach(v => mineObject(v, depth + 1));
              };
              mineObject(json);
              if (ct.includes('ld+json')) {
                extractMediaUrlsFromJson(json, (capturedUrl, context = {}) => {
                  if (shouldAcceptCapturedUrl(capturedUrl, 'jsonld-response') && addCapturedUrl(capturedUrl)) {
                    console.log(`[PLAYWRIGHT][JSONLD-RESPONSE] ${capturedUrl}`);
                    if (context && Object.keys(context).length > 0) setUrlContext(capturedUrl, context);
                    onMediaCaptured(capturedUrl, context);
                  }
                });
              }
            } catch { }
          }

          // ─ G: HTML response mining ─
          if (
            (ct.includes('html') || ct.includes('xhtml')) &&
            (rt === 'fetch' || rt === 'xhr' || rt === 'document') &&
            url !== pageUrl
          ) {
            const cl = parseInt(headers['content-length'] || '0', 10);
            if (cl > MAX_HTML_BODY) return;
            const body = await Promise.race([
              response.text(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('body timeout')), RESPONSE_BODY_TIMEOUT_MS))
            ]).catch(() => '');
            if (!body || body.length > MAX_HTML_BODY) return;

            const htmlUrlPattern = /https?:[\\\/]+[^\s"'<>\]}{]+?\.(?:m3u8|mpd|mp4|webm|mkv)(?:\/)?(?:[^\s"'<>\]}{]*)/gi;
            const htmlMatches = body.match(htmlUrlPattern);
            if (htmlMatches) {
              for (const raw of htmlMatches) {
                const cleaned = cleanExtractedUrl(raw);
                if (cleaned && shouldAcceptCapturedUrl(cleaned, 'html-mine') && addCapturedUrl(cleaned)) {
                  console.log(`[PLAYWRIGHT][HTML-MINE] ${cleaned}`);
                  onMediaCaptured(cleaned);
                }
              }
            }

            const srcPattern = /(?:src|data-src|data-video-src)\s*=\s*["']([^"']+)/gi;
            let srcMatch;
            while ((srcMatch = srcPattern.exec(body)) !== null) {
              const src = srcMatch[1];
              if (src && src.startsWith('http') && !RE_BLOB_DATA.test(src)) {
                if ((isMediaUrl(src) || isCdnHostname(extractHostname(src))) &&
                  shouldAcceptCapturedUrl(src, 'html-src') && addCapturedUrl(src)) {
                  console.log(`[PLAYWRIGHT][HTML-SRC] ${src}`);
                  onMediaCaptured(src);
                }
              }
            }
          }
        } catch { }
      });

      /* ── Block popups ──────────────────────────────────────── */
      page.on('popup', async (popup) => {
        try {
          const popupUrl = popup.url();
          if (popupUrl && isMediaUrl(popupUrl) && shouldAcceptCapturedUrl(popupUrl, 'popup') && addCapturedUrl(popupUrl)) {
            console.log(`[PLAYWRIGHT][POPUP-MEDIA] ${popupUrl}`);
            onMediaCaptured(popupUrl);
          }
        } catch { }
        console.log('[PLAYWRIGHT] Popup blocked');
        await popup.close().catch(() => { });
      });

      /* ── Download listener ─────────────────────────────────── */
      page.on('download', async (download) => {
        try {
          const downloadUrl = download.url();
          if (downloadUrl && shouldAcceptCapturedUrl(downloadUrl, 'download') && addCapturedUrl(downloadUrl)) {
            console.log(`[PLAYWRIGHT][DOWNLOAD-EVENT] ${downloadUrl}`);
            setUrlContext(downloadUrl, { confirmedByContentType: true });
            onMediaCaptured(downloadUrl, urlContext.get(downloadUrl));
          }
        } catch { }
        await download.cancel().catch(() => { });
      });

      /* ── Navigate with retry logic ─────────────────────────── */
      let navSuccess = false;
      let navError = null;

      for (let attempt = 0; attempt <= NAV_RETRY_COUNT && !navSuccess; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[PLAYWRIGHT] Navigation retry ${attempt}/${NAV_RETRY_COUNT}...`);
            await new Promise(r => setTimeout(r, NAV_RETRY_DELAY_MS));
          }

          // First attempt: try 'domcontentloaded' for faster start
          // Retry attempts: use 'commit' which is even faster (page started loading)
          const waitUntil = attempt === 0 ? 'domcontentloaded' : 'commit';
          const timeout = attempt === 0 ? NAV_TIMEOUT_MS : Math.floor(NAV_TIMEOUT_MS * 0.7);

          reportProgress(`Connecting to source${attempt > 0 ? ` · Retry ${attempt}` : ''}...`);
          await page.goto(pageUrl, { waitUntil, timeout });
          navSuccess = true;
          console.log(`[PLAYWRIGHT] Navigation succeeded (attempt ${attempt + 1}, waitUntil=${waitUntil})`);
        } catch (err) {
          navError = err;
          console.log(`[PLAYWRIGHT] Navigation attempt ${attempt + 1} failed: ${err.message?.substring(0, 100)}`);

          // Check if page actually loaded despite the timeout
          try {
            const url = page.url();
            if (url && url !== 'about:blank' && url.includes(new URL(pageUrl).hostname)) {
              console.log(`[PLAYWRIGHT] Page partially loaded, continuing anyway...`);
              navSuccess = true;
            }
          } catch { }
        }
      }

      // If all attempts failed but page has some content, try to continue anyway
      if (!navSuccess) {
        try {
          const hasContent = await page.evaluate(() => {
            return document.body && document.body.innerHTML.length > 100;
          }).catch(() => false);

          if (hasContent) {
            console.log(`[PLAYWRIGHT] Page has content despite navigation errors, continuing...`);
            navSuccess = true;
          }
        } catch { }
      }

      if (!navSuccess) {
        throw navError || new Error('Navigation failed after all retries');
      }

      // Give the page a moment to stabilize after navigation
      await new Promise(r => setTimeout(r, 500));

      /* ── Universal State-Based Media Scanner ────────────────── */
      console.log('[PLAYWRIGHT][SCANNER] Scanning global state for structured media...');
      try {
        const structuredMedia = await page.evaluate(() => {
          const results = [];
          const seen = new Set();

          function scan(obj, depth = 0) {
            if (!obj || typeof obj !== 'object' || depth > 5 || seen.has(obj)) return;
            seen.add(obj);

            // Look for DASH structures
            if (obj.dash && typeof obj.dash === 'object') {
              const d = obj.dash;
              if (Array.isArray(d.video)) d.video.forEach(v => { if (v.base_url || v.baseUrl) results.push(v.base_url || v.baseUrl); });
              if (Array.isArray(d.audio)) d.audio.forEach(a => { if (a.base_url || a.baseUrl) results.push(a.base_url || a.baseUrl); });
            }

            // Look for common media keys
            const mediaKeys = ['playurl', 'playUrl', 'stream', 'manifest', 'src', 'url'];
            for (const key of mediaKeys) {
              if (obj[key] && typeof obj[key] === 'string' && obj[key].startsWith('http')) {
                if (/\.(m3u8|mpd|mp4|m4s|mp4a|mp4v)(?:$|\?|#)/i.test(obj[key])) {
                  results.push(obj[key]);
                }
              }
            }

            // Recurse
            for (const key in obj) {
              try {
                if (Object.prototype.hasOwnProperty.call(obj, key)) scan(obj[key], depth + 1);
              } catch { }
            }
          }

          // Scan common global state holders
          const candidates = [
            window.__initialState, window.__INITIAL_STATE__,
            window.__playinfo__, window.__PLAYER_CONFIG__,
            window.ytplayer, window._pageData
          ];

          candidates.forEach(c => { if (c) scan(c); });
          return [...new Set(results)];
        }).catch(() => []);

        if (structuredMedia && structuredMedia.length > 0) {
          console.log(`[PLAYWRIGHT][SCANNER] Found ${structuredMedia.length} candidate streams via state scan`);
          for (const u of structuredMedia) {
            if (addCapturedUrl(u)) {
              console.log(`[PLAYWRIGHT][STATE-CAPTURE] ${u}`);
              onMediaCaptured(u, { source: 'universal-state-scan' });
            }
          }
        }
      } catch (scanErr) {
        console.warn('[PLAYWRIGHT][SCANNER] State scan failed:', scanErr.message);
      }

      /* ═══════════════════════════════════════════════════════════
       *  Phase 1: Dismiss Age Gates & Consent Modals (NEW)
       *  This runs BEFORE play buttons since overlays block everything
       * ═══════════════════════════════════════════════════════════ */
      let overlayDismissed = false;
      for (let attempt = 1; attempt <= CONSENT_MAX_ATTEMPTS; attempt++) {
        // Check if there's a blocking overlay
        const hasOverlay = await hasBlockingOverlay(page);
        if (!hasOverlay && attempt > 1) {
          console.log('[PLAYWRIGHT][CONSENT] No blocking overlay detected, proceeding');
          break;
        }

        // Try to dismiss it
        const dismissed = await dismissConsentOverlays(page, attempt);
        if (dismissed) {
          overlayDismissed = true;
          // Wait for DOM to update after dismissal
          await new Promise(r => setTimeout(r, CONSENT_DISMISS_DELAY_MS));
          // Check if overlay is really gone
          const stillBlocked = await hasBlockingOverlay(page);
          if (!stillBlocked) {
            console.log('[PLAYWRIGHT][CONSENT] Overlay successfully dismissed');
            break;
          }
          console.log('[PLAYWRIGHT][CONSENT] Overlay still present, retrying...');
        } else if (attempt === 1) {
          // First attempt found nothing - probably no overlay
          console.log('[PLAYWRIGHT][CONSENT] No consent overlay to dismiss');
          break;
        }
      }

      // Brief wait if we dismissed something to let the page initialize
      if (overlayDismissed) {
        await new Promise(r => setTimeout(r, 400));
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await Promise.race([
          page.waitForLoadState('networkidle'),
          new Promise(r => setTimeout(r, 800))
        ]).catch(() => { });
      }

      /* ── Phase 2: Initial Interaction Trigger (NEW) ─────────── */
      console.log('[PLAYWRIGHT] Initial programmatic interaction trigger...');
      const initialTriggered = await tryClickPlay(page).catch(() => false);
      if (initialTriggered) {
        console.log('[PLAYWRIGHT] Initial interaction successful, waiting for network settle...');
        await new Promise(r => setTimeout(r, 1500));
      }

      // NEW: Explicitly call global init functions to bypass click interceptors
      await tryProgrammaticVideoInit(page);

      /* ── Close other overlays / modals (cookie banners, etc.) ── */
      await page.evaluate(() => {
        const sels = [
          'button[aria-label="Close"]', '.close', '.modal-close', '.popup-close',
          'button:has-text("Close")', 'button:has-text("No thanks")',
          'button:has-text("Not now")', 'button:has-text("Cancel")',
          '[class*="dismiss"]',
          'button:has-text("Accept")', 'button:has-text("I agree")',
          'button:has-text("Got it")', 'button:has-text("OK")',
          '.cookie-close', '.consent-close', '#cookie-accept',
          '[class*="cookie"] button', '[class*="gdpr"] button'
        ];
        sels.forEach(s => {
          try {
            document.querySelectorAll(s).forEach(el => {
              // Don't click elements we might have already handled
              const text = (el.textContent || '').toLowerCase();
              if (!/18|age|enter|adult/.test(text)) {
                el.click();
              }
            });
          } catch { }
        });
      }).catch(() => { });

      /* ── Prime player initialization before click loop ───────── */
      await page.evaluate(() => {
        try {
          const video = document.querySelector('video');
          if (video) {
            try { video.load?.(); } catch { }
            try { video.muted = true; } catch { }
            try { video.play().catch(() => { }); } catch { }
          }
        } catch { }
      }).catch(() => { });

      /* ── Click play (background) ───────────────────────────── */
      const playPromise = tryClickPlay(page).catch(() => { });

      /* ── Helper: process DOM poll results (ENHANCED with filtering) ── */
      const candidateIframes = new Set();
      const processDomPollResults = (videoSrcs, discoveredUrls, subs, label = '') => {
        let newCaptures = 0;

        // Video element sources: validate before capturing
        for (const url of videoSrcs) {
          // NEW: Filter out page URLs from video-src (e.g., view_video.php)
          if (isLikelyPageUrl(url)) {
            console.log(`[PLAYWRIGHT][SKIP-PAGE-URL] ${url}`);
            continue;
          }
          if (shouldAcceptCapturedUrl(url, 'video-src') && addCapturedUrl(url)) {
            const isPreview = isLikelyPreviewMedia(url);
            console.log(`[PLAYWRIGHT][${label}VIDEO-SRC]${isPreview ? '[PREVIEW]' : ''} ${url}`);
            setUrlContext(url, { fromVideoElement: true, isPreview, observedAsCurrentPlayback: !isPreview });
            // NEW: Only trigger settle for non-preview video sources
            if (!isPreview) {
              onMediaCaptured(url, { fromVideoElement: true });
            }
            newCaptures++;
          }
        }

        // Discovered URLs: filter through isMediaUrl and acceptance check
        for (const entry of discoveredUrls) {
          const url = typeof entry === 'string' ? entry : String(entry?.url || '');
          const source = typeof entry === 'string' ? 'dom-discover' : String(entry?.source || 'dom-discover');
          if (!url) continue;

          if (source === 'iframe-candidate') {
            try {
              const urlObj = new URL(url);
              const pageObj = new URL(pageUrl);
              if (urlObj.hostname !== pageObj.hostname) {
                candidateIframes.add(url);
              }
            } catch { }
          }

          if (shouldAcceptCapturedUrl(url, source)) {
            const hostname = extractHostname(url);
            // NEW: Require positive media signal, not just CDN hostname
            if (isMediaUrl(url) || (isCdnHostname(hostname) && !RE_STATIC_ASSET.test(url))) {
              if (addCapturedUrl(url)) {
                const isPreview = isLikelyPreviewMedia(url);
                const contextFlags = {
                  isPreview,
                  fromStructuredData: source === 'jsonld' || source === 'jsonld-response',
                  fromDownloadLink: source === 'download' || source === 'download-href',
                  fromPreloadLink: source === 'preload',
                  observedAsCurrentPlayback: source === 'preload'
                };
                console.log(`[PLAYWRIGHT][${label}${source.toUpperCase()}]${isPreview ? '[PREVIEW]' : ''} ${url}`);
                setUrlContext(url, contextFlags);
                if (!isPreview) onMediaCaptured(url, contextFlags);
                newCaptures++;
              }
            }
          }
        }

        // Subtitles
        for (const track of subs) {
          if (
            track.src &&
            RE_SUBTITLE_EXT.test(track.src) &&
            !isLikelyThumbnailUrl(track.src) &&
            !capturedSubtitles.has(track.src)
          ) {
            const lang = track.srclang || extractLanguageFromUrl(track.src);
            console.log(`[SUBTITLE] ${label}DOM-POLL: ${track.src} (lang: ${lang || 'unknown'})`);
            capturedSubtitles.set(track.src, buildCapturedSubtitleDescriptor({
              url: track.src,
              language: lang || null,
              label: track.label || null,
              kind: track.kind || 'subtitles'
            }));
          }
        }

        return newCaptures;
      };

      /* ── DOM polling loop ──────────────────────────────────── */
      let domPollRunning = true;
      const domPollLoop = (async () => {
        let pollCount = 0;
        while (domPollRunning) {
          pollCount++;
          const { videoSrcs, discoveredUrls, subs, drmKeys } = await pollDom(page);
          if (drmKeys && !globalCapturedDrmKeys) {
            console.log('[PLAYWRIGHT] Found global DRM keys:', drmKeys);
            globalCapturedDrmKeys = drmKeys;
          }
          processDomPollResults(videoSrcs, discoveredUrls, subs, '');

          // Every 3rd poll, also check iframes
          if (pollCount % 3 === 0) {
            const iframeUrls = await pollIframes(page);
            for (const url of iframeUrls) {
              if (!isLikelyPageUrl(url) && shouldAcceptCapturedUrl(url, 'iframe') && addCapturedUrl(url)) {
                const isPreview = isLikelyPreviewMedia(url);
                console.log(`[PLAYWRIGHT][IFRAME-SRC]${isPreview ? '[PREVIEW]' : ''} ${url}`);
                setUrlContext(url, { fromVideoElement: true, isPreview });
                if (!isPreview) onMediaCaptured(url, { fromVideoElement: true });
              }
            }
          }

          if (domPollRunning) await new Promise(r => setTimeout(r, DOM_POLL_INTERVAL_MS));
        }
      })();

      /* ── Wait for captures to settle ───────────────────────── */
      const pageProviders = providerRegistry?.getPageProviders ? providerRegistry.getPageProviders(pageUrl) : [];
      const hasWaitOverride = pageProviders.some(p => typeof p.waitAfterNavigation === 'function');

      if (hasWaitOverride) {
        await providerRegistry.waitAfterNavigation({
          pageUrl, page, capturedUrls, capturedSubtitles, state: providerState
        });
      } else {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(OVERALL_TIMEOUT_MS - elapsed, 5_000);

        await Promise.race([
          settlePromise,
          new Promise(r => setTimeout(r, remaining))
        ]);

        // If nothing captured OR only previews captured, try harder
        const pageMediaIds = collectAlphanumericSlugs(pageUrl);
        const hasRealCapture = Array.from(capturedUrls).some(url => {
          const baseContext = urlContext.get(url) || {};
          const sharedPageMediaIds = countSharedMediaIds(url, pageUrl);
          const ctx = {
            ...baseContext,
            sharedPageMediaIds,
            isCurrentPageMedia: sharedPageMediaIds > 0,
            isForeignFeedMedia: sharedPageMediaIds === 0 && (pageMediaIds?.size || 0) > 0
          };
          const isPreview = ctx.isPreview;
          const isSeg = isLikelySegment(url);
          const score = scoreUrl(url, ctx);
          const isMatch = !isPreview && !isSeg && score >= MIN_SETTLE_SCORE;
          console.log(`[PLAYWRIGHT][DEBUG-SETTLE] URL: ${url} | isPreview: ${isPreview} | isSegment: ${isSeg} | score: ${score} | isMatch: ${isMatch}`);
          return isMatch;
        });

        if (!hasRealCapture) {
          console.log('[PLAYWRIGHT] No reliable captures yet, trying recovery strategies…');

          const hasRealCaptureCheck = () => {
            return Array.from(capturedUrls).some(url => {
              const baseContext = urlContext.get(url) || {};
              const sharedPageMediaIds = countSharedMediaIds(url, pageUrl);
              const ctx = {
                ...baseContext,
                sharedPageMediaIds,
                isCurrentPageMedia: sharedPageMediaIds > 0,
                isForeignFeedMedia: sharedPageMediaIds === 0 && (pageMediaIds?.size || 0) > 0
              };
              const isPreview = ctx.isPreview || isLikelyPreviewMedia(url);
              const isSeg = isLikelySegment(url);
              const score = scoreUrl(url, ctx);
              return !isPreview && !isSeg && score >= MIN_SETTLE_SCORE;
            });
          };

          recovery_block: {
            // Strategy 0 (NEW): Maybe the overlay wasn't dismissed - try again
            const stillHasOverlay = await hasBlockingOverlay(page);
            if (stillHasOverlay) {
              console.log('[PLAYWRIGHT][RECOVERY] Overlay still detected, attempting to dismiss again...');
              reportProgress("Preparing playback environment...");
              await dismissConsentOverlays(page, 1);
              await new Promise(r => setTimeout(r, 1000));
            }
            if (hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 0');
              break recovery_block;
            }

            // Strategy 1: Scroll to reveal lazy-loaded players
            reportProgress("Detecting available streams...");
            await page.evaluate(() => {
              window.scrollBy(0, window.innerHeight);
              const video = document.querySelector('video, .video-container, .player, [class*="player"], [class*="video"]');
              if (video) video.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }).catch(() => { });
            if (hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 1');
              break recovery_block;
            }

            // Strategy 2: Re-try play click (with force)
            const playTriggered = await tryClickPlay(page).catch(() => false);
            if (playTriggered) {
              console.log('[PLAYWRIGHT] Interaction triggered, waiting for network settle...');
              for (let i = 0; i < 6; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (hasRealCaptureCheck()) {
                  console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 2 play-wait');
                  break recovery_block;
                }
              }
            }
            if (hasRealCaptureCheck()) break recovery_block;

            // Strategy 3: Try download button
            const downloadHref = await tryClickDownload(page).catch(() => null);
            if (downloadHref && shouldAcceptCapturedUrl(downloadHref, 'download-href') && addCapturedUrl(downloadHref)) {
              console.log(`[PLAYWRIGHT][DOWNLOAD-HREF] ${downloadHref}`);
              setUrlContext(downloadHref, { fromDownloadLink: true });
              onMediaCaptured(downloadHref, { fromDownloadLink: true });
            }
            if (hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 3');
              break recovery_block;
            }

            // Strategy 4: Wait for network idle (with timeout)
            const idlePromise = page.waitForLoadState('networkidle').catch(() => { });
            const timeoutPromise = new Promise(async (resolve) => {
              for (let i = 0; i < 16; i++) { // 8 seconds total (16 * 500ms)
                await new Promise(r => setTimeout(r, 500));
                if (hasRealCaptureCheck()) {
                  resolve('early');
                  return;
                }
              }
              resolve('timeout');
            });
            const idleResult = await Promise.race([idlePromise, timeoutPromise]);
            if (idleResult === 'early' || hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 4 network wait');
              break recovery_block;
            }

            // Strategy 5: Wait a bit more for lazy loaders
            for (let i = 0; i < 4; i++) { // 2 seconds total (4 * 500ms)
              await new Promise(r => setTimeout(r, 500));
              if (hasRealCaptureCheck()) {
                console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 5 wait');
                break recovery_block;
              }
            }

            // Strategy 5.5 (NEW): Try clicking play AGAIN after network settled
            const secondTriggered = await tryClickPlay(page).catch(() => false);
            if (secondTriggered) {
              for (let i = 0; i < 4; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (hasRealCaptureCheck()) {
                  console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 5.5 play-wait');
                  break recovery_block;
                }
              }
            }
            if (hasRealCaptureCheck()) break recovery_block;

            await tryProgrammaticVideoInit(page);
            await new Promise(r => setTimeout(r, 500));
            if (hasRealCaptureCheck()) break recovery_block;

            // Strategy 6: One more DOM poll
            const { videoSrcs, discoveredUrls, subs } = await pollDom(page);
            processDomPollResults(videoSrcs, discoveredUrls, subs, 'RECOVERY-');
            if (hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 6');
              break recovery_block;
            }

            // Strategy 7: Check for video that started playing
            const playingVideoSrc = await page.evaluate(() => {
              const videos = Array.from(document.querySelectorAll('video'));
              for (const v of videos) {
                if (!v.paused && v.currentSrc && !v.currentSrc.startsWith('blob:')) {
                  return v.currentSrc;
                }
                // Also check readyState >= HAVE_CURRENT_DATA
                if (v.readyState >= 2 && v.currentSrc && !v.currentSrc.startsWith('blob:')) {
                  return v.currentSrc;
                }
              }
              return null;
            }).catch(() => null);

            if (playingVideoSrc && shouldAcceptCapturedUrl(playingVideoSrc, 'playing-video') && addCapturedUrl(playingVideoSrc)) {
              console.log(`[PLAYWRIGHT][RECOVERY-PLAYING] ${playingVideoSrc}`);
              setUrlContext(playingVideoSrc, { fromVideoElement: true, isPlaying: true });
              onMediaCaptured(playingVideoSrc, { fromVideoElement: true });
            }
            if (hasRealCaptureCheck()) {
              console.log('[PLAYWRIGHT][RECOVERY] Early exit: reliable stream captured during Strategy 7');
              break recovery_block;
            }

            // Strategy 8 (NEW): Mine global JS variables for configs/URLs
            const globalDiscovery = await page.evaluate(() => {
              const results = [];
              const commonGlobals = ['config', 'settings', 'player', 'video', 'options', 'data', 'vjs', 'jw', 'plyr', 'videojs'];

              const search = (obj, depth = 0) => {
                if (!obj || typeof obj !== 'object' || depth > 4) return;
                for (const k in obj) {
                  try {
                    const v = obj[k];
                    if (typeof v === 'string' && v.startsWith('http')) {
                      if (/\.(m3u8|mpd|mp4|webm|mkv|mov|m4v|flv|ts)(?:$|\?|#)/i.test(v)) results.push(v);
                    } else if (v && typeof v === 'object') {
                      search(v, depth + 1);
                    }
                  } catch (e) { }
                }
              };

              for (const g of commonGlobals) {
                try {
                  if (window[g]) search(window[g]);
                } catch { }
              }
              return results;
            }).catch(() => []);

            for (const url of globalDiscovery) {
              if (shouldAcceptCapturedUrl(url, 'global-mine') && addCapturedUrl(url)) {
                console.log(`[PLAYWRIGHT][GLOBAL-MINE] ${url}`);
                onMediaCaptured(url);
              }
            }
          }
        }
      }

      // Ensure play click finished
      await playPromise;
      // Stop DOM polling
      domPollRunning = false;

      /* ── Final DOM scrape ──────────────────────────────────── */
      const { videoSrcs: finalVideoSrcs, discoveredUrls: finalDiscovered, subs: finalSubs } = await pollDom(page);
      processDomPollResults(finalVideoSrcs, finalDiscovered, finalSubs, 'FINAL-');

      // Final iframe check
      const finalIframeUrls = await pollIframes(page);
      for (const url of finalIframeUrls) {
        if (!isLikelyPageUrl(url) && shouldAcceptCapturedUrl(url, 'final-iframe') && addCapturedUrl(url)) {
          console.log(`[PLAYWRIGHT][FINAL-IFRAME] ${url}`);
          setUrlContext(url, { fromVideoElement: true });
        }
      }

      /* ── Provider resolution ───────────────────────────────── */
      const providerResult = await providerRegistry?.resolveCapturedPage?.({
        pageUrl, page, capturedUrls, capturedSubtitles,
        state: providerState, cacheKey
      });
      if (providerResult?.payload?.url) {
        genericPlaywrightCache.set(cacheKey, {
          payload: providerResult.payload,
          expiresAt: Date.now() + CACHE_TTL_MS
        });
        return providerResult.payload;
      }

      reportProgress("Resolving best quality...");
      /* ── Process captured URLs (ENHANCED scoring & filtering) ─ */
      if (capturedUrls.size === 0) {
        console.error('[PLAYWRIGHT] No media URL captured');
        return null;
      }

      let pageTitle = await page.title().catch(() => 'Online Video') || 'Online Video';

      // Improve generic titles by extracting a stream name from the URL path
      const lowerTitle = pageTitle.toLowerCase().trim();
      if (lowerTitle === '' || lowerTitle === 'online video' || lowerTitle === 'watch' || lowerTitle.length <= 3 || lowerTitle.includes('embed')) {
        try {
          const pathName = new URL(pageUrl).pathname;
          const segments = pathName.split('/').filter(Boolean);
          const lastSegment = segments.pop();
          if (lastSegment && lastSegment.length > 2 && !lastSegment.includes('.php') && !lastSegment.includes('.html')) {
            pageTitle = lastSegment
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());
          }
        } catch { }
      }
      const titleRes = extractResolutionFromText(pageTitle);
      const pageOrigin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();
      const pageSite = (() => {
        const host = extractHostname(pageUrl);
        const parts = host.split('.');
        return parts.length >= 2 ? parts.slice(-2).join('.') : host;
      })();
      const pageMediaIds = collectAlphanumericSlugs(pageUrl);
      const pageBrandName = (() => {
        const host = extractHostname(pageUrl);
        const parts = host.split('.').filter(p => p.length >= 3 && !['com', 'org', 'net', 'edu', 'gov', 'co', 'www'].includes(p));
        return parts.length > 0 ? parts.reduce((a, b) => a.length > b.length ? a : b, '') : '';
      })();

      // NEW: Separate real media from preview/thumbnail captures
      const scored = Array.from(capturedUrls)
        .map(url => {
          const baseContext = urlContext.get(url) || {};
          const candidateOrigin = (() => { try { return new URL(url).origin; } catch { return ''; } })();
          const candidateHostname = extractHostname(url);
          const candidateSite = (() => {
            const host = candidateHostname;
            const parts = host.split('.');
            return parts.length >= 2 ? parts.slice(-2).join('.') : host;
          })();
          const sharedPageMediaIds = countSharedMediaIds(url, pageUrl);

          const isExactPageUrl = (() => {
            try {
              const u1 = new URL(url);
              const u2 = new URL(pageUrl);
              return u1.origin === u2.origin && u1.pathname === u2.pathname;
            } catch {
              return url === pageUrl;
            }
          })();

          const candidateSiteName = candidateSite.split('.')[0];
          const pageSiteName = (pageSite || '').split('.')[0];
          const hasBrandAffinity = !!(pageBrandName && candidateHostname.includes(pageBrandName));

          const context = {
            ...baseContext,
            sharedPageMediaIds,
            isExactPageUrl,
            isCurrentPageMedia: sharedPageMediaIds > 0,
            isForeignFeedMedia: sharedPageMediaIds === 0 && pageMediaIds.size > 0,
            sameOriginAsPage: !!pageOrigin && candidateOrigin === pageOrigin,
            sameSiteAsPage: !!pageSite && candidateSite === pageSite,
            fuzzySiteMatch: !!pageSiteName && candidateSiteName === pageSiteName,
            hasBrandAffinity
          };
          return {
            url,
            score: scoreUrl(url, context),
            context,
            isPreview: context.isPreview || isLikelyPreviewMedia(url),
            isSegment: isLikelySegment(url)
          };
        })
        // NEW: Filter out likely junk – segments and very-low-score items
        .filter(item => {
          if (item.isSegment && !item.context?.source?.includes('json-dash')) return false;  // Never pick HLS/DASH segments unless explicitly mined from DASH JSON
          if (isTemplatePlaceholderMp4Url(item.url)) return false;
          if (isTemplateMediaUrl(item.url)) return false;
          if (item.score <= 0 || item.context?.isAd) return false;  // Completely irrelevant or flagged as ad
          return true;
        })
        .sort((a, b) => b.score - a.score);

      const isMultiFileSite = pageUrl.toLowerCase().includes('gofile.io');
      const extractFilenameFromUrl = (url) => {
        try {
          const parsed = new URL(url);
          const pathname = parsed.pathname;
          const filename = pathname.substring(pathname.lastIndexOf('/') + 1);
          if (filename) {
            return decodeURIComponent(filename);
          }
        } catch { }
        return 'Untitled Video';
      };

      let albumFiles = [];
      if (isMultiFileSite) {
        const uniqueFileMap = new Map();
        for (const item of scored) {
          if (item.isPreview || item.isSegment) continue;
          uniqueFileMap.set(item.url, {
            id: item.url,
            name: extractFilenameFromUrl(item.url),
            url: item.url
          });
        }
        albumFiles = Array.from(uniqueFileMap.values());
        console.log(`[PLAYWRIGHT][ALBUM] Extracted ${albumFiles.length} distinct files for multi-file page: ${pageUrl}`);
      }

      // NEW: Log scoring summary for debugging
      console.log(`[PLAYWRIGHT][FILTERING] ${scored.length} total captured candidates:`);
      for (const item of scored) {
        const flags = [
          item.context?.fromVideoElement ? 'video-el' : '',
          item.context?.fromMediaResource ? 'media-res' : '',
          item.context?.observedAsCurrentPlayback ? 'active' : '',
          item.context?.isCurrentPageMedia ? 'page-match' : '',
          item.context?.fromStructuredData ? 'structured' : '',
          item.context?.contentLength ? `${(item.context.contentLength / 1024 / 1024).toFixed(1)}MB` : ''
        ].filter(Boolean).join('|');
        console.log(`  [${item.score.toString().padStart(4)}] ${flags.padEnd(25)} ${item.url.substring(0, 100)}`);
      }

      const hasActivePlaybackCandidates = scored.some((item) =>
        item.context?.fromVideoElement || item.context?.fromMediaResource || item.context?.observedAsCurrentPlayback
      );
      const hasCurrentPageCandidates = scored.some((item) => item.context?.isCurrentPageMedia || item.context?.observedAsCurrentPlayback);

      const filteredScored = hasActivePlaybackCandidates
        ? scored.filter((item) => {
          const isActive = item.context?.fromVideoElement || item.context?.fromMediaResource || item.context?.observedAsCurrentPlayback;
          const isCurrentPage = item.context?.isCurrentPageMedia;
          const isMasterManifest = RE_MASTER_M3U8.test(String(item.url || ''));
          const isManifest = /\.(m3u8|mpd)(?:$|\?|#)/i.test(String(item.url || ''));
          const isConcreteQuality = extractResolutionFromUrl(item.url) > 0;
          // Retain all concrete qualities (240p, 480p, etc.) regardless of resolution, 
          // as long as they survived the score > 0 ad/junk filter above.
          return isActive || isMasterManifest || isManifest || isConcreteQuality;
        })
        : hasCurrentPageCandidates
          ? scored.filter((item) => item.context?.isCurrentPageMedia || item.context?.observedAsCurrentPlayback || extractResolutionFromUrl(item.url) > 0)
          : scored;

      // NEW: Cluster candidates to ensure we only group qualities belonging to the best candidate
      let clusteredScored = filteredScored;
      if (filteredScored.length > 0) {
        const bestCandidate = filteredScored[0];
        const bestIds = collectAlphanumericSlugs(bestCandidate.url);
        if (bestIds.size > 0) {
          clusteredScored = filteredScored.filter(item => {
            if (item === bestCandidate) return true;
            const itemIds = collectAlphanumericSlugs(item.url);
            for (const id of bestIds) {
              if (itemIds.has(id)) return true;
            }
            try {
              const u1 = new URL(bestCandidate.url);
              const u2 = new URL(item.url);
              const dir1 = u1.pathname.substring(0, u1.pathname.lastIndexOf('/'));
              const dir2 = u2.pathname.substring(0, u2.pathname.lastIndexOf('/'));
              if (u1.origin === u2.origin && dir1 === dir2 && dir1.length > 0) return true;
            } catch (e) { }
            return false;
          });
        } else {
          try {
            const u1 = new URL(bestCandidate.url);
            const dir1 = u1.pathname.substring(0, u1.pathname.lastIndexOf('/'));
            clusteredScored = filteredScored.filter(item => {
              if (item === bestCandidate) return true;
              try {
                const u2 = new URL(item.url);
                const dir2 = u2.pathname.substring(0, u2.pathname.lastIndexOf('/'));
                return u1.origin === u2.origin && dir1 === dir2;
              } catch (e) { return false; }
            });
          } catch (e) { }
        }
      }

      console.log(`[PLAYWRIGHT][SCORING] ${clusteredScored.length} candidates after final filter (active=${hasActivePlaybackCandidates}, page=${hasCurrentPageCandidates})`);
      for (const item of clusteredScored.slice(0, 10)) {
        console.log(`  [${item.score}] ${item.isPreview ? '[PREVIEW] ' : ''}${item.url.substring(0, 120)}`);
      }

      // Group best URL per resolution + codec/transport family so AV1/non-AV1 manifests
      // don't collapse into the same slot.
      const hasRealMedia = clusteredScored.some(item => !item.isPreview && item.score >= MIN_SETTLE_SCORE);
      const qualityMap = new Map();
      const getVariantBucket = (url) => {
        const value = String(url || '').toLowerCase();
        const isManifest = /\.(m3u8|mpd)(?:\/)?(?:$|\?|#)/i.test(value);
        const isAv1 = /(?:^|[\/_\-.,])(?:av1|av01)(?:[\/_\-.,]|$)/i.test(value);
        if (isManifest && isAv1) return 'manifest-av1';
        if (isManifest) return 'manifest';
        if (/\.mp4(?:\/)?(?:$|\?|#)/i.test(value) && isAv1) return 'mp4-av1';
        if (/\.mp4(?:\/)?(?:$|\?|#)/i.test(value)) return 'mp4';
        return 'other';
      };

      for (const item of clusteredScored) {
        if (hasRealMedia && item.isPreview) continue;

        let res = extractResolutionFromUrl(item.url);
        if (res === 0 && titleRes > 0 && item.context.fromVideoElement) {
          res = titleRes;
        }

        const lowerUrl = String(item.url || '').toLowerCase();
        const isInterlace = /[-_]1080i(?:\.|\?|#|$)/i.test(lowerUrl);
        if (isInterlace && res === 1080) {
          res = -1080;
        }

        const variantBucket = getVariantBucket(item.url);
        const key = `${res}:${variantBucket}`;
        const existing = qualityMap.get(key);
        if (!existing || existing.score < item.score) {
          qualityMap.set(key, { url: item.url, score: item.score, res, variantBucket, isInterlace });
        }
      }

      const qualities = Array.from(qualityMap.values())
        .map((data) => {
          const absRes = Math.abs(data.res);
          const baseLabel = absRes > 0 ? `${absRes}p` : 'undefined';
          const suffix = data.isInterlace ? ' (i)' :
            data.variantBucket === 'manifest-av1' ? ' (AV1 HLS/DASH)' :
              data.variantBucket === 'manifest' ? ' (HLS/DASH)' :
                data.variantBucket === 'mp4-av1' ? ' (AV1 MP4)' :
                  data.variantBucket === 'mp4' ? ' (MP4)' :
                    '';
          return { label: String(`${baseLabel}${suffix}`), value: data.url, variantBucket: data.variantBucket, isInterlace: data.isInterlace };
        })
        .filter(e => !RE_BLANK_MP4.test(String(e.value || '')))
        .sort((a, b) => {
          const getRes = (label) => parseInt(label, 10) || 0;
          const resDiff = getRes(b.label) - getRes(a.label);
          if (resDiff !== 0) return resDiff;
          const isInterlaceA = /\(i\)/i.test(a.label) ? -1 : 0;
          const isInterlaceB = /\(i\)/i.test(b.label) ? -1 : 0;
          if (isInterlaceA !== isInterlaceB) return isInterlaceA - isInterlaceB;
          const priority = (bucket) => (
            bucket === 'manifest-av1' ? 4 :
              bucket === 'mp4-av1' ? 3 :
                bucket === 'manifest' ? 2 :
                  bucket === 'mp4' ? 1 : 0
          );
          return priority(b.variantBucket) - priority(a.variantBucket);
        });

      if (qualities.length === 0) {
        if (depth === 0 && candidateIframes.size > 0) {
          console.log(`[PLAYWRIGHT] No valid media found, but detected ${candidateIframes.size} cross-origin iframe(s). Attempting recursive fallback...`);
          for (const iframeUrl of candidateIframes) {
            console.log(`[PLAYWRIGHT][IFRAME-FALLBACK] Navigating directly to iframe: ${iframeUrl}`);
            reportProgress(`Attempting fallback iframe: ${extractHostname(iframeUrl)}`);
            try {
              const result = await fetchMainPlayableVideoUrl(iframeUrl, onProgress, depth + 1, customReferer);
              if (result && result.url) {
                return result;
              }
            } catch (e) {
              console.warn(`[PLAYWRIGHT][IFRAME-FALLBACK] Fallback failed for ${iframeUrl}: ${e.message}`);
            }
          }
        }
        console.error('[PLAYWRIGHT] No valid media URL after filtering');
        return null;
      }

      // Pick the highest-scored non-preview candidate as the primary URL
      const bestScoredItem = (hasRealMedia ? scored.find(item => !item.isPreview) : scored[0]) || qualities[0] || { url: '', score: 0 };
      const bestUrl = bestScoredItem.url || bestScoredItem.value || '';
      console.log(`[PLAYWRIGHT] Final Selection: ${bestUrl} (score=${bestScoredItem.score || 0})`);
      console.log(`[PLAYWRIGHT][SUMMARY] captured=${capturedUrls.size} candidates=${filteredScored.length} qualities=${qualities.length} subs=${capturedSubtitles.size} duration=${Date.now() - startTime}ms`);

      /* ── Capture cookies before closing browser ────────────── */
      let capturedCookies = [];
      try {
        const cookies = await context.cookies();
        // Filter to relevant cookies (media domains)
        const mediaHostname = extractHostname(bestUrl);
        const pageHostname = extractHostname(pageUrl);
        capturedCookies = cookies.filter(c => {
          const domain = (c.domain || '').toLowerCase().replace(/^\./, '');
          const mediaMatch = mediaHostname ? (domain.includes(mediaHostname.split('.').slice(-2).join('.')) || mediaHostname.includes(domain)) : false;
          return mediaMatch ||
            domain.includes(pageHostname.split('.').slice(-2).join('.')) ||
            pageHostname.includes(domain);
        }).map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          secure: c.secure || false,
          httpOnly: c.httpOnly || false
        }));
        if (capturedCookies.length > 0) {
          console.log(`[PLAYWRIGHT][COOKIES] Captured ${capturedCookies.length} relevant cookies`);
        }

        // --- SYNC COOKIES TO ELECTRON ---
        // We sync ALL cookies from the context to Ensure Electron's net stack
        // exactly mirrors the "authorized" state Playwright just achieved.
        const playwrightCookies = await context.cookies();
        console.log(`[PLAYWRIGHT][COOKIES] Syncing ${playwrightCookies.length} cookies to Electron session`);
        for (const cookie of playwrightCookies) {
          try {
            const domainClean = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
            const cookieUrl = `https://${domainClean}${cookie.path}`;
            await session.defaultSession.cookies.set({
              url: cookieUrl,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              expirationDate: cookie.expires
            });
          } catch (e) {
            // Silently ignore failures for specific domains (e.g. invalid URLs)
          }
        }
      } catch (e) {
        console.log('[PLAYWRIGHT][COOKIES] Failed to capture or sync cookies:', e.message);
      }

      /* ── Subtitles ─────────────────────────────────────────── */
      const normalizedSubtitles = Array.from(capturedSubtitles.values()).map(sub =>
        buildCapturedSubtitleDescriptor({
          url: sub.url,
          language: sub.language,
          label: sub.label,
          kind: sub.kind,
          isDefault: !!sub.isDefault
        })
      );

      const defaultSubtitleUrl =
        normalizedSubtitles.find(s => s.isDefault)?.url ||
        normalizedSubtitles.find(s => String(s.language || '').toLowerCase() === 'en')?.url ||
        normalizedSubtitles.find(s => /\.(ass|ssa|vtt)(\?|$)/i.test(String(s.url || '')))?.url ||
        normalizedSubtitles[0]?.url ||
        null;

      if (normalizedSubtitles.length) {
        console.log('[PLAYWRIGHT][SUBTITLES]',
          normalizedSubtitles.map(s => `${s.format || 'SUB'} ${s.label || s.language || 'Unknown'}`).join(', '));
      }

      /* ── Build result (ENHANCED with comprehensive proxy support) ── */
      const isHlsOrDash = bestUrl ? (RE_M3U8.test(bestUrl) || RE_MPD.test(bestUrl)) : false;
      const baseMediaUrl = bestUrl ? getMediaBaseUrl(bestUrl) : '';
      const mediaOrigin = (() => { try { return bestUrl ? new URL(bestUrl).origin : null; } catch { return null; } })();

      // Build cookie string for headers
      const cookieString = capturedCookies.map(c => `${c.name}=${c.value}`).join('; ');

      // Build headers for each quality level (with cookies if available)
      const buildHeadersWithCookies = (url, opts = {}) => {
        if (!url) return {};
        const headers = buildFallbackProxyHeaders(pageUrl, url, opts);
        if (cookieString) {
          headers['cookie'] = cookieString;
        }
        return headers;
      };

      const qualityHeaders = {};
      for (const q of qualities) {
        const browserHeaders = capturedRequestHeaders.get(q.value) || null;
        qualityHeaders[q.value] = {
          ...buildHeadersWithCookies(q.value),
          ...(browserHeaders || {})
        };
      }

      // Build segment headers template (for HLS/DASH child requests)
      const segmentHeadersTemplate = buildHeadersWithCookies(bestUrl, {
        isSegment: true,
        playlistUrl: bestUrl,
        useMediaOriginReferer: false
      });

      // Construct comprehensive proxy configuration
      const proxyConfig = {
        // For manifest requests (master.m3u8, manifest.mpd)
        manifestHeaders: buildHeadersWithCookies(bestUrl),

        // For child playlists (index.m3u8, quality playlists)
        childPlaylistHeaders: buildHeadersWithCookies(bestUrl, {
          playlistUrl: bestUrl  // Use master manifest as referer
        }),

        // For segment requests (.ts, .m4s, .mp4 chunks)
        segmentHeaders: segmentHeadersTemplate,

        // URL resolution rules for HLS/DASH
        urlResolution: {
          baseUrl: baseMediaUrl,
          // If relative URL starts with '/', resolve against origin
          resolveAbsolute: (relativePath) => {
            if (!relativePath) return null;
            if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
              return relativePath; // Already absolute
            }
            if (relativePath.startsWith('/')) {
              return mediaOrigin + relativePath;
            }
            return baseMediaUrl + relativePath;
          }
        },

        // Retry strategies for 403/404 errors
        retryStrategies: [
          // Strategy 1: Original headers (already tried)
          { name: 'original', headers: null },
          // Strategy 2: Media origin as referer
          {
            name: 'mediaOriginReferer',
            headers: {
              ...buildFallbackProxyHeaders(pageUrl, bestUrl, { useMediaOriginReferer: true }),
              ...(cookieString ? { cookie: cookieString } : {})
            }
          },
          // Strategy 3: Manifest URL as referer (common for segments)
          {
            name: 'manifestReferer',
            headers: {
              ...buildFallbackProxyHeaders(bestUrl, bestUrl, { playlistUrl: bestUrl }),
              ...(cookieString ? { cookie: cookieString } : {})
            }
          },
          // Strategy 4: No referer (some CDNs block foreign referers)
          {
            name: 'noReferer',
            headers: {
              'user-agent': DESKTOP_USER_AGENT,
              'accept-language': 'en-US,en;q=0.9',
              'accept': '*/*',
              'accept-encoding': 'identity',
              'connection': 'keep-alive',
              ...(cookieString ? { cookie: cookieString } : {})
            }
          },
          // Strategy 5: Minimal headers
          {
            name: 'minimal',
            headers: {
              'user-agent': DESKTOP_USER_AGENT,
              'accept': '*/*'
            }
          }
        ]
      };

      const detectLiveStream = async (targetUrl, pwPage) => {
        try {
          // 1. Check Playwright page for active live video elements
          const isLivePlayer = await pwPage.evaluate(() => {
            try {
              if (window.__isLiveDetected) return true;
              const videos = document.querySelectorAll('video');
              for (const v of videos) {
                if (v.duration === Infinity) return true;
              }
              const liveClasses = ['.vjs-live', '.jw-state-live', '.dplayer-live', '.plyr--live', '.shaka-live', '.fp-live', '.is-live'];
              if (document.querySelector(liveClasses.join(', '))) return true;
              if (window.player && typeof window.player.isLive === 'function' && window.player.isLive()) return true;
              if (window.jwplayer && typeof window.jwplayer === 'function') {
                const jw = window.jwplayer();
                if (typeof jw.getDuration === 'function' && jw.getDuration() < 0) return true;
              }
              return false;
            } catch { return false; }
          }).catch(() => false);

          if (isLivePlayer) return true;

          // 2. Fast manifest probe
          if (targetUrl && /\.(m3u8|mpd)(?:$|\?|#)/i.test(targetUrl)) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            // Force native Node fetch to bypass Chromium network_delegate Referer restrictions
            const fetchFn = fetch;

            console.log(`[LIVE-PROBE] Fetching manifest: ${targetUrl}`);
            const res = await fetchFn(targetUrl, {
              method: 'GET',
              headers: buildHeadersWithCookies(targetUrl),
              signal: controller.signal
            }).catch((err) => {
              console.log(`[LIVE-PROBE] Fetch failed: ${err.message}`);
              return null;
            });

            clearTimeout(timeoutId);

            if (res && res.ok) {
              const text = await res.text().catch(() => '');
              if (/\.m3u8(?:$|\?|#)/i.test(targetUrl)) {
                if (text.includes('#EXT-X-STREAM-INF')) {
                  const lines = text.split('\n');
                  let childUri = null;
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                      for (let j = i + 1; j < lines.length; j++) {
                        const line = lines[j].trim();
                        if (line && !line.startsWith('#')) {
                          childUri = line;
                          break;
                        }
                      }
                      break;
                    }
                  }
                  if (childUri) {
                    let resolvedUri = childUri;
                    if (!childUri.startsWith('http')) {
                      try { resolvedUri = new URL(childUri, targetUrl).toString(); } catch (e) { }
                    }
                    console.log(`[LIVE-PROBE] Fetching child playlist: ${resolvedUri}`);
                    const childRes = await fetchFn(resolvedUri, {
                      method: 'GET', headers: buildHeadersWithCookies(resolvedUri), signal: controller.signal
                    }).catch((err) => {
                      console.log(`[LIVE-PROBE] Child fetch failed: ${err.message}`);
                      return null;
                    });
                    if (childRes && childRes.ok) {
                      const childText = await childRes.text().catch(() => '');
                      if (childText.includes('#EXTINF') && !childText.includes('#EXT-X-ENDLIST')) return true;
                    }
                  }
                } else if (text.includes('#EXTINF') && !text.includes('#EXT-X-ENDLIST')) {
                  return true;
                }
              } else if (/\.mpd(?:$|\?|#)/i.test(targetUrl)) {
                if (text.includes('type="dynamic"')) {
                  return true;
                }
              }
            }
          }
        } catch (e) {
          console.warn('[PLAYWRIGHT] Universal live detection failed:', e.message);
        }
        return false;
      };

      const isLiveUniversal = await detectLiveStream(bestUrl, page);

      const result = {
        url: bestUrl,
        title: pageTitle,
        qualities,
        selectedQuality: bestUrl,
        albumFiles: albumFiles.length > 0 ? albumFiles : null,
        albumName: isMultiFileSite ? `${pageTitle || 'GoFile Album'}` : null,
        youtubePlayerData: null,

        // Source information
        sourcePageUrl: pageUrl,
        sourcePageOrigin: pageOrigin,

        // Media URL information
        mediaOrigin: mediaOrigin,
        baseMediaUrl: baseMediaUrl,

        // Stream type flags
        isStreamingManifest: isHlsOrDash,
        isHls: RE_M3U8.test(bestUrl),
        isDash: RE_MPD.test(bestUrl),
        isLive: isLiveUniversal,

        // Primary headers for the main request
        proxyHeaders: {
          ...buildHeadersWithCookies(bestUrl),
          ...(capturedRequestHeaders.get(bestUrl) || {})
        },

        // Headers per quality level
        qualityHeaders,
        browserCapturedHeaders: Object.fromEntries(capturedRequestHeaders.entries()),

        // Comprehensive proxy configuration
        proxyConfig,

        // Captured cookies (raw, for proxy to use)
        cookies: capturedCookies,
        cookieString: cookieString || null,

        // Legacy fallback headers (for backwards compatibility)
        segmentHeaders: segmentHeadersTemplate,
        fallbackHeaders: {
          mediaOriginReferer: proxyConfig.retryStrategies[1].headers,
          noReferer: proxyConfig.retryStrategies[3].headers,
          manifestAsReferer: proxyConfig.retryStrategies[2].headers
        },

        subtitles: normalizedSubtitles,
        defaultSubtitleUrl,
        drmKeys: globalCapturedDrmKeys
      };

      genericPlaywrightCache.set(cacheKey, {
        payload: result,
        expiresAt: Date.now() + CACHE_TTL_MS
      });

      return result;

    } catch (error) {
      // Handle headful retry signal (thrown when bot detection wipes the page in headless mode)
      if (error?.__headfulRetry) {
        console.log('[PLAYWRIGHT] Retrying with HEADFUL mode...');
        // Clean up any remaining state
        if (_settleTimer) clearTimeout(_settleTimer);
        if (browser) {
          await browser.close().catch(() => { });
          browser = null;
        }
        // Domain was already added to HEADFUL_REQUIRED_DOMAINS before the throw,
        // so the recursive call will launch in headful mode via needsHeadfulMode().
        return fetchMainPlayableVideoUrl(pageUrl, onProgress, depth, customReferer);
      }
      console.error('[PLAYWRIGHT] Error:', error.message || error);
      return null;
    } finally {
      if (_settleTimer) clearTimeout(_settleTimer);
      if (browser) {
        await browser.close().catch(() => { });
        browser = null;
      }
    }
  }

  return {
    fetchMainPlayableVideoUrl,
    abortActiveCapture,
    // Export helper functions for proxy to use
    helpers: {
      // URL resolution
      resolveRelativeUrl,
      resolveUrlPreservingQuery,
      resolveManifestUrl,
      getMediaBaseUrl,
      getUrlWithoutQuery,
      buildProxyUrl,

      // Manifest rewriters (THE KEY FUNCTIONS FOR FIXING 404s)
      rewriteManifest,        // Auto-detects HLS vs DASH
      rewriteHlsManifest,     // For .m3u8 files
      rewriteDashManifest,    // For .mpd files

      // URL analysis
      extractHostname,
      isCdnHostname,
      isLikelyAdUrl,
      isLikelySegment,

      // Header building
      buildFallbackProxyHeaders,

      // Constants for reference
      DESKTOP_USER_AGENT
    }
  };
};