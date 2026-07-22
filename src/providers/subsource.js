/**
 * Subsource provider (v1 API).
 *
 * Base URL: https://api.subsource.net/api/v1
 * Requires API key via X-API-Key header (free at subsource.net profile page).
 *
 * Search: GET /subtitles?movieName=<linkName>&season=<n>&language=<lang>
 * Download: GET /subtitles/{id}/download
 */

import { normalizeLang } from '../utils/language.js';

const BASE_URL = 'https://api.subsource.net/api/v1';
const REQUEST_TIMEOUT_MS = 10000;

export class SubsourceProvider {
  constructor(config = {}) {
    this.name = 'subsource';
    this.apiKey = config.subsourceApiKey || '';
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
  */
  async search(query) {
    if (!this.apiKey) return [];
    if (!query.imdbId) return [];

    // First resolve the movie/show linkName from IMDB ID
    const linkName = await this._resolveLinkName(query);
    if (!linkName) return [];

    const params = new URLSearchParams();
    params.set('movieName', linkName);
    if (query.type === 'series' && query.season != null) {
      params.set('season', String(query.season));
    }
    for (const lang of query.languages || []) {
      params.append('language', lang);
    }

    const res = await globalThis.fetch(`${BASE_URL}/subtitles?${params}`, {
      headers: {
        'X-API-Key': this.apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Subsource API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    return this._normalize(json);
  }

  async _resolveLinkName(query) {
    try {
      const params = new URLSearchParams();
      params.set('query', query.imdbId);
      const res = await globalThis.fetch(`${BASE_URL}/movies/search?${params}`, {
        headers: {
          'X-API-Key': this.apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const items = json?.items || json?.results || json?.movies || [];
      if (items.length === 0) return null;
      return items[0].linkName || items[0].link_name || items[0].slug || null;
    } catch {
      return null;
    }
  }

  _normalize(json) {
    const subs = json?.items || json?.subtitles || json?.results || [];
    if (!Array.isArray(subs)) return [];

    return subs.map((s) => {
      const id = String(s.id ?? '');
      return {
        id,
        provider: this.name,
        lang: normalizeLang(s.language ?? s.lang),
        url: id ? `${BASE_URL}/subtitles/${id}/download` : '',
        filename: s.fileName || s.file_name || s.release || '',
        releaseName: s.release || s.releaseName || '',
        hashMatch: false,
        downloads: s.downloads ?? 0,
        rating: Number(s.rating) || 0,
        hearingImpaired: Boolean(s.hi ?? s.hearingImpaired),
        forced: Boolean(s.forced),
      };
    });
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    if (!sub?.url) throw new Error('Subsource download: missing url');

    const res = await globalThis.fetch(sub.url, {
      headers: { 'X-API-Key': this.apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Subsource download failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
