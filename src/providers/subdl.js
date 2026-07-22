/**
 * SubDL API provider.
 *
 * API docs: https://subdl.com/page/api
 * Base URL: https://api.subdl.com/api/v1/
 *
 * Requires a user-supplied API key (`config.subdlApiKey`). When the key is
 * missing the provider is skipped silently (search returns []).
 *
 * Search: GET /subtitles?api_key=&imdb_id=<tt...>&languages= with optional
 * season_number/episode_number for series. The response has a `subtitles`
 * array; each entry carries a relative `url` (e.g. "/subtitle/xyz.zip")
 * which is resolved against the download host.
 */

import { normalizeLang } from '../utils/language.js';
import { fetchLogged, logEvent } from '../utils/logging.js';

const BASE_URL = 'https://api.subdl.com/api/v1';
const DOWNLOAD_HOST = 'https://dl.subdl.com';
const REQUEST_TIMEOUT_MS = 10000;

export class SubDLProvider {
  /**
   * @param {object} [config]
   * @param {string} [config.subdlApiKey]
   */
  constructor(config = {}) {
    this.name = 'subdl';
    this.apiKey = config.subdlApiKey || '';
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async search(query) {
    if (!this.apiKey) return [];
    if (!query.imdbId) return [];

    const params = new URLSearchParams();
    params.set('api_key', this.apiKey);
    // SubDL expects the IMDB id with the `tt` prefix.
    params.set('imdb_id', String(query.imdbId));
    const langs = (query.languages || []).join(',');
    if (langs) params.set('languages', langs);

    if (query.type === 'series') {
      if (query.season != null) params.set('season_number', String(query.season));
      if (query.episode != null) params.set('episode_number', String(query.episode));
    }

    const url = `${BASE_URL}/subtitles?${params.toString()}`;
    const res = await fetchLogged(this.name, url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, { requestId: query.requestId, action: 'search' });
    if (!res.ok) {
      throw new Error(`SubDL API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    const results = this._normalize(json);
    logEvent('provider_result_count', {
      requestId: query.requestId ?? null,
      provider: this.name,
      action: 'search',
      resultCount: results.length,
      apiStatus: json?.status ?? null,
      apiError: json?.error ?? null,
    });
    return results;
  }

  _normalize(json) {
    // SubDL returns matched media in `results` and the actual subtitle files
    // in `subtitles`.
    const subs = Array.isArray(json?.subtitles) ? json.subtitles : [];

    return subs.map((r) => {
      // The url is relative and already carries the api_key query param.
      const relUrl = r.url || '';
      // Derive a stable id from the url basename (e.g. "/subtitle/123-456.zip"
      // -> "123-456").
      const base = (relUrl.split('?')[0].split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
      const id = String(r.id ?? base);
      return {
        id,
        provider: this.name,
        lang: normalizeLang(r.language ?? r.lang),
        url: relUrl ? `${DOWNLOAD_HOST}${relUrl}` : '',
        filename: r.name || '',
        releaseName: r.release_name || r.name || '',
        hashMatch: false,
        downloads: r.downloads ?? 0,
        rating: Number(r.rating) || 0,
        hearingImpaired: Boolean(r.hi),
        forced: false,
      };
    });
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    if (!sub?.url) throw new Error('SubDL download: missing url');

    const res = await fetchLogged(this.name, sub.url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, { requestId: sub.requestId, action: 'download' });
    if (!res.ok) {
      throw new Error(`SubDL download failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
