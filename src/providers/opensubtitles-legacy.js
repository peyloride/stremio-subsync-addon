/**
 * OpenSubtitles legacy REST provider (rest.opensubtitles.org).
 *
 * No API key required. Only needs a User-Agent header.
 * This is the same API the official Stremio subtitles addon uses.
 *
 * Search by IMDB: GET /search/imdbid-<id>/sublanguageid-<lang>
 * Search by hash: GET /search/moviehash-<hash>/moviebytesize-<size>/sublanguageid-<lang>
 * Download: SubDownloadLink field (gzipped SRT)
 *
 * Rate limit: ~20 requests/IP without auth. Be conservative.
 */

import { gunzipSync } from 'node:zlib';
import { normalizeLang } from '../utils/language.js';

const BASE_URL = 'https://rest.opensubtitles.org';
const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'stremio-subsync-addon v1.0';

/** Map ISO 639-1 to OpenSubtitles legacy language IDs. */
const LANG_MAP = {
  en: 'eng', ar: 'ara', zh: 'chi', cs: 'cze', da: 'dan', nl: 'dut',
  fi: 'fin', fr: 'fre', de: 'ger', el: 'ell', he: 'heb', hi: 'hin',
  hu: 'hun', id: 'ind', it: 'ita', ja: 'jpn', ko: 'kor', no: 'nor',
  pl: 'pol', pt: 'por', ro: 'rum', ru: 'rus', es: 'spa', sv: 'swe',
  th: 'tha', tr: 'tur', uk: 'ukr', vi: 'vie',
};

export class OpenSubtitlesLegacyProvider {
  constructor(_config = {}) {
    this.name = 'opensubtitles-legacy';
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async search(query) {
    const langs = (query.languages || ['en'])
      .map((l) => LANG_MAP[l] || l)
      .join(',');

    let path;
    if (query.videoHash && query.videoSize) {
      path = `/search/moviehash-${query.videoHash}/moviebytesize-${query.videoSize}/sublanguageid-${langs}`;
    } else if (query.imdbId) {
      const imdbNum = query.imdbId.replace(/^tt/, '');
      path = `/search/imdbid-${imdbNum}/sublanguageid-${langs}`;
      if (query.type === 'series' && query.season != null && query.episode != null) {
        path += `/season-${query.season}/episode-${query.episode}`;
      }
    } else {
      return [];
    }

    const res = await globalThis.fetch(`${BASE_URL}${path}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenSubtitles legacy API error: HTTP ${res.status}`);
    }

    const json = await res.json();
    const results = Array.isArray(json) ? json : [];
    return this._normalize(results, Boolean(query.videoHash));
  }

  _normalize(results, isHashSearch) {
    return results.map((r) => ({
      id: String(r.IDSubtitleFile ?? ''),
      provider: this.name,
      lang: normalizeLang(r.SubLanguageID),
      url: r.SubDownloadLink || '',
      filename: r.SubFileName || '',
      releaseName: [r.InfoReleaseGroup, r.InfoFormat].filter(Boolean).join('.'),
      hashMatch: isHashSearch || r.MatchedBy === 'moviehash',
      downloads: Number(r.SubDownloadsCnt) || 0,
      rating: Number(r.SubRating) || 0,
      hearingImpaired: r.SubHearingImpaired === '1',
      forced: false,
    }));
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    if (!sub?.url) throw new Error('OpenSubtitles legacy download: missing url');

    const res = await globalThis.fetch(sub.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenSubtitles legacy download failed: HTTP ${res.status}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // SubDownloadLink returns gzipped content
    try {
      return gunzipSync(buf);
    } catch {
      // Not gzipped, return as-is
      return buf;
    }
  }
}
