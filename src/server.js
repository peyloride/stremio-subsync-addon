import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';
// The SDK is CommonJS and its ESM interop only exposes the default export
// reliably, so destructure from there.
import stremioAddonSdk from 'stremio-addon-sdk';

const { addonBuilder, getRouter } = stremioAddonSdk;

import { parseConfig } from './config.js';
import { manifest } from './manifest.js';
import { createHealthHandler } from './handlers/health.js';
import { createSubFileHandler } from './handlers/sub.js';
import { createConfigureHandler } from './handlers/configure.js';
import { createSubtitlesHandler } from './handlers/subtitles.js';
import { ProviderRegistry } from './providers/index.js';
import { CacheStore } from './cache/store.js';
import { checkFfsubsyncAvailable } from './sync/ffsubsync.js';

// 24h client-side caching for Stremio, per the addon-server spec.
const DEFAULT_CACHE_MAX_AGE = 86400;

/**
 * Build the Stremio addon interface around the real subtitles handler
 * (search → select-reference → sync → cache pipeline, task 7).
 *
 * @param {(args: object) => Promise<object>} subtitlesHandler
 */
export function buildAddonInterface(subtitlesHandler) {
  const builder = new addonBuilder(manifest);
  builder.defineSubtitlesHandler(subtitlesHandler);
  return builder.getInterface();
}

/**
 * Assemble the express app: the addon's own /health and /sub/ endpoints plus
 * the Stremio protocol routes from the SDK router.
 *
 * The SDK's serveHTTP() resolves to { url, server } without exposing the
 * express app, so custom endpoints cannot be mounted on it. getRouter() is
 * the same router serveHTTP mounts internally.
 */
export function createApp(config = parseConfig(), deps = {}) {
  // Share a single cache instance across the subtitles handler, the /sub/
  // file-serving endpoint and the /health stats. Dependencies are injectable
  // for testing.
  const cache = deps.cache ?? new CacheStore(config.cacheDir, config.cacheTtlDays);
  const registry = deps.registry ?? new ProviderRegistry(config);
  const checkFfsubsync = deps.checkFfsubsync ?? checkFfsubsyncAvailable;

  const subtitlesHandler = createSubtitlesHandler({ registry, cache, checkFfsubsync });

  const app = express();

  // Cache-Control: no-store for manifest (Stremio needs fresh manifests),
  // long cache for everything else.
  app.use((req, res, next) => {
    if (!res.getHeader('Cache-Control')) {
      if (req.path.endsWith('/manifest.json')) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader('Cache-Control', `max-age=${DEFAULT_CACHE_MAX_AGE}, public`);
      }
    }
    next();
  });

  app.get('/health', createHealthHandler({ checkAvailability: checkFfsubsync, cache }));
  app.get('/configure', createConfigureHandler(manifest));
  app.get('/sub/:videoHash/:subtitleId', createSubFileHandler(cache.cacheDir));
  app.use(getRouter(buildAddonInterface(subtitlesHandler)));

  return app;
}

/**
 * Start listening on the configured port. Resolves once the server is
 * accepting connections.
 */
export function startServer(config = parseConfig()) {
  const app = createApp(config);
  const server = app.listen(config.port);

  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve({ app, server, config }));
    server.once('error', reject);
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  startServer()
    .then(({ server }) => {
      const { port } = server.address();
      console.log(
        `stremio-subsync-addon v${manifest.version} listening at http://127.0.0.1:${port}/manifest.json`,
      );
    })
    .catch((error) => {
      console.error('Failed to start stremio-subsync-addon:', error);
      process.exitCode = 1;
    });
}
