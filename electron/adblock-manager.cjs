'use strict';

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const { PlaywrightBlocker } = require('@ghostery/adblocker-playwright');
const { Request } = require('@ghostery/adblocker');

const fs = require('node:fs');
const path = require('node:path');

/* ═══════════════════════════════════════════════════════════════════════
 *  Engine version — bump this when filter lists or custom rules change
 *  to force a re-download and re-parse on next startup.
 * ═══════════════════════════════════════════════════════════════════════ */
const ENGINE_VERSION = 6;

/* ═══════════════════════════════════════════════════════════════════════
 *  Comprehensive filter lists (AdGuard-level coverage)
 * ═══════════════════════════════════════════════════════════════════════ */
const FILTER_LIST_URLS = [
  // ── Core Ad Blocking ──
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  // ── AdGuard Filters ──
  'https://filters.adtidy.org/extension/chromium/filters/2.txt',   // AdGuard Base
  'https://filters.adtidy.org/extension/chromium/filters/3.txt',   // AdGuard Tracking Protection
  'https://filters.adtidy.org/extension/chromium/filters/4.txt',   // AdGuard Social Media
  'https://filters.adtidy.org/extension/chromium/filters/14.txt',  // AdGuard Annoyances
  'https://filters.adtidy.org/extension/chromium/filters/11.txt',  // AdGuard Mobile
  // ── AdGuard Extended ──
  'https://filters.adtidy.org/extension/chromium/filters/17.txt',  // URL Tracking Protection
  'https://filters.adtidy.org/extension/chromium/filters/18.txt',  // Cookie Notices
  'https://filters.adtidy.org/extension/chromium/filters/19.txt',  // Popups
  // ── uBlock Origin uAssets ──
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',
  // ── Extended Coverage ──
  'https://abp.oisd.nl/basic/',                                                          // OISD Basic
  'https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/nocoin.txt',   // crypto miners
  'https://easylist.to/easylist/fanboy-social.txt',
  // ── Community Lists ──
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
  'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
];

/* ═══════════════════════════════════════════════════════════════════════
 *  Custom AdBlock-syntax rules: exceptions (@@) to protect capture,
 *  plus extra block rules for known popup/redirect ad networks.
 * ═══════════════════════════════════════════════════════════════════════ */
const CUSTOM_FILTER_RULES = `
! ──────────────────────────────────────────────
! aether Player — Capture-Safe Exceptions
! ──────────────────────────────────────────────

! ── Player framework scripts (MUST load for media to work) ──
@@||cdn.jwplayer.com^$script,stylesheet
@@||ssl.p.jwpcdn.com^$script,stylesheet
@@||content.jwplatform.com^$script,media
@@||cdn.flowplayer.com^$script
@@||cdn.flowplayer.org^$script
@@||vjs.zencdn.net^$script
@@||cdn.plyr.io^$script
@@||cdn.dashjs.org^$script
@@||cdn.jsdelivr.net^$script,stylesheet
@@||cdnjs.cloudflare.com^$script,stylesheet
@@||unpkg.com^$script
@@||fastly.jsdelivr.net^$script,stylesheet

! ── Bot-detection / CAPTCHA services (blocking = instant detection) ──
@@||challenges.cloudflare.com^
@@||turnstile.cloudflare.com^
@@||www.google.com/recaptcha^
@@||www.gstatic.com/recaptcha^
@@||js.hcaptcha.com^
@@||hcaptcha.com^$script
@@||api.hcaptcha.com^

! ── Global resource-type exceptions (never block media/websocket) ──
@@$media
@@$websocket

! ── Embed site exceptions (allow all network requests on DGA API domains) ──
@@||*^$domain=pooembed.eu|pooembed.cc|vidembed.eu|vidembed.cc|membed.eu

! ──────────────────────────────────────────────
! aether Player — Extra Block Rules
! (adult/popup ad networks not fully covered by standard lists)
! ──────────────────────────────────────────────
||popads.net^
||popcash.net^
||popunder.net^
||propellerads.com^
||realsrv.com^
||tsyndicate.com^
||trafficstars.com^
||exoclick.com^
||juicyads.com^
||plugrush.com^
||adxad.com^
||twinred.com^
||clickadu.com^
||hilltopads.com^
||awempire.com^
||a-ads.com^
||vidwestxyz.com^
||playhubconnect.com^
||acquiredeceasedundress.com^
||mndsrvr.com^
||adxpremium.click^
||adxprm.com^
||ero-advertising.com^
||afcdn.net^
||pt-static.com^

! ── Native advertising & recommendation widgets ──
||outbrain.com^
||taboola.com^
||mgid.com^
||revcontent.com^
||admaven.com^
||primis.tech^
||anyclip.com^
||adtelligent.com^
||smartadserver.com^
||vertamedia.com^
||richaudience.com^
||lockerdome.com^
||adspyglass.com^
||33across.com^
||pubmatic.com^$third-party
||rubiconproject.com^$third-party
||openx.net^$third-party
||appnexus.com^$third-party

! ── Redirect/shortlink ad gates ──
||adf.ly^
||bc.vc^
||sh.st^
||exe.io^
||oke.io^
||bit.ly^$popup
||tinyurl.com^$popup
`.trim();

