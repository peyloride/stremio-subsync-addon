/**
 * Subsource API provider.
 *
 * Base URL: https://subsource.net/api/
 * No API key required.
 *
 * Search: POST /searchSubtitles with { imdbId, languages, season?, episode? }.
 * Download: POST /downloadSub with { subId } returns a temporary `link`,
 * which is then fetched for the raw bytes. Because the real download URL is
 * not known at search time, results carry a synthetic URL of the form
 * `subsource://sub/<id>` and the numeric sub id is also stored in `id`.
 */

import { normalizeLang } from '../utils/language.js';

const BASE_URL = 'https://subsource.net/api';
const REQUEST_TIMEOUT_MS = 10000;
/** Synthetic scheme prefix used to carry the sub id inside ProviderSubtitle.url. */
export const DOWNLOAD_SCHEME = 'subsource://sub/';

/** Extract the sub id from a ProviderSubtitle (url scheme or id). */
function parseSubId(sub) {
  if (sub?.url && sub.url.startsWith(DOWNLOAD_SCHEME)) {
    return sub.url.slice(DOWNLOAD_SCHEME.length);
  }
  return sub?.id != null ? String(sub.id) : '';
}

export class SubsourceProvider {
  constructor(_config = {}) {
    this.name = 'subsource';
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async search(query) {
    if (!query.imdbId) return [];

    const body = {
      imdbId: query.imdbId,
      languages: query.languages || [],
    };
    if (query.type === 'series') {
      if (query.season != null) body.season = query.season;
      if (query.episode != null) body.episode = query.episode;
    }

    const res = await globalThis.fetch(`${BASE_URL}/searchSubtitles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Subsource API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    return this._normalize(json);
  }

  _normalize(json) {
    const subs = Array.isArray(json?.subs)
      ? json.subs
      : Array.isArray(json?.results)
        ? json.results
        : [];

    return subs.map((s) => {
      const id = String(s.id ?? s.subId ?? '');
      return {
        id,
        provider: this.name,
        lang: normalizeLang(s.language ?? s.lang),
        url: id ? `${DOWNLOAD_SCHEME}${id}` : '',
        filename: s.file_name || s.release || '',
        releaseName: s.release || s.release_name || '',
        hashMatch: false,
        downloads: s.downloads ?? 0,
        rating: Number(s.rating) || 0,
        hearingImpaired: Boolean(s.hi ?? s.hearing_impaired),
        forced: Boolean(s.forced),
      };
    });
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    const subId = parseSubId(sub);
    if (!subId) throw new Error('Subsource download: missing sub id');

    const res = await globalThis.fetch(`${BASE_URL}/downloadSub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ subId: Number(subId) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Subsource API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    const link = json?.link;
    if (!link) throw new Error('Subsource download: no link returned');

    const fileRes = await globalThis.fetch(link, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!fileRes.ok) {
      throw new Error(`Subsource download failed: HTTP ${fileRes.status}`);
    }
    return Buffer.from(await fileRes.arrayBuffer());
  }
}
