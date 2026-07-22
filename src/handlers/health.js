import { spawn } from 'node:child_process';

import { manifest } from '../manifest.js';

/**
 * Resolve true when the ffsubsync CLI is available on PATH.
 */
export function checkFfsubsyncAvailable() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('which', ['ffsubsync'], { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

/**
 * GET /health — liveness, ffsubsync availability and cache stats.
 *
 * The availability probe runs once per process and is memoized. When a
 * CacheStore is supplied its live stats are reported; otherwise cache counts
 * fall back to zeros.
 */
export function createHealthHandler({ checkAvailability = checkFfsubsyncAvailable, cache = null } = {}) {
  let availability;

  return async function healthHandler(_req, res) {
    if (!availability) {
      availability = checkAvailability();
    }

    let available = false;
    try {
      available = await availability;
    } catch {
      available = false;
    }

    let cacheStats = { entries: 0, sizeBytes: 0 };
    if (cache && typeof cache.stats === 'function') {
      try {
        cacheStats = await cache.stats();
      } catch {
        cacheStats = { entries: 0, sizeBytes: 0 };
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: available ? 'ok' : 'degraded',
      version: manifest.version,
      cache: cacheStats,
      ...(available
        ? {}
        : { warning: 'ffsubsync not found on PATH; subtitles are served unsynced' }),
    });
  };
}
