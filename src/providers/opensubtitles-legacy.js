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
const MAX_RETRIES = 2;

/** Human-readable detail for a fetch error, including the undici cause. */
function fetchDetail(err, url) {
  const cause = err?.cause;
  const code = cause?.code ?? err?.code ?? '';
  const msg = cause?.message ?? err?.message ?? String(err);
  return `${msg}${code ? ` (${code})` : ''} [${url}]`;
}

/** True when a fetch error looks transient (DNS/connection) and worth retrying. */
function isTransient(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
    || err?.message === 'fetch failed';
}

/** fetch with a couple of retries for transient network errors. */
async function fetchWithRetry(url, options) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await globalThis.fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_RETRIES) break;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new Error(`OpenSubtitles legacy request failed: ${fetchDetail(lastErr, url)}`);
}

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

    // Try the most precise search first (movie hash), then fall back to IMDB.
    // The hash endpoint 400s on unknown hashes, so a failed/empty hash search
    // should not prevent an IMDB search from running.
    if (query.videoHash && query.videoSize) {
      const hashPath = `/search/moviehash-${query.videoHash}/moviebytesize-${query.videoSize}/sublanguageid-${langs}`;
      const rawHash = await this._fetchRaw(hashPath);
      if (rawHash.length > 0) return this._normalize(rawHash, true);
    }

    if (query.imdbId) {
      const imdbNum = query.imdbId.replace(/^tt/, '');
      // NOTE: never append /season-X/episode-Y path segments. This API's edge
      // fails DNS resolution on those paths (getaddrinfo ENOTFOUND). Search by
      // IMDB only and filter to the requested episode client-side using the
      // SeriesSeason/SeriesEpisode fields present on each result.
      const imdbPath = `/search/imdbid-${imdbNum}/sublanguageid-${langs}`;
      let raw = await this._fetchRaw(imdbPath);
      if (query.type === 'series' && query.season != null && query.episode != null) {
        raw = raw.filter(
          (r) => Number(r.SeriesSeason) === query.season && Number(r.SeriesEpisode) === query.episode,
        );
      }
      return this._normalize(raw, false);
    }

    return [];
  }

  /**
   * Run one search request and return the raw result array. Returns [] on HTTP
   * error so callers can fall back to the next strategy; throws only on hard
   * network failure.
   */
  async _fetchRaw(path) {
    const url = `${BASE_URL}${path}`;
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Non-fatal: let the caller try the next search strategy.
      console.error(`OpenSubtitles legacy search HTTP ${res.status} [${url}]`);
      return [];
    }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
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
