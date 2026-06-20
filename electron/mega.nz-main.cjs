const http = require('http');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const PROXY_BAN_TIME_MS = 5 * 60 * 1000;

class ProxyManager {
  constructor(deps) {
    this.proxies = [];
    this.bannedProxies = new Map();
    this.currentIndex = 0;
    this.deps = deps;
    this.isScraping = false;
    this.loadProxies();
  }

  loadProxies() {
    this.proxies = [];
    try {
      const proxyFile = path.join(process.cwd(), 'mega-proxies.txt');
      let manualLoaded = false;
      if (fs.existsSync(proxyFile)) {
        const lines = fs.readFileSync(proxyFile, 'utf8').split('\n');
        for (let line of lines) {
          line = line.trim();
          if (!line || line.startsWith('#')) continue;
          let agent;
          if (line.startsWith('socks')) {
            agent = new SocksProxyAgent(line);
          } else if (line.startsWith('http')) {
            agent = new HttpsProxyAgent(line);
          } else {
            agent = new HttpsProxyAgent(`http://${line}`);
          }
          this.proxies.push({ url: line, agent });
          manualLoaded = true;
        }
      }
      if (manualLoaded) {
        console.log(`[mega-provider] Loaded ${this.proxies.length} manual proxies from mega-proxies.txt`);
      } else {
        this.fetchAutomatedProxies();
      }
    } catch (err) {
      console.warn('[mega-provider] Failed to load proxies:', err.message);
      this.fetchAutomatedProxies();
    }
  }

  async fetchAutomatedProxies() {
    if (this.isScraping) return;
    this.isScraping = true;
    const urls = [
      'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
      'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
    ];
    console.log('[mega-provider] Auto-scraping public proxies for bypass automation...');
    for (const url of urls) {
      try {
        const listText = await new Promise((resolve, reject) => {
          const client = url.startsWith('https') ? require('https') : require('http');
          client.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          }).on('error', reject);
        });
        const lines = listText.split('\n');
        let count = 0;
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          const isSocks = url.includes('socks5');
          const proxyUrl = isSocks ? `socks5://${line}` : `http://${line}`;
          let agent;
          if (isSocks) {
            agent = new SocksProxyAgent(proxyUrl);
          } else {
            agent = new HttpsProxyAgent(proxyUrl);
          }
          if (count < 150) {
            this.proxies.push({ url: proxyUrl, agent });
            count++;
          }
        }
        console.log(`[mega-provider] Auto-loaded ${count} proxies from ${url}`);
      } catch (err) {
        console.warn(`[mega-provider] Failed to auto-scrape from ${url}:`, err.message);
      }
    }
    this.isScraping = false;
    console.log(`[mega-provider] Total proxy pool initialized with ${this.proxies.length} automated proxies`);
  }

  getAgent() {
    if (this.proxies.length === 0) return this.deps?.proxyHttpsAgent || null;
    const now = Date.now();
    for (const [url, unbanTime] of this.bannedProxies.entries()) {
      if (now > unbanTime) this.bannedProxies.delete(url);
    }
    for (let i = 0; i < this.proxies.length; i++) {
      const idx = (this.currentIndex + i) % this.proxies.length;
      const proxy = this.proxies[idx];
      if (!this.bannedProxies.has(proxy.url)) {
        this.currentIndex = (idx + 1) % this.proxies.length;
        return proxy.agent;
      }
    }
    if (this.bannedProxies.size >= this.proxies.length) {
      console.warn('[mega-provider] All proxies banned! Refreshing pool...');
      this.proxies = [];
      this.bannedProxies.clear();
      this.fetchAutomatedProxies();
    }
    return this.deps?.proxyHttpsAgent || null;
  }

  banAgent(agent) {
    if (!agent) return;
    const proxy = this.proxies.find(p => p.agent === agent);
    if (proxy) {
      this.bannedProxies.set(proxy.url, Date.now() + PROXY_BAN_TIME_MS);
    }
  }
}

