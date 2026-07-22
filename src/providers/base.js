/**
 * @typedef {Object} SubtitleQuery
 * @property {'movie'|'series'} type - Content type.
 * @property {string} [imdbId] - IMDB ID (e.g. "tt1234567").
 * @property {string} [tmdbId] - TMDB ID.
 * @property {string} [videoHash] - OpenSubtitles file hash of the video.
 * @property {number} [videoSize] - Video file size in bytes.
 * @property {string} [filename] - Video filename (e.g. "Movie.2024.1080p.BluRay.x264-GRP.mkv").
 * @property {number} [season] - Season number (series only).
 * @property {number} [episode] - Episode number (series only).
 * @property {string[]} languages - Desired languages as ISO 639-1 codes.
 */

/**
 * @typedef {Object} ProviderSubtitle
 * @property {string} id - Provider-specific unique identifier.
 * @property {string} provider - Provider name (e.g. "opensubtitles").
 * @property {string} lang - ISO 639-1 language code.
 * @property {string} url - Download URL for the subtitle file.
 * @property {string} [filename] - Original subtitle filename.
 * @property {string} [releaseName] - Matched release name.
 * @property {boolean} hashMatch - True if matched by videoHash.
 * @property {number} [downloads] - Download count.
 * @property {number} [rating] - User rating.
 * @property {boolean} [hearingImpaired] - Hearing-impaired (SDH) flag.
 * @property {boolean} [forced] - Forced subtitle flag.
 */

/**
 * @typedef {Object} SubtitleProvider
 * @property {string} name - Unique provider name.
 * @property {(query: SubtitleQuery) => Promise<ProviderSubtitle[]>} search
 * @property {(sub: ProviderSubtitle) => Promise<Buffer>} download
 */

/**
 * Validate that an object satisfies the SubtitleProvider interface.
 * Throws a descriptive error if any required member is missing or has the
 * wrong type.
 *
 * @param {unknown} provider - The object to validate.
 * @returns {true} Returns `true` when valid (never returns false — throws instead).
 * @throws {TypeError} When the provider is not a valid SubtitleProvider.
 */
export function validateProvider(provider) {
  if (provider === null || typeof provider !== 'object') {
    throw new TypeError('Provider must be a non-null object');
  }

  if (typeof provider.name !== 'string' || provider.name.length === 0) {
    throw new TypeError('Provider must have a non-empty string "name"');
  }

  if (typeof provider.search !== 'function') {
    throw new TypeError(`Provider "${provider.name}" must have a "search" function`);
  }

  if (typeof provider.download !== 'function') {
    throw new TypeError(`Provider "${provider.name}" must have a "download" function`);
  }

  return true;
}