/* ═══════════════════════════════════════════════════════════════════════
 *  Capture-critical allowlist patterns
 *  Requests matching these are NEVER blocked, even if a filter list
 *  matches them. This protects media playback and bot-detection bypass.
 * ═══════════════════════════════════════════════════════════════════════ */
const CAPTURE_ALLOW_PATTERNS = [
  // Player frameworks
  /^https?:\/\/[^/]*\.?jwp(?:layer|cdn|latform)\.com\//i,
  /^https?:\/\/ssl\.p\.jwpcdn\.com\//i,
  /^https?:\/\/[^/]*\.?flowplayer\.(?:com|org)\//i,
  /^https?:\/\/vjs\.zencdn\.net\//i,
  /^https?:\/\/[^/]*\.?plyr\.io\//i,
  /^https?:\/\/cdn\.dashjs\.org\//i,
  /^https?:\/\/cdn\.jsdelivr\.net\//i,
  /^https?:\/\/fastly\.jsdelivr\.net\//i,
  /^https?:\/\/cdnjs\.cloudflare\.com\//i,
  /^https?:\/\/unpkg\.com\//i,
  // Bot-detection / CAPTCHA
  /^https?:\/\/challenges\.cloudflare\.com\//i,
  /^https?:\/\/turnstile\.cloudflare\.com\//i,
  /^https?:\/\/[^/]*\.?hcaptcha\.com\//i,
  /^https?:\/\/www\.gstatic\.com\/recaptcha\//i,
  /^https?:\/\/www\.google\.com\/recaptcha\//i,
];

/* ═══════════════════════════════════════════════════════════════════════
 *  Ad-media URL patterns (used by isPotentialAdMedia)
 * ═══════════════════════════════════════════════════════════════════════ */
const AD_MEDIA_PATTERNS = [
  /googleads\.g\.doubleclick\.net/i,
  /\/vast[\/\?]/i,
  /\/vpaid[\/\?]/i,
  /\/ima3?\//i,
  /\/design\/tour\//i,
  /\/continuation\//i,
  /\/mediabuy/i,
  /_ad\.mp4/i,
  /[_\-]?video[_\-]?ad/i,
  /pre[_\-]?roll/i,
  /mid[_\-]?roll/i,
  /post[_\-]?roll/i,
  /\/advert(?:ising|s)?[\/\?]/i,
  /\/sponsor(?:ed)?[\/\?]/i,
  /[_\-]bumper[_\-.]?\d*\.(?:mp4|webm)/i,
  /\/(?:ad|ads)\/.*\.(?:mp4|webm)/i,
];

