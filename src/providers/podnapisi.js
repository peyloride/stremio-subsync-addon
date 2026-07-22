/**
 * Podnapisi provider.
 *
 * Base URL: https://www.podnapisi.net/
 * No API key required.
 *
 * Search: GET /en/subtitles/search/advanced?movie=<imdb>&language=<lang>&json
 * (the `language` param is repeated per language; `json` requests JSON output).
 * Download: GET the subtitle's download URL (…/en/subtitles/<id>/download),
 * which typically returns a ZIP archive. Archive extraction is handled later
 * in the pipeline; this provider returns the raw bytes.
 */

import { normalizeLang } from '../utils/language.js';

const BASE_URL = 'https://www.podnapisi.net';
const SEARCH_PATH = '/en/subtitles/search/advanced';
const REQUEST_TIMEOUT_MS = 10000;

export class PodnapisiProvider {
  constructor(_config = {}) {
    this.name = 'podnapisi';
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async search(query) {
    if (!query.imdbId) return [];

    const params = new URLSearchParams();
    params.set('movie', String(query.imdbId));
    for (const lang of query.languages || []) {
      params.append('language', lang);
    }
    params.set('json', '');

    const res = await globalThis.fetch(`${BASE_URL}${SEARCH_PATH}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Podnapisi API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    return this._normalize(json);
  }

  _normalize(json) {
    const results = Array.isArray(json?.results) ? json.results : [];

    return results.map((r) => {
      const id = String(r.id ?? '');
      const flags = Array.isArray(r.flags) ? r.flags : [];
      const downloadUrl = id ? `${BASE_URL}/en/subtitles/${id}/download` : '';

      return {
        id,
        provider: this.name,
        lang: normalizeLang(r.language),
        url: downloadUrl,
        filename: r.filename || r.release || '',
        releaseName: r.release || '',
        hashMatch: false,
        downloads: r.downloads ?? 0,
        rating: Number(r.rating) || 0,
        hearingImpaired: Boolean(r.hearing_impaired ?? flags.includes('hearing_impaired')),
        forced: Boolean(r.forced ?? flags.includes('forced')),
      };
    });
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    if (!sub?.url) throw new Error('Podnapisi download: missing url');

    const res = await globalThis.fetch(sub.url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Podnapisi download failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
