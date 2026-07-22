/**
 * Subtitles resource handler (task 7 wiring).
 *
 * Implements the Stremio `defineSubtitlesHandler` callback: parse the request
 * (type, id, extra args, config), then run the
 * search → select-reference → sync → cache pipeline and return subtitle
 * objects whose URLs point at the addon's own `/sub/<videoKey>/<subId>.<ext>`
 * file-serving endpoint.
 *
 * The heavy dependencies (ProviderRegistry, CacheStore, ffsubsync probe) are
 * injected so the handler stays unit-testable and the server can share a
 * single cache instance across the `/sub/` and `/health` endpoints.
 */

import { createHash } from 'node:crypto';

import { parseConfig } from '../config.js';
import { selectReference, compositeScore } from '../sync/reference.js';
import { syncSubtitles } from '../sync/engine.js';
import { checkFfsubsyncAvailable } from '../sync/ffsubsync.js';

/** 24h client-side caching for Stremio, per the addon-server spec. */
export const CACHE_MAX_AGE = 86400;

/**
 * Parse a Stremio video id into its components.
 *
 * Movie:  `tt1234567`       → { imdbId: 'tt1234567' }
 * Series: `tt1234567:1:5`   → { imdbId: 'tt1234567', season: 1, episode: 5 }
 *
 * @param {'movie'|'series'} type
 * @param {string} id
 * @returns {{ type: 'movie'|'series', imdbId: string|null, season?: number, episode?: number }}
 */
export function parseVideoId(type, id) {
  const parts = String(id ?? '').split(':');
  const imdbId = /^tt\d+$/i.test(parts[0]) ? parts[0] : null;

  const result = {
    type: type === 'series' ? 'series' : 'movie',
    imdbId,
    season: undefined,
    episode: undefined,
  };

  if (result.type === 'series' && parts.length >= 3) {
    const season = Number(parts[1]);
    const episode = Number(parts[2]);
    if (Number.isInteger(season) && season >= 0) result.season = season;
    if (Number.isInteger(episode) && episode >= 0) result.episode = episode;
  }

  return result;
}

/**
 * Make a value safe for use as a single URL / filesystem path segment.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}

/**
 * Determine the cache directory / URL key for a request.
 *
 * Prefers the OpenSubtitles `videoHash`. When it is absent (filename-only
 * search), derives a stable 16-char hex key from the filename or the
 * IMDB/season/episode tuple so cached files and `/sub/` URLs stay consistent.
 *
 * @returns {string|null} null when nothing usable was provided.
 */
export function resolveVideoKey({ videoHash, filename, imdbId, season, episode }) {
  if (videoHash) return sanitizeSegment(videoHash);

  const seedParts = [];
  if (imdbId) seedParts.push(imdbId);
  if (season != null) seedParts.push(`s${season}`);
  if (episode != null) seedParts.push(`e${episode}`);
  const seed = filename || seedParts.join(':');
  if (!seed) return null;

  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

/** Return the string value or undefined when empty/blank. */
function nonEmpty(value) {
  if (value == null) return undefined;
  const str = String(value).trim();
  return str === '' ? undefined : str;
}

/** Choose the cache/URL file extension for a candidate ('.srt' or '.ass'). */
function extOf(candidate) {
  const name = (candidate?.filename || '').toLowerCase();
  if (name.endsWith('.ass') || name.endsWith('.ssa')) return '.ass';
  return '.srt';
}

/** Group subtitles by their (normalized) language code. */
function groupByLang(subs) {
  const groups = new Map();
  for (const sub of subs) {
    const lang = sub.lang || '';
    if (!groups.has(lang)) groups.set(lang, []);
    groups.get(lang).push(sub);
  }
  return groups;
}

/**
 * Pick the single best candidate to serve unsynced. Mirrors the reference
 * cascade but always returns one candidate for a non-empty list.
 */
function pickBest(candidates, filename) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return (
    selectReference(candidates, filename) ??
    candidates.reduce((best, c) => (compositeScore(c) > compositeScore(best) ? c : best))
  );
}