module.exports = function createMegaProvider(deps) {
  let server = null;
  let serverPort = null;

  let File = null;
  let API = null;
  try {
    const megajs = require('megajs');
    File = megajs.File;
    API = megajs.API;
  } catch (error) {
    console.warn('[mega-provider] megajs is not installed.');
  }

  const proxyManager = new ProxyManager(deps);

  /**
   * Core strategy: Use megajs's native streaming which handles internal
   * chunking and parallel connections efficiently. We only layer proxy
   * rotation on top when a 509 bandwidth error is detected.
   */
  const streamWithRetry = (targetUrl, start, end, res, req) => {
    let attempt = 0;
    const maxAttempts = 6;

    const tryStream = (useProxy) => {
      attempt++;
      const agent = useProxy ? proxyManager.getAgent() : null;
      let api = null;
      if (API && agent) {
        api = new API(false, { httpsAgent: agent });
      }

      const file = api ? File.fromURL(targetUrl, { api }) : File.fromURL(targetUrl);

      file.loadAttributes()
        .then(() => {
          if (req.destroyed) return;

          // Use megajs built-in parallel download (maxConnections handles chunking internally)
          const stream = file.download({ start, end, maxConnections: 8 });

          let headersSent = false;
          let firstDataReceived = false;

          // Timeout for first byte — if we get nothing in 15s, something is wrong
          const firstByteTimeout = setTimeout(() => {
            if (!firstDataReceived && !stream.destroyed) {
              console.warn(`[mega-provider] No data received in 15s (attempt ${attempt}, ${useProxy ? 'proxy' : 'direct'}). Retrying...`);
              stream.destroy();
            }
          }, 15000);

          stream.on('data', () => {
            if (!firstDataReceived) {
              firstDataReceived = true;
              clearTimeout(firstByteTimeout);
            }
          });

          // Send headers on the first data event if not sent yet
          if (!headersSent) {
            const totalSize = file.size;
            const contentLength = end - start + 1;
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': contentLength,
              'Content-Type': 'video/mp4',
              'Access-Control-Allow-Origin': '*'
            });
            headersSent = true;
          }

          req.on('close', () => {
            if (!stream.destroyed) stream.destroy();
            clearTimeout(firstByteTimeout);
          });

          stream.on('error', (err) => {
            clearTimeout(firstByteTimeout);
            const msg = err.message || '';
            const is509 = msg.includes('Bandwidth') || msg.includes('509') || msg.includes('ETOOMANY');
            const isNetErr = msg.includes('socket') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND');

            if (is509 && useProxy && agent) {
              proxyManager.banAgent(agent);
            }

            if (attempt < maxAttempts && !req.destroyed) {
              // If it was a 509 on direct, switch to proxy. Otherwise keep retrying.
              const nextUseProxy = is509 || useProxy;
              console.log(`[mega-provider] Stream error (attempt ${attempt}/${maxAttempts}, ${useProxy ? 'proxy' : 'direct'}): ${msg}. Retrying with ${nextUseProxy ? 'proxy' : 'direct'}...`);
              tryStream(nextUseProxy);
            } else {
              console.error(`[mega-provider] All ${maxAttempts} attempts exhausted. Error: ${msg}`);
              if (!res.headersSent) {
                res.writeHead(502);
              }
              res.end();
            }
          });

          stream.pipe(res, { end: true });
        })
        .catch(err => {
          const msg = err.message || '';
          const is509 = msg.includes('Bandwidth') || msg.includes('509') || msg.includes('ETOOMANY');
          if (is509 && useProxy && agent) {
            proxyManager.banAgent(agent);
          }

          if (attempt < maxAttempts && !req.destroyed) {
            const nextUseProxy = is509 || useProxy;
            console.log(`[mega-provider] loadAttributes error (attempt ${attempt}/${maxAttempts}): ${msg}. Retrying with ${nextUseProxy ? 'proxy' : 'direct'}...`);
            tryStream(nextUseProxy);
          } else {
            console.error(`[mega-provider] loadAttributes failed after ${maxAttempts} attempts: ${msg}`);
            if (!res.headersSent) {
              res.writeHead(502);
            }
            res.end();
          }
        });
    };

    // Start with direct connection (fast path)
    tryStream(false);
  };

  const startServer = () => {
    return new Promise((resolve, reject) => {
      if (server) {
        resolve(serverPort);
        return;
      }

      server = http.createServer(async (req, res) => {
        try {
          const u = new URL(req.url, `http://${req.headers.host}`);
          const targetUrl = u.searchParams.get('url');
          if (!targetUrl) {
            res.writeHead(400);
            return res.end('Missing url parameter');
          }
          if (!File) {
            res.writeHead(500);
            return res.end('megajs is not available');
          }

          // Quick attribute fetch (direct, no proxy) to get total file size for range handling
          const rootFile = File.fromURL(targetUrl);
          await rootFile.loadAttributes();

          const totalSize = rootFile.size;
          let start = 0;
          let end = totalSize - 1;

          const rangeHeader = req.headers.range;
          if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, "").split("-");
            start = parseInt(parts[0], 10) || 0;
            end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
          }

          if (start >= totalSize || end >= totalSize) {
            res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
            return res.end();
          }

          // Hand off to the retry-aware stream function
          streamWithRetry(targetUrl, start, end, res, req);

        } catch (error) {
          console.error('[mega-provider] Server error:', error);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(error.message);
          }
        }
      });

      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        console.log(`[mega-provider] Decryption tunnel started on port ${serverPort}`);
        resolve(serverPort);
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  };

  return {
    id: 'mega',
    priority: 100,
    matchesPage: (url) => {
      if (!File) return false;
      const lower = String(url || '').toLowerCase();
      return /(?:mega\.nz|mega\.co\.nz)\/(?:file|folder)\/[a-zA-Z0-9_-]+#([a-zA-Z0-9_-]+)/i.test(lower);
    },
    resolveStandalone: async (context) => {
      try {
        const port = await startServer();
        const encodedUrl = encodeURIComponent(context.pageUrl);
        const streamUrl = `http://127.0.0.1:${port}/?url=${encodedUrl}`;
        console.log(`[mega-provider] Standalone resolved to local decryption tunnel: ${streamUrl}`);
        return {
          url: streamUrl,
          title: 'Mega.nz Direct Stream',
          providerId: 'mega',
          isLive: false
        };
      } catch (error) {
        console.error('[mega-provider] resolveStandalone failed:', error);
        return null;
      }
    }
  };
};
