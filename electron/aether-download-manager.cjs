const http = require('http');
const https = require('https');
const fs = require('fs');
const util = require('util');

const fsWrite = util.promisify(fs.write);

/**
 * DynamicDownloader
 * Implements a high-performance HTTP download engine mimicking IDM's dynamic segmentation.
 * - Zero-Merge Disk I/O using fs.write at precise offsets.
 * - V8 GC evasion via strict stream backpressure.
 * - Dynamic segment splitting for maximizing bandwidth on idle connections.
 * - CDN Rate-limit evasion via specific chunk retries and dynamic thread scaling.
 */
class DynamicDownloader {
  constructor(options) {
    this.downloadId = options.downloadId;
    this.finalUrl = options.finalUrl;
    this.filePath = options.filePath;
    this.totalBytes = options.totalBytes;
    this.headers = options.headers || {};
    this.httpAgent = options.proxyHttpAgent;
    this.httpsAgent = options.proxyHttpsAgent;
    this.maxThreads = options.threadCount || 8;
    this.supportsRanges = options.supportsRanges !== false;
    this.abortController = options.abortController;

    this.onProgress = options.onProgress || (() => { });
    this.onComplete = options.onComplete || (() => { });
    this.onError = options.onError || (() => { });

    this.segments = []; // Array of active/idle segments
    this.fd = null;
    this.downloadedBytes = 0;
    this.speedSamples = [];
    this.lastProgressTime = Date.now();
    this.lastProgressBytes = 0;
    this.lastReportedPct = -1;

    this.activeWorkers = 0;
    this.isFinished = false;
    this.isAborted = false;

    // Minimum remaining bytes a segment must have to be considered for splitting
    this.MIN_SPLIT_SIZE = 1024 * 1024; // 1 MB

    this.stateFilePath = this.filePath + '.aether-dl';
    this.lastStateSaveTime = 0;
  }