/** Download all candidates, dropping (and logging) any that fail. */
async function downloadAll(candidates, registry) {
  const settled = await Promise.all(
    candidates.map(async (cand) => {
      try {
        const content = await registry.download(cand);
        return { ...cand, content };
      } catch (err) {
        console.error(
          `Download failed for ${cand.provider ?? '?'}/${cand.id}: ${err?.message ?? err}`,
        );
        return null;
      }
    }),
  );
  return settled.filter(Boolean);
}

/** Cache one subtitle and push its response object. */
async function cacheAndEmit({ cache, subtitles, videoKey, candidate, content, meta }) {
  const sid = sanitizeSegment(candidate.id);
  const ext = extOf(candidate);
  try {
    await cache.put(videoKey, sid, content, meta, ext);
  } catch (err) {
    console.error(`Cache put failed for ${sid}: ${err?.message ?? err}`);
    return;
  }
  subtitles.push({ id: sid, url: `/sub/${videoKey}/${sid}${ext}`, lang: candidate.lang });
}

/**
 * Sync-enabled path: download the group, sync every candidate against the
 * reference, cache and serve each result (the reference is stored unsynced).
 */
async function processSyncGroup({
  uncached, reference, filename, config, videoKey, cache, registry, subtitles,
}) {
  const withContent = await downloadAll(uncached, registry);
  if (withContent.length === 0) return;

  const refWithContent = withContent.find((c) => c.id === reference.id) ?? null;

  // If the reference itself failed to download we cannot sync — fall back to
  // serving the best candidate unsynced.
  if (!refWithContent) {
    await processBest({ uncached: withContent, filename, videoKey, cache, registry, subtitles });
    return;
  }

  let results;
  try {
    results = await syncSubtitles(withContent, refWithContent, filename, config);
  } catch (err) {
    console.error(`Sync failed: ${err?.message ?? err}`);
    await processBest({ uncached: withContent, filename, videoKey, cache, registry, subtitles });
    return;
  }

  const byId = new Map(withContent.map((c) => [c.id, c]));
  for (const result of results) {
    const cand = byId.get(result.id);
    if (!cand) continue;
    await cacheAndEmit({
      cache, subtitles, videoKey,
      candidate: { ...cand, lang: result.lang ?? cand.lang },
      content: result.content,
      meta: {
        offsetSeconds: result.offsetSeconds ?? null,
        framerateScaleFactor: result.framerateScaleFactor ?? null,
        referenceId: reference.id,
        syncedAt: new Date().toISOString(),
        providerSyncedFrom: cand.provider ?? null,
        synced: Boolean(result.synced),
        lang: result.lang ?? cand.lang,
      },
    });
  }
}

/**
 * No-sync path (sync disabled, single candidate, or ffsubsync unavailable):
 * serve the best candidate directly without running ffsubsync.
 */
async function processBest({ uncached, filename, videoKey, cache, registry, subtitles }) {
  const best = pickBest(uncached, filename);
  if (!best) return;

  let content = best.content;
  if (content == null) {
    try {
      content = await registry.download(best);
    } catch (err) {
      console.error(
        `Download failed for ${best.provider ?? '?'}/${best.id}: ${err?.message ?? err}`,
      );
      return;
    }
  }

  await cacheAndEmit({
    cache, subtitles, videoKey,
    candidate: best,
    content,
    meta: {
      offsetSeconds: null,
      framerateScaleFactor: null,
      referenceId: null,
      syncedAt: new Date().toISOString(),
      providerSyncedFrom: best.provider ?? null,
      synced: false,
      lang: best.lang,
    },
  });
}

