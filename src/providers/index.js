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
import { errorDetails, logEvent } from '../utils/logging.js';
import { validateProvider } from './base.js';
import { OpenSubtitlesProvider } from './opensubtitles.js';
import { SubDLProvider } from './subdl.js';
import { SubsourceProvider } from './subsource.js';

export {
  OpenSubtitlesProvider,
  SubDLProvider,
  SubsourceProvider,
};

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Build the default provider list from config. Modern providers are only
 * included when their application API key is configured. OpenSubtitles uses
 * api.opensubtitles.com; the deprecated legacy REST fallback is intentionally
 * not instantiated.
 *
 * @param {object} config
 * @returns {import('./base.js').SubtitleProvider[]}
 */
export function createDefaultProviders(config = {}) {
  const providers = [];
  if (config.opensubtitlesApiKey) providers.push(new OpenSubtitlesProvider(config));
  if (config.subdlApiKey) providers.push(new SubDLProvider(config));
  if (config.subsourceApiKey) providers.push(new SubsourceProvider(config));
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
      this.providers.map((provider) => {
        logEvent('provider_search_start', {
          requestId: query.requestId ?? null,
          provider: provider.name,
          type: query.type ?? null,
          imdbId: query.imdbId ?? null,
          season: query.season ?? null,
          episode: query.episode ?? null,
          languages: query.languages ?? [],
          hasVideoHash: Boolean(query.videoHash),
          hasFilename: Boolean(query.filename),
        });
        return withTimeout(
          Promise.resolve().then(() => provider.search(query)),
          this.timeoutMs,
          provider.name,
        );
      }),
    );

    const merged = [];
    settled.forEach((result, index) => {
      const provider = this.providers[index];
      if (result.status === 'fulfilled') {
        const providerResults = Array.isArray(result.value) ? result.value : [];
        logEvent('provider_search_complete', {
          requestId: query.requestId ?? null,
          provider: provider.name,
          resultCount: providerResults.length,
        });
        merged.push(...providerResults.map((sub) => ({ ...sub, requestId: query.requestId ?? null })));
      } else {
        const reason = result.reason;
        logEvent('provider_search_error', {
          requestId: query.requestId ?? null,
          provider: provider.name,
          ...errorDetails(reason),
        }, 'error');
      }
    });

    for (const sub of merged) {
      sub.lang = normalizeLang(sub.lang);
    }

    const deduplicated = deduplicate(merged, query);
    logEvent('provider_search_merged', {
      requestId: query.requestId ?? null,
      providerCount: this.providers.length,
      rawResultCount: merged.length,
      resultCount: deduplicated.length,
    });
    return deduplicated;
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
    const requestId = sub.requestId ?? null;
    const started = Date.now();
    logEvent('provider_download_start', {
      requestId,
      provider: provider.name,
      subtitleId: sub.id ?? null,
    });
    try {
      const content = await provider.download(sub);
      logEvent('provider_download_complete', {
        requestId,
        provider: provider.name,
        subtitleId: sub.id ?? null,
        bytes: content?.length ?? 0,
        durationMs: Date.now() - started,
      });
      return content;
    } catch (error) {
      logEvent('provider_download_error', {
        requestId,
        provider: provider.name,
        subtitleId: sub.id ?? null,
        durationMs: Date.now() - started,
        ...errorDetails(error),
      }, 'error');
      throw error;
    }
  }
}
