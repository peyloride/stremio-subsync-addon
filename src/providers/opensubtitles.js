/**
 * OpenSubtitles REST API v1 provider.
 *
 * API docs: https://opensubtitles.stoplight.io/docs/opensubtitles-api/
 * Base URL: https://api.opensubtitles.com/api/v1/
 *
 * Requires a user-supplied API key (`config.opensubtitlesApiKey`). When the
 * key is missing the provider is skipped silently (search returns []).
 *
 * Search strategies (first match wins):
 *   1. hash lookup  → GET /subtitles?moviehash=&moviebytesize=
 *   2. IMDB search  → GET /subtitles?imdb_id=
 *   3. filename     → GET /subtitles?query=
 *
 * Download is a two-step flow: POST /download with a file_id returns a
 * temporary `link`, which is then fetched for the raw bytes. Because the real
 * download URL is not known at search time, results carry a synthetic URL of
 * the form `opensubtitles://file/<file_id>` that {@link download} parses.
 */

import { normalizeLang } from '../utils/language.js';
import { fetchLogged, logEvent } from '../utils/logging.js';

const BASE_URL = 'https://api.opensubtitles.com/api/v1';
const USER_AGENT = 'stremio-subsync-addon/1.0';
const REQUEST_TIMEOUT_MS = 10000;
/** Number of extra attempts after the initial request when rate-limited. */
const MAX_RETRIES = 1;
/** Cap applied to a server-provided Retry-After so a stall can't hang us. */
const MAX_RETRY_AFTER_SECONDS = 5;
/** Synthetic scheme prefix used to carry the file_id inside ProviderSubtitle.url. */
export const DOWNLOAD_SCHEME = 'opensubtitles://file/';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip a leading "tt" so the value matches the API's numeric imdb_id. */
function toImdbNumeric(imdbId) {
  return String(imdbId).replace(/^tt/i, '');
}

/** Extract the numeric file_id from a ProviderSubtitle (url scheme or id). */
function parseFileId(sub) {
  if (sub?.url && sub.url.startsWith(DOWNLOAD_SCHEME)) {
    return sub.url.slice(DOWNLOAD_SCHEME.length);
  }
  return sub?.id != null ? String(sub.id) : '';
}

export class OpenSubtitlesProvider {
  /**
   * @param {object} [config]
   * @param {string} [config.opensubtitlesApiKey]
   */
  constructor(config = {}) {
    this.name = 'opensubtitles';
    this.apiKey = config.opensubtitlesApiKey || '';
  }

  _headers() {
    return {
      'Api-Key': this.apiKey,
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    };
  }

  /**
   * fetch JSON with the provider headers, a request timeout, and a single
   * retry honoring Retry-After on HTTP 429.
   */
  async _fetchJson(url, options = {}, context = {}) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetchLogged(this.name, url, {
        ...options,
        headers: { ...this._headers(), ...(options.headers || {}) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }, context);

      if (res.status === 429) {
        if (attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get('retry-after')) || 0;
          await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS) * 1000);
          continue;
        }
        throw new Error('OpenSubtitles API rate limited (HTTP 429)');
      }

      if (!res.ok) {
        throw new Error(`OpenSubtitles API error: HTTP ${res.status}`);
      }

      return res.json();
    }
    // Unreachable: the loop always returns or throws.
    throw new Error('OpenSubtitles API request failed');
  }

  /**
   * @param {import('./base.js').SubtitleQuery} query
   * @returns {Promise<import('./base.js').ProviderSubtitle[]>}
   */
  async search(query) {
    if (!this.apiKey) return [];

    const params = new URLSearchParams();
    const langs = (query.languages || []).join(',');
    if (langs) params.set('languages', langs);

    let hashMatch = false;
    if (query.videoHash && query.videoSize) {
      params.set('moviehash', String(query.videoHash));
      params.set('moviebytesize', String(query.videoSize));
      hashMatch = true;
    } else if (query.imdbId) {
      params.set('imdb_id', toImdbNumeric(query.imdbId));
      this._applySeriesParams(params, query);
    } else if (query.filename) {
      params.set('query', query.filename);
      this._applySeriesParams(params, query);
    } else {
      return [];
    }

    const url = `${BASE_URL}/subtitles?${params.toString()}`;
    const json = await this._fetchJson(url, {}, { requestId: query.requestId, action: 'search' });
    const results = this._normalize(json, hashMatch);
    logEvent('provider_result_count', {
      requestId: query.requestId ?? null,
      provider: this.name,
      action: 'search',
      resultCount: results.length,
    });
    return results;
  }

  _applySeriesParams(params, query) {
    if (query.type !== 'series') return;
    if (query.season != null) params.set('season_number', String(query.season));
    if (query.episode != null) params.set('episode_number', String(query.episode));
  }

  _normalize(json, hashMatch) {
    const data = Array.isArray(json?.data) ? json.data : [];
    const results = [];

    for (const item of data) {
      const attrs = item?.attributes || {};
      const files = Array.isArray(attrs.files) ? attrs.files : [];
      const lang = normalizeLang(attrs.language);
      const releaseName = attrs.release || attrs.feature_details?.movie_name || '';

      for (const file of files) {
        if (file?.file_id == null) continue;
        results.push({
          id: String(file.file_id),
          provider: this.name,
          lang,
          url: `${DOWNLOAD_SCHEME}${file.file_id}`,
          filename: file.file_name || '',
          releaseName,
          hashMatch,
          downloads: attrs.download_count ?? 0,
          rating: attrs.rating ?? 0,
          hearingImpaired: Boolean(attrs.hearing_impaired),
          forced: Boolean(attrs.foreign_parts_only),
        });
      }
    }

    return results;
  }

  /**
   * @param {import('./base.js').ProviderSubtitle} sub
   * @returns {Promise<Buffer>}
   */
  async download(sub) {
    const fileId = parseFileId(sub);
    if (!fileId) throw new Error('OpenSubtitles download: missing file id');

    const json = await this._fetchJson(`${BASE_URL}/download`, {
      method: 'POST',
      body: JSON.stringify({ file_id: Number(fileId) }),
    }, { requestId: sub.requestId, action: 'download-link' });

    const link = json?.link;
    if (!link) throw new Error('OpenSubtitles download: no link returned');

    const res = await fetchLogged(this.name, link, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, { requestId: sub.requestId, action: 'download-file' });
    if (!res.ok) {
      throw new Error(`OpenSubtitles download failed: HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
