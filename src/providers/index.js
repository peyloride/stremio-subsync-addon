/**
 * Provider registry: instantiates the enabled providers, searches them in
 * parallel with a per-provider timeout, merges and deduplicates the results,
 * and delegates downloads to the owning provider.
 *
 * A provider that errors or times out is logged and excluded; it never fails
 * the whole search.
 */

import { normalizeLang } from '../utils/language.js';
import { matchScore } from '../utils/release-match.js';
import { validateProvider } from './base.js';
import { OpenSubtitlesProvider } from './opensubtitles.js';
import { SubDLProvider } from './subdl.js';
import { SubsourceProvider } from './subsource.js';
import { PodnapisiProvider } from './podnapisi.js';

export {
  OpenSubtitlesProvider,
  SubDLProvider,
  SubsourceProvider,
  PodnapisiProvider,
};

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Build the default provider list from config. Keyed providers (OpenSubtitles,
 * SubDL) are only included when their API key is configured; keyless providers
 * (Subsource, Podnapisi) are always included.
 *
 * @param {object} config
 * @returns {import('./base.js').SubtitleProvider[]}
 */
export function createDefaultProviders(config = {}) {
  const providers = [];
  if (config.opensubtitlesApiKey) providers.push(new OpenSubtitlesProvider(config));
  if (config.subdlApiKey) providers.push(new SubDLProvider(config));
  providers.push(new SubsourceProvider(config));
  providers.push(new PodnapisiProvider(config));
  return providers;
}

/**
 * Race a promise against a timeout. The timer is always cleared on settle so
 * it never keeps the event loop alive.
 */
function withTimeout(promise, ms, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Provider "${name}" timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Composite popularity score: downloads × rating when both exist, else downloads. */
function compositeScore(sub) {
  const downloads = typeof sub.downloads === 'number' ? sub.downloads : 0;
  const rating = typeof sub.rating === 'number' ? sub.rating : 0;
  return downloads > 0 && rating > 0 ? downloads * rating : downloads;
}

/** Release-name match score against the queried video filename (0 when n/a). */
function releaseScore(sub, query) {
  if (query?.filename && sub.releaseName) {
    return matchScore(query.filename, sub.releaseName);
  }
  return 0;
}

/**
 * Dedup priority: hash match > release-name match > composite score.
 * Returns true when `a` should replace `b`.
 */
function isBetterMatch(a, b, query) {
  if (Boolean(a.hashMatch) !== Boolean(b.hashMatch)) return Boolean(a.hashMatch);
  const ra = releaseScore(a, query);
  const rb = releaseScore(b, query);
  if (ra !== rb) return ra > rb;
  return compositeScore(a) > compositeScore(b);
}

function dedupKey(sub) {
  return sub.url || `${sub.provider}:${sub.id}`;
}

/**
 * Deduplicate by download URL, keeping the highest-priority entry per URL.
 * @param {import('./base.js').ProviderSubtitle[]} subs
 * @param {import('./base.js').SubtitleQuery} query
 */
function deduplicate(subs, query) {
  const best = new Map();
  for (const sub of subs) {
    const key = dedupKey(sub);
    const existing = best.get(key);
    if (!existing || isBetterMatch(sub, existing, query)) {
      best.set(key, sub);
    }
  }
  return [...best.values()];
}

export class ProviderRegistry {
  /**
   * @param {object} [config] - Addon config (see src/config.js).
   * @param {object} [options]
   * @param {number} [options.timeoutMs] - Per-provider search timeout (default 10000).
   * @param {import('./base.js').SubtitleProvider[]} [options.providers] - Override
   *   the default provider list (primarily for testing).
   */
  constructor(config = {}, options = {}) {
    this.config = config;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const providers = options.providers ?? createDefaultProviders(config);
    this.providers = providers.filter((provider) => validateProvider(provider));
  }

  /**
   * Search all providers in parallel. Failures/timeouts are logged and
   * excluded. Results are language-normalized and deduplicated by URL.
   *
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async searchAll(query) {
    const settled = await Promise.allSettled(
      this.providers.map((provider) =>
        withTimeout(
          Promise.resolve().then(() => provider.search(query)),
          this.timeoutMs,
          provider.name,
        ),
      ),
    );

    const merged = [];
    settled.forEach((result, index) => {
      const provider = this.providers[index];
      if (result.status === 'fulfilled') {
        if (Array.isArray(result.value)) merged.push(...result.value);
      } else {
        const message = result.reason?.message ?? String(result.reason);
        console.error(`Provider "${provider.name}" search failed: ${message}`);
      }
    });

    for (const sub of merged) {
      sub.lang = normalizeLang(sub.lang);
    }

    return deduplicate(merged, query);
  }

  /**
   * Download a subtitle via the provider named by `sub.provider`.
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    if (!sub || typeof sub.provider !== 'string') {
      throw new Error('download: subtitle is missing a provider');
    }
    const provider = this.providers.find((p) => p.name === sub.provider);
    if (!provider) {
      throw new Error(`download: unknown provider "${sub.provider}"`);
    }
    return provider.download(sub);
  }
}
