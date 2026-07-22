/**
 * Reference subtitle selection using a priority cascade:
 *   1. Best hash-matched subtitle (hashMatch === true) by composite score
 *   2. Best release-name match against the video filename (>= 2 token overlap)
 *   3. null otherwise — no blind popularity-based sync; also null for a single
 *      candidate or empty list
 */

/**
 * Compute a composite score for a subtitle candidate.
 * Uses downloads × rating when both are present, otherwise downloads alone.
 * Falls back to 0 when neither is available.
 *
 * @param {object} candidate - ProviderSubtitle
 * @returns {number}
 */
export function compositeScore(candidate) {
  const downloads = typeof candidate.downloads === 'number' ? candidate.downloads : 0;
  const rating = typeof candidate.rating === 'number' ? candidate.rating : 0;
  if (downloads > 0 && rating > 0) return downloads * rating;
  return downloads;
}

/**
 * Tokenize a release/filename string into lowercase alphanumeric tokens,
 * stripping common separators (dots, dashes, underscores, brackets).
 *
 * @param {string} name
 * @returns {string[]}
 */
export function tokenizeReleaseName(name) {
  if (!name || typeof name !== 'string') return [];
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '') // strip file extension
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Compute a release-name match score between a video filename and a
 * subtitle's releaseName or filename. Returns the number of overlapping
 * tokens (case-insensitive). A higher score means a better match.
 *
 * @param {string} videoFilename
 * @param {object} candidate - ProviderSubtitle with releaseName and/or filename
 * @returns {number} overlap count
 */
export function releaseMatchScore(videoFilename, candidate) {
  const videoTokens = tokenizeReleaseName(videoFilename);
  if (videoTokens.length === 0) return 0;

  const subName = candidate.releaseName || candidate.filename || '';
  const subTokens = tokenizeReleaseName(subName);
  if (subTokens.length === 0) return 0;

  const subSet = new Set(subTokens);
  let overlap = 0;
  for (const token of videoTokens) {
    if (subSet.has(token)) overlap++;
  }
  return overlap;
}

/**
 * Select a trustworthy reference subtitle from a list of candidates.
 *
 * A reference is only useful for syncing when it is timed to the same video, so
 * selection requires a real signal: an exact video-hash match or a release-name
 * match against the video filename. When neither exists there is no evidence the
 * candidates line up with the video, so null is returned and callers serve the
 * subtitles unsynced rather than syncing against a blind popularity pick (which
 * can corrupt already-correct timing).
 *
 * @param {object[]} candidates - Array of ProviderSubtitle objects
 * @param {string} [videoFilename] - The video filename for release-name matching
 * @returns {object|null} The selected reference candidate, or null
 */
export function selectReference(candidates, videoFilename) {
  if (!Array.isArray(candidates) || candidates.length <= 1) {
    return null;
  }

  // 1. Best hash-matched subtitle by composite score
  const hashMatched = candidates.filter((c) => c.hashMatch === true);
  if (hashMatched.length > 0) {
    return hashMatched.reduce((best, c) =>
      compositeScore(c) > compositeScore(best) ? c : best,
    );
  }

  // 2. Best release-name match against videoFilename
  if (videoFilename) {
    let bestMatch = null;
    let bestMatchScore = 0;
    for (const c of candidates) {
      const score = releaseMatchScore(videoFilename, c);
      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestMatch = c;
      } else if (score === bestMatchScore && score > 0 && bestMatch) {
        // Tie-break by composite score
        if (compositeScore(c) > compositeScore(bestMatch)) {
          bestMatch = c;
        }
      }
    }
    // Require at least 2 overlapping tokens to consider it a real match
    if (bestMatch && bestMatchScore >= 2) {
      return bestMatch;
    }
  }

  // No hash or release-name match: syncing would be a blind guess.
  return null;
}