  saveState() {
    try {
      const state = {
        totalBytes: this.totalBytes,
        downloadedBytes: this.downloadedBytes,
        segments: this.segments.map(seg => ({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          current: seg.current,
          status: seg.status === 'completed' ? 'completed' : 'idle' // reset downloading to idle
        }))
      };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state), 'utf8');
    } catch (e) {
      console.warn(`[DynamicDownloader] Failed to save state: ${e.message}`);
    }
  }

  loadState() {
    if (!this.supportsRanges) return false;

    try {
      if (fs.existsSync(this.stateFilePath) && fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf8');
        const state = JSON.parse(data);
        if (state.totalBytes === this.totalBytes) {
          this.downloadedBytes = state.downloadedBytes || 0;
          this.segments = state.segments.map(seg => ({
            ...seg,
            req: null,
            res: null,
            retryCount: 0
          }));
          return true;
        }
      }
    } catch (e) {
      console.warn(`[DynamicDownloader] Failed to load state: ${e.message}`);
    }
    return false;
  }

  async start() {
    try {
      const resumed = this.loadState();

      if (resumed) {
        console.log(`[DynamicDownloader] Resuming download. ${this.downloadedBytes}/${this.totalBytes} bytes already downloaded.`);
        this.fd = fs.openSync(this.filePath, 'r+'); // r+ allows reading and writing without truncation
      } else {
        if (this.totalBytes > 0) {
          // Zero-Merge Disk I/O: Pre-allocate the entire file.
          // Opening with 'w' creates/truncates the file.
          this.fd = fs.openSync(this.filePath, 'w');
          fs.ftruncateSync(this.fd, this.totalBytes);
        } else {
          // Fallback for unknown Content-Length: single thread appending.
          this.fd = fs.openSync(this.filePath, 'w');
          this.maxThreads = 1;
        }

        if (this.totalBytes > 0 && this.maxThreads > 1) {
          const chunkSize = Math.ceil(this.totalBytes / this.maxThreads);
          for (let i = 0; i < this.maxThreads; i++) {
            const start = i * chunkSize;
            const end = (i === this.maxThreads - 1) ? this.totalBytes - 1 : (start + chunkSize - 1);
            if (start <= end) {
              this.segments.push({
                id: i,
                start: start,
                end: end,
                current: start,
                status: 'idle', // 'idle', 'downloading', 'completed'
                req: null,
                res: null,
                retryCount: 0
              });
            }
          }
        } else {
          this.segments.push({
            id: 0,
            start: 0,
            end: this.totalBytes > 0 ? this.totalBytes - 1 : -1,
            current: 0,
            status: 'idle',
            req: null,
            res: null,
            retryCount: 0
          });
        }
        this.saveState(); // Initial save
      }

      // Start all idle segments
      for (const seg of this.segments) {
        this.startWorker(seg);
      }
    } catch (err) {
      this.cleanup();
      this.onError(err);
    }
  }

  startWorker(segment) {
    if (this.checkAborted() || this.isFinished) return;

    if (segment.end !== -1 && segment.current > segment.end) {
      segment.status = 'completed';
      this.checkAndSplit(segment);
      return;
    }

    segment.status = 'downloading';
    this.activeWorkers++;

    const isHttp = this.finalUrl.protocol === 'http:';
    const dlClient = isHttp ? http : https;
    const agent = isHttp ? this.httpAgent : this.httpsAgent;

    const headers = { ...this.headers };
    if (segment.end !== -1) {
      headers['Range'] = `bytes=${segment.current}-${segment.end}`;
    } else if (segment.current > 0) {
      headers['Range'] = `bytes=${segment.current}-`;
    }

    const req = dlClient.request(this.finalUrl, {
      method: 'GET',
      headers: headers,
      agent: agent
    }, (res) => {
      segment.res = res;

      if (this.checkAborted()) {
        res.destroy();
        return;
      }

      if (res.statusCode >= 400 && res.statusCode !== 416) {
        res.resume(); // consume to free socket
        this.handleWorkerError(segment, new Error(`HTTP ${res.statusCode}`));
        return;
      }

      if (res.statusCode === 200 && headers['Range'] && segment.current > 0) {
        res.resume();
        this.handleWorkerError(segment, new Error("Server does not support resuming. Please restart the download."));
        return;
      }

      if (res.statusCode === 416) {
        // Range not satisfiable -> segment is complete
        res.resume();
        segment.status = 'completed';
        this.activeWorkers--;
        this.checkAndSplit(segment);
        return;
      }

      segment.pendingBytes = 0;
      segment.isPaused = false;

      res.on('data', (chunk) => {
        if (this.checkAborted()) {
          res.destroy();
          return;
        }

        const writeOffset = segment.current;
        const bytesWritten = chunk.length;
        
        segment.current += bytesWritten;
        this.downloadedBytes += bytesWritten;
        segment.pendingBytes += bytesWritten;

        // High watermark: if memory buffer exceeds 8MB for this thread, pause network
        if (segment.pendingBytes >= 8 * 1024 * 1024 && !segment.isPaused) {
          segment.isPaused = true;
          res.pause();
        }

        if (this.fd !== null) {
          fsWrite(this.fd, chunk, 0, bytesWritten, writeOffset).then(() => {
            segment.pendingBytes -= bytesWritten;
            
            // Low watermark: if memory buffer drops below 4MB, resume network
            if (segment.pendingBytes < 4 * 1024 * 1024 && segment.isPaused) {
              segment.isPaused = false;
              res.resume();
            }
          }).catch((err) => {
            if (!this.checkAborted()) res.destroy(err);
          });
        } else {
          segment.pendingBytes -= bytesWritten;
        }

        this.reportProgress();

        if (segment.end !== -1 && segment.current > segment.end) {
          res.destroy(); // reached boundary, close gracefully
          return;
        }
      });

      res.on('end', () => {
        if (segment.status !== 'completed' && segment.status !== 'idle') {
          segment.status = 'completed';
          this.activeWorkers--;
          this.checkAndSplit(segment);
        }
      });

      res.on('error', (err) => {
        this.handleWorkerError(segment, err);
      });
    });

    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.on('error', (err) => {
      this.handleWorkerError(segment, err);
    });

    segment.req = req;
    req.end();
  }

  handleWorkerError(segment, err) {
    if (segment.status === 'idle') return; // Purposely destroyed for splitting

    this.activeWorkers--;
    segment.status = 'idle';
    segment.req = null;
    segment.res = null;

    if (this.checkAborted() || this.isFinished) return;

    const isRateLimited = err.message && (err.message.includes('429') || err.message.includes('503'));

    // CDN Throttling Evasion: Backoff and retry
    if (isRateLimited) {
      segment.retryCount++;
      const delay = Math.min(2000 * Math.pow(2, segment.retryCount), 30000);
      console.warn(`[DynamicDownloader] Thread ${segment.id} rate limited (${err.message}). Retrying in ${delay}ms...`);
      setTimeout(() => {
        if (!this.checkAborted() && !this.isFinished) {
          this.startWorker(segment);
        }
      }, delay);
    } else {
      // Normal network error (e.g., ECONNRESET). Wait briefly and retry.
      console.warn(`[DynamicDownloader] Thread ${segment.id} error: ${err.message}. Retrying...`);
      setTimeout(() => {
        if (!this.checkAborted() && !this.isFinished) {
          this.startWorker(segment);
        }
      }, 1000);
    }
  }

  checkAndSplit(idleSegment) {
    if (this.checkAborted() || this.isFinished) return;

    const allDone = this.segments.every(seg => seg.status === 'completed' || (seg.end !== -1 && seg.current > seg.end));

    if (allDone) {
      if (!this.isFinished) {
        this.isFinished = true;
        this.cleanup();
        this.onComplete(this.filePath, this.totalBytes || this.downloadedBytes);
      }
      return;
    }

    // Dynamic Segmentation: Find active segment with the largest remaining payload
    let bestSegment = null;
    let maxRemaining = -1;

    for (const seg of this.segments) {
      if (seg.status === 'downloading' && seg.end !== -1) {
        const remaining = seg.end - seg.current;
        if (remaining > maxRemaining && remaining > this.MIN_SPLIT_SIZE * 2) {
          maxRemaining = remaining;
          bestSegment = seg;
        }
      }
    }

    if (bestSegment) {
      const midpoint = bestSegment.current + Math.floor(maxRemaining / 2);
      const originalEnd = bestSegment.end;

      // 1. Shrink active segment
      bestSegment.end = midpoint;

      // 2. Assign second half to idle segment
      idleSegment.start = midpoint + 1;
      idleSegment.current = midpoint + 1;
      idleSegment.end = originalEnd;
      idleSegment.status = 'idle';
      idleSegment.retryCount = 0;

      console.log(`[DynamicDownloader] Splitting thread ${bestSegment.id} at offset ${midpoint}. Assigning to thread ${idleSegment.id}.`);

      // 3. Gracefully interrupt the active segment so it renegotiates the new boundary
      if (bestSegment.req) {
        bestSegment.status = 'idle';
        bestSegment.req.destroy(); // Will trigger 'error' event, but we check status === 'idle'
        bestSegment.req = null;
        bestSegment.res = null;
        this.activeWorkers--;

        // Restart both
        this.startWorker(bestSegment);
        this.startWorker(idleSegment);
      }
    }
  }

  reportProgress() {
    const now = Date.now();
    if (now - this.lastProgressTime >= 500) {
      const elapsed = (now - this.lastProgressTime) / 1000 || 1;
      const instantaneousBps = (this.downloadedBytes - this.lastProgressBytes) / elapsed;

      this.speedSamples.push(instantaneousBps);
      if (this.speedSamples.length > 8) this.speedSamples.shift();
      const avgBps = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;

      const percent = this.totalBytes > 0 ? Math.round((this.downloadedBytes / this.totalBytes) * 100) : 0;

      if (percent >= this.lastReportedPct) {
        this.lastReportedPct = percent;
        this.onProgress(this.downloadedBytes, this.totalBytes, avgBps, percent);
      }

      if (now - this.lastStateSaveTime > 2000) {
        this.saveState();
        this.lastStateSaveTime = now;
      }

      this.lastProgressTime = now;
      this.lastProgressBytes = this.downloadedBytes;
    }
  }

  checkAborted() {
    if (this.isAborted || (this.abortController && this.abortController.aborted)) {
      if (!this.isAborted) {
        this.abort();
      }
      return true;
    }
    return false;
  }

  abort() {
    this.isAborted = true;
    this.saveState();
    this.cleanup();
  }

  cleanup() {
    for (const seg of this.segments) {
      if (seg.req) {
        seg.status = 'idle';
        try { seg.req.destroy(); } catch (e) { }
        seg.req = null;
        seg.res = null;
      }
    }
    if (this.fd !== null) {
      try { fs.closeSync(this.fd); } catch (e) { }
      this.fd = null;
    }
    if (this.isFinished) {
      try { fs.unlinkSync(this.stateFilePath); } catch (e) { }
    }
  }
}

module.exports = DynamicDownloader;