const RE_MANIFEST = /\.(?:m3u8|mpd)(?:\/)?(?:\?|#|$)/i;
const RE_RESOLUTION = /(?:^|\D)(?:2160|1440|1080|720|480|360|240)p?(?:\D|$)/i;
const RE_MEDIA_BINARY = /\.(?:mp4|webm|mkv|mov|avi|m4v|flv|ts|m4s)(?:\/)?(?:\?|#|$)/i;

class AdBlockManager {
  constructor(appCacheDir) {
    this.cacheDir = path.join(appCacheDir, 'adblock');
    this.pwEnginePath = path.join(this.cacheDir, `pw-engine-v${ENGINE_VERSION}.bin`);
    this.elEnginePath = path.join(this.cacheDir, `el-engine-v${ENGINE_VERSION}.bin`);
    this.combinedListPath = path.join(this.cacheDir, `combined-v${ENGINE_VERSION}.txt`);
    this.playwrightBlocker = null;
    this.electronBlocker = null;
    this.initialized = false;
    this._initPromise = null;
    this._combinedFilters = null; // cached combined filter text
  }

  /* ─── Public API ──────────────────────────────────────────────── */

  async initialize() {
    if (this.initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize();
    try { await this._initPromise; } finally { this._initPromise = null; }
  }

  /**
   * Enable ad blocking in an Electron session.
   * Reuses the same combined filter text — no redundant download.
   */
  async enableInElectron(electronSession) {
    if (!this.initialized) await this.initialize();
    try {
      if (this._combinedFilters) {
        this.electronBlocker = ElectronBlocker.parse(this._combinedFilters, {
          loadCosmeticFilters: false,  // Electron session doesn't need cosmetic filters
          loadNetworkFilters: true,
        });
      } else {
        // Fallback: prebuilt if combined text wasn't cached
        this.electronBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
          path: this.elEnginePath,
          read: fs.promises.readFile,
          write: fs.promises.writeFile,
        });
      }
      this.electronBlocker.enableBlockingInSession(electronSession);
      console.log('[AdBlock] Enabled in Electron session');
    } catch (err) {
      console.error('[AdBlock] Failed to enable in Electron session:', err.message);
    }
  }

  /**
   * Enable ad blocking in a Playwright page.
   * Uses the comprehensive Playwright blocker with cosmetic filters.
   */
  async enableInPlaywrightPage(page) {
    if (!this.initialized) await this.initialize();
    if (this.playwrightBlocker && typeof this.playwrightBlocker.enableBlockingInPage === 'function') {
      try {
        await this.playwrightBlocker.enableBlockingInPage(page);
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
        console.log('[AdBlock] Enabled in Playwright page');
      } catch (err) {
        console.warn('[AdBlock] Failed to enable in Playwright page:', err.message);
      }
    }
  }

  /**
   * Context-aware blocking decision for the capture route handler.
   * Returns true if the request SHOULD BE BLOCKED.
   *
   * This method respects allowlists for player scripts, bot-detection,
   * and same-origin resources to avoid breaking media capture.
   */
  shouldBlockForCapture(url, pageUrl, resourceType) {
    if (!url) return false;

    // ── 1. Never block document navigations ──
    if (resourceType === 'document' || resourceType === 'subdocument') return false;

    // ── 2. Never block same-origin script/xhr/fetch (prevents bot detection breakage) ──
    if (pageUrl) {
      try {
        const reqHost = new URL(url).hostname.toLowerCase();
        const pageHost = new URL(pageUrl).hostname.toLowerCase();
        if (reqHost === pageHost) return false;
        // Also allow same base domain (e.g., cdn.example.com vs example.com)
        const reqBase = reqHost.split('.').slice(-2).join('.');
        const pageBase = pageHost.split('.').slice(-2).join('.');
        if (reqBase === pageBase && (resourceType === 'script' || resourceType === 'xhr' || resourceType === 'fetch')) {
          return false;
        }
      } catch { /* ignore parse errors */ }
    }

    // ── 3. Never block capture-critical allowlisted domains ──
    for (const pattern of CAPTURE_ALLOW_PATTERNS) {
      if (pattern.test(url)) return false;
    }

    // ── 4. Never block media resource type ──
    if (resourceType === 'media') return false;

    // ── 5. Consult the Ghostery engine ──
    if (this.playwrightBlocker) {
      try {
        const result = this.playwrightBlocker.match(Request.fromRawDetails({
          url,
          sourceUrl: pageUrl || '',
          type: resourceType || 'other',
        }));
        if (result.match && !result.exception) return true;
      } catch { /* engine error — fail open */ }
    }

    return false;
  }

  /**
   * Legacy compatibility: simple URL check without context.
   */
  shouldBlock(url, sourceUrl, resourceType) {
    return this.shouldBlockForCapture(url, sourceUrl, resourceType);
  }

  /**
   * Heuristic to identify if a captured media URL is likely an ad.
   * This is used for SCORING, not for outright blocking requests.
   *
   * @param {Object} details - { url, contentType, contentLength, duration, pageUrl }
   * @returns {boolean}
   */
  isPotentialAdMedia(details) {
    const { url, contentType, contentLength, duration, pageUrl } = details || {};
    if (!url) return false;
    const lowerUrl = url.toLowerCase();

    // ── 1. Check against ad-specific URL patterns ──
    for (const pattern of AD_MEDIA_PATTERNS) {
      if (pattern.test(lowerUrl)) return true;
    }

    // ── 2. Never flag manifests as ads (they describe the stream, not the ad) ──
    if (RE_MANIFEST.test(lowerUrl)) return false;

    // ── 3. Never flag URLs with resolution markers (720p, 1080p, etc.) ──
    if (RE_RESOLUTION.test(lowerUrl)) return false;

    // ── 4. Same-origin check: if media is from the same site, it's almost never an ad ──
    if (pageUrl) {
      try {
        const mediaBase = new URL(url).hostname.split('.').slice(-2).join('.');
        const pageBase = new URL(pageUrl).hostname.split('.').slice(-2).join('.');
        if (mediaBase === pageBase) return false;
      } catch { /* ignore */ }
    }

    // ── 5. Duration heuristic: very short media is likely an ad bumper ──
    if (duration && duration > 0 && duration < 6) return true;

    // ── 6. Size + type heuristic: small cross-origin binary media ──
    const isVideoType = contentType && contentType.startsWith('video/');
    const isBinaryMedia = RE_MEDIA_BINARY.test(lowerUrl);

    if ((isVideoType || isBinaryMedia) && contentLength && contentLength > 0) {
      // Never flag DASH/HLS segments (.m4s, .ts) as ads based on size heuristics
      const isFragmentSegment = /\.(?:m4s|ts)(?:\/)?(?:\?|#|$)/i.test(lowerUrl);
      if (!isFragmentSegment) {
        // Extremely small MP4/WebM (< 500 KB) from a different origin: very likely ad
        if (contentLength < 500 * 1024) return true;
        // 500 KB–2 MB: only flag if BOTH generic MIME and short-hash filename (classic ad pattern)
        if (contentLength < 2 * 1024 * 1024) {
          const isGenericMime = !contentType || contentType === 'video/mp4' || contentType === 'video/webm';
          const isHashFilename = /\/[a-f0-9]{8,32}\.(?:mp4|webm)$/i.test((() => { try { return new URL(url).pathname; } catch { return ''; } })());
          if (isGenericMime && isHashFilename) return true;
        }
      }
    }

    // ── 7. Consult the Ghostery engine for the URL ──
    if (this.playwrightBlocker) {
      try {
        const result = this.playwrightBlocker.match(Request.fromRawDetails({
          url,
          sourceUrl: pageUrl || '',
          type: 'media',
        }));
        if (result.match && !result.exception) return true;
      } catch { /* fail open */ }
    }

    return false;
  }

  /**
   * Strip tracking/analytics query parameters from a URL.
   * Designed to be called from a Playwright route handler on every
   * navigation request to clean outbound URLs of tracking identifiers.
   *
   * @param {string} url - The URL to clean.
   * @returns {string} The cleaned URL, or the original if parsing fails.
   */
  stripTrackingParams(url) {
    try {
      const u = new URL(url);
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
        'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'zanpid',
        '_ga', '_gl', 'mc_eid', 'igshid', 'ref', 'source', 'trk', 'twclid',
      ];
      let removed = 0;
      for (const param of trackingParams) {
        if (u.searchParams.has(param)) {
          u.searchParams.delete(param);
          removed++;
        }
      }
      return removed > 0 ? u.toString() : url;
    } catch {
      return url;
    }
  }

  /* ─── Internal ────────────────────────────────────────────────── */

  /**
   * Resolve the path to the bundled filter list shipped with the app.
   * In packaged builds: process.resourcesPath/build-resources/adblock/bundled-filters.txt
   * In dev: __dirname/../build-resources/adblock/bundled-filters.txt
   */
  _getBundledListPath() {
    const { app } = require('electron');
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'build-resources', 'adblock', 'bundled-filters.txt') : null,
      path.join(__dirname, '..', 'build-resources', 'adblock', 'bundled-filters.txt')
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  _getBundledEnginePath() {
    const { app } = require('electron');
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'build-resources', 'adblock', `pw-engine-v${ENGINE_VERSION}.bin`) : null,
      path.join(__dirname, '..', 'build-resources', 'adblock', `pw-engine-v${ENGINE_VERSION}.bin`)
    ].filter(Boolean);
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  async _doInitialize() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      // Clean up old engine versions
      this._cleanOldCaches();

      /* ── Phase 1: Load from LOCAL files only (instant, no network) ── */
      let combined = null;

      // 1a. Try serialized engine cache (fastest — binary deserialization)
      try {
        if (fs.existsSync(this.pwEnginePath)) {
          const data = await fs.promises.readFile(this.pwEnginePath);
          this.playwrightBlocker = PlaywrightBlocker.deserialize(data);
          console.log('[AdBlock] Loaded engine from serialized cache (instant)');
          // Also load combined text for Electron session use
          try {
            if (fs.existsSync(this.combinedListPath)) {
              this._combinedFilters = await fs.promises.readFile(this.combinedListPath, 'utf-8');
            }
          } catch { /* non-fatal */ }
          this.initialized = true;
          this._scheduleBackgroundRefresh();
          return;
        }
      } catch {
        this.playwrightBlocker = null;
      }

      // 1b. Try bundled serialized engine cache (instant fallback for clean launches)
      try {
        const bundledEnginePath = this._getBundledEnginePath();
        if (bundledEnginePath && fs.existsSync(bundledEnginePath)) {
          const data = await fs.promises.readFile(bundledEnginePath);
          this.playwrightBlocker = PlaywrightBlocker.deserialize(data);
          console.log(`[AdBlock] Loaded engine from bundled serialized cache: ${bundledEnginePath}`);
          // Copy it to AppData so future launches don't even have to scan resources path
          fs.promises.writeFile(this.pwEnginePath, data).catch(() => { });

          // Also check for the bundled text list to populate _combinedFilters for Electron
          const bundledTxtPath = this._getBundledListPath();
          if (bundledTxtPath && fs.existsSync(bundledTxtPath)) {
            try {
              const combinedText = await fs.promises.readFile(bundledTxtPath, 'utf-8');
              this._combinedFilters = combinedText + '\n' + CUSTOM_FILTER_RULES;
              // Write combined text to AppData as well
              fs.promises.writeFile(this.combinedListPath, this._combinedFilters).catch(() => { });
            } catch { /* non-fatal */ }
          }

          this.initialized = true;
          this._scheduleBackgroundRefresh();
          return;
        }
      } catch (err) {
        console.warn('[AdBlock] Failed to load bundled serialized engine:', err.message);
        this.playwrightBlocker = null;
      }

      // 1c. Try appData combined text cache
      try {
        if (fs.existsSync(this.combinedListPath)) {
          combined = await fs.promises.readFile(this.combinedListPath, 'utf-8');
          if (combined.length > 10000) {
            console.log('[AdBlock] Loading from appData text cache');
          } else {
            combined = null;
          }
        }
      } catch { combined = null; }

      // 1d. Try bundled filter list (shipped with the app — always available)
      if (!combined) {
        const bundledPath = this._getBundledListPath();
        if (bundledPath) {
          try {
            combined = await fs.promises.readFile(bundledPath, 'utf-8');
            console.log(`[AdBlock] Loading from bundled filter list: ${bundledPath}`);
            // Copy to appData cache so future launches are even faster
            try {
              await fs.promises.writeFile(this.combinedListPath, combined);
            } catch { /* non-fatal */ }
          } catch (err) {
            console.warn('[AdBlock] Failed to read bundled filters:', err.message);
          }
        }
      }

      /* ── Phase 2: Parse the combined text into an engine ── */
      if (combined) {
        // Append custom rules so they persist in the text cache
        const fullText = combined + '\n' + CUSTOM_FILTER_RULES;
        this._combinedFilters = fullText;
        this.playwrightBlocker = PlaywrightBlocker.parse(fullText, {
          loadCosmeticFilters: true,
          loadNetworkFilters: true,
        });

        // Serialize for instant load next time (background, non-blocking)
        fs.promises.writeFile(this.pwEnginePath, this.playwrightBlocker.serialize())
          .then(() => console.log('[AdBlock] Engine serialized to cache for next launch'))
          .catch(err => console.warn('[AdBlock] Failed to cache engine:', err.message));

        const filterCount = combined.split('\n').filter(l => l.trim() && !l.startsWith('!')).length;
        console.log(`[AdBlock] Engine initialized — ~${filterCount} rules from ${FILTER_LIST_URLS.length} lists + custom rules`);
      } else {
        // Ultimate fallback: prebuilt (EasyList + EasyPrivacy only, requires network)
        console.warn('[AdBlock] No local filters available, falling back to prebuilt EasyList');
        try {
          this.playwrightBlocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
            path: this.pwEnginePath,
            read: fs.promises.readFile,
            write: fs.promises.writeFile,
          });
        } catch (err) {
          console.error('[AdBlock] Prebuilt fallback also failed:', err.message);
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('[AdBlock] Initialization failed:', error);
      this.initialized = true; // Mark as initialized to prevent infinite retries
    }

    // Schedule background refresh for stale lists
    this._scheduleBackgroundRefresh();
  }

  /**
   * Check if the cached filter lists need updating (>72h old) and
   * download fresh lists in the background. Never blocks initialization.
   */
  _scheduleBackgroundRefresh() {
    // Check cache age
    let needsRefresh = true;
    try {
      if (fs.existsSync(this.combinedListPath)) {
        const stat = fs.statSync(this.combinedListPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 72 * 60 * 60 * 1000) {
          needsRefresh = false;
        }
      }
    } catch { /* assume refresh needed */ }

    if (!needsRefresh) {
      console.log('[AdBlock] Filter lists are fresh (< 72h old), skipping background refresh');
      return;
    }

    console.log('[AdBlock] Scheduling background filter list refresh...');
    // Small delay to let the app finish startup before using bandwidth
    setTimeout(() => {
      this._downloadAndRefresh().catch(err =>
        console.warn('[AdBlock] Background refresh failed:', err.message)
      );
    }, 10_000);
  }

  /**
   * Download fresh filter lists in the background and hot-swap the engine.
   */
  async _downloadAndRefresh() {
    console.log(`[AdBlock] Background: Downloading ${FILTER_LIST_URLS.length} filter lists...`);

    const results = await Promise.allSettled(
      FILTER_LIST_URLS.map(async (url) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const resp = await fetch(url, { signal: ctrl.signal });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          let text = await resp.text();
          // Size cap: prevent a single oversized list from blowing memory
          if (text.length > 10 * 1024 * 1024) {
            console.warn(`[AdBlock]   ⚠ ${url.split('/').pop()?.substring(0, 40)} truncated (${(text.length / 1024 / 1024).toFixed(1)}MB > 10MB)`);
            text = text.substring(0, 10 * 1024 * 1024);
          }
          console.log(`[AdBlock]   ✓ ${url.split('/').pop()?.substring(0, 40)} (${text.length} chars)`);
          return text;
        } catch (err) {
          console.warn(`[AdBlock]   ✗ ${url.split('/').pop()?.substring(0, 40)}: ${err.message}`);
          return '';
        } finally {
          clearTimeout(timer);
        }
      })
    );

    const listTexts = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(t => t.length > 0);

    if (listTexts.length < 3) {
      console.warn('[AdBlock] Background refresh: too few lists downloaded, keeping current engine');
      return;
    }

    console.log(`[AdBlock] Background: Downloaded ${listTexts.length}/${FILTER_LIST_URLS.length} lists`);

    const combined = listTexts.join('\n') + '\n' + CUSTOM_FILTER_RULES;

    // Save to appData cache
    try {
      await fs.promises.writeFile(this.combinedListPath, combined);
    } catch { /* non-fatal */ }

    // Hot-swap the engine
    const fullText = combined;
    const newBlocker = PlaywrightBlocker.parse(fullText, {
      loadCosmeticFilters: true,
      loadNetworkFilters: true,
    });

    this.playwrightBlocker = newBlocker;
    this._combinedFilters = combined;

    // Serialize the new engine
    try {
      await fs.promises.writeFile(this.pwEnginePath, newBlocker.serialize());
    } catch { /* non-fatal */ }

    const filterCount = combined.split('\n').filter(l => l.trim() && !l.startsWith('!')).length;
    console.log(`[AdBlock] Background refresh complete — ~${filterCount} rules hot-swapped`);
  }

  /**
   * Remove old engine/cache files from previous versions.
   */
  _cleanOldCaches() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const currentSuffix = `v${ENGINE_VERSION}`;
      for (const file of files) {
        if (
          (file.startsWith('pw-engine-') || file.startsWith('el-engine-') || file.startsWith('combined-')) &&
          !file.includes(currentSuffix)
        ) {
          try {
            fs.unlinkSync(path.join(this.cacheDir, file));
            console.log(`[AdBlock] Cleaned old cache: ${file}`);
          } catch { /* non-fatal */ }
        }
      }
      // Also clean legacy engine.bin from old versions
      const legacyEngine = path.join(this.cacheDir, 'engine.bin');
      if (fs.existsSync(legacyEngine)) {
        try { fs.unlinkSync(legacyEngine); } catch { }
      }
    } catch { /* non-fatal */ }
  }
}

AdBlockManager.ENGINE_VERSION = ENGINE_VERSION;
AdBlockManager.CUSTOM_FILTER_RULES = CUSTOM_FILTER_RULES;

module.exports = AdBlockManager;