/**
 * Create the subtitles handler callback.
 *
 * @param {object} deps
 * @param {import('../providers/index.js').ProviderRegistry} [deps.registry]
 *   Fixed registry (mainly for tests). When omitted, `deps.createRegistry`
 *   builds one per request from the request config so that per-install API
 *   keys (passed by Stremio in the URL config) are honoured.
 * @param {(config: object) => import('../providers/index.js').ProviderRegistry} [deps.createRegistry]
 *   Factory used to build a registry from the per-request config.
 * @param {import('../cache/store.js').CacheStore} deps.cache
 * @param {() => Promise<boolean>} [deps.checkFfsubsync] ffsubsync availability probe.
 * @returns {(args: object) => Promise<{ subtitles: object[], cacheMaxAge: number }>}
 */
export function createSubtitlesHandler(deps = {}) {
  const { cache, checkFfsubsync = checkFfsubsyncAvailable } = deps;
  const fixedRegistry = deps.registry ?? null;
  const createRegistry = typeof deps.createRegistry === 'function' ? deps.createRegistry : null;

  if (!fixedRegistry && !createRegistry) {
    throw new TypeError('createSubtitlesHandler: "registry" or "createRegistry" is required');
  }
  if (!cache) throw new TypeError('createSubtitlesHandler: "cache" is required');

  // Memoize the ffsubsync probe so we only spawn `which` once per process.
  let ffAvailability = null;
  async function isSyncAvailable() {
    if (ffAvailability === null) {
      try {
        ffAvailability = Boolean(await checkFfsubsync());
      } catch {
        ffAvailability = false;
      }
    }
    return ffAvailability;
  }

  return async function subtitlesHandler(args = {}) {
    const config = parseConfig(args.config ?? {});
    // Build the registry from the per-request config so API keys supplied via
    // the Stremio install URL are picked up. Tests may inject a fixed registry.
    const registry = createRegistry ? createRegistry(config) : fixedRegistry;
    const extra = args.extra ?? {};
    const parsed = parseVideoId(args.type, args.id);

    const videoHash = nonEmpty(extra.videoHash);
    const filename = nonEmpty(extra.filename);
    const videoSize =
      extra.videoSize != null && String(extra.videoSize).trim() !== ''
        ? Number(extra.videoSize)
        : undefined;

    const empty = { subtitles: [], cacheMaxAge: CACHE_MAX_AGE };

    const videoKey = resolveVideoKey({
      videoHash,
      filename,
      imdbId: parsed.imdbId,
      season: parsed.season,
      episode: parsed.episode,
    });
    if (!videoKey) return empty;

    // No providers configured → nothing to search.
    if (Array.isArray(registry.providers) && registry.providers.length === 0) {
      return empty;
    }

    const query = {
      type: parsed.type,
      imdbId: parsed.imdbId ?? undefined,
      videoHash,
      videoSize,
      filename,
      season: parsed.season,
      episode: parsed.episode,
      languages: config.languages,
    };

    let candidates;
    try {
      candidates = await registry.searchAll(query);
    } catch (err) {
      console.error(`Subtitle search failed: ${err?.message ?? err}`);
      return empty;
    }
    if (!Array.isArray(candidates) || candidates.length === 0) return empty;

    const syncAvailable = await isSyncAvailable();
    if (config.syncEnabled && !syncAvailable) {
      console.warn('ffsubsync is not available; serving unsynced subtitles');
    }

    const subtitles = [];

    for (const group of groupByLang(candidates).values()) {
      // Cache check per known subId; cached entries are served directly.
      const uncached = [];
      for (const cand of group) {
        const sid = sanitizeSegment(cand.id);
        if (await cache.has(videoKey, sid)) {
          subtitles.push({
            id: sid,
            url: `/sub/${videoKey}/${sid}${extOf(cand)}`,
            lang: cand.lang,
          });
        } else {
          uncached.push(cand);
        }
      }
      if (uncached.length === 0) continue;

      const reference = selectReference(uncached, filename);
      const syncMode = config.syncEnabled && syncAvailable && reference !== null;

      if (syncMode) {
        await processSyncGroup({
          uncached, reference, filename, config, videoKey, cache, registry, subtitles,
        });
      } else {
        await processBest({
          uncached, filename, videoKey, cache, registry, subtitles,
        });
      }
    }

    return { subtitles, cacheMaxAge: CACHE_MAX_AGE };
  };
}
