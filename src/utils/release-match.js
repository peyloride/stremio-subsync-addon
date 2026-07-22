/**
 * Release-name token parsing and matching for subtitle-to-video alignment.
 *
 * A typical release name looks like:
 *   "Movie.Title.2024.1080p.BluRay.x264-GRP"
 * We extract structured tokens (resolution, codec, source, group) plus
 * freeform name tokens for fuzzy matching.
 */

const RESOLUTIONS = [
  '2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd',
];

const CODECS = [
  'x264', 'x265', 'x.264', 'x.265', 'h264', 'h265', 'h.264', 'h.265',
  'hevc', 'avc', 'av1', 'vp9', 'mpeg2', 'divx', 'xvid',
];

const SOURCES = [
  'bluray', 'blu-ray', 'web-dl', 'webdl', 'webrip', 'web', 'hdtv',
  'dvdrip', 'dvd', 'bdrip', 'brrip', 'hdrip', 'cam', 'ts', 'tc',
  'scr', 'screener', 'r5', 'remux', 'pdtv', 'sdtv', 'dsr',
];

const AUDIO = [
  'dts', 'dd5.1', 'dd5', 'dd2.0', 'ddp5.1', 'ddp', 'ac3', 'aac',
  'atmos', 'truehd', 'flac', 'mp3', 'eac3',
];

const ALL_KNOWN = new Set([
  ...RESOLUTIONS,
  ...CODECS,
  ...SOURCES,
  ...AUDIO,
  '10bit', '8bit', 'hdr', 'hdr10', 'dolby.vision', 'dovi', 'proper',
  'repack', 'internal', 'extended', 'unrated', 'directors.cut',
  'multi', 'dual', 'subbed', 'dubbed', 'hc', 'hardsub',
]);

/**
 * Known technical tokens that can appear before a dash-group suffix,
 * e.g. "x264-GRP". When a dash-token's left side matches one of these,
 * we split it so the codec/source is recognized and the group is extracted.
 */
const DASH_SPLITTABLE = new Set([
  ...CODECS,
  ...RESOLUTIONS,
  ...SOURCES,
  ...AUDIO,
]);

/**
 * @typedef {Object} ReleaseTokens
 * @property {string} resolution - e.g. "1080p" or ""
 * @property {string} codec - e.g. "x264" or ""
 * @property {string} source - e.g. "bluray" or ""
 * @property {string} audio - e.g. "dts" or ""
 * @property {string} group - e.g. "GRP" or ""
 * @property {string[]} nameTokens - Freeform title tokens (lowercased).
 */

/**
 * Normalize a filename/release string into lowercase dot/space-separated
 * tokens, stripping the file extension.
 * @param {string} input
 * @returns {string[]}
 */
function tokenize(input) {
  if (typeof input !== 'string') return [];
  // Strip common video/subtitle extensions
  const stripped = input.replace(/\.(mkv|mp4|avi|mov|wmv|srt|ass|ssa|sub|vtt|zip|gz)$/i, '');
  const raw = stripped
    .replace(/[_\s]+/g, '.')
    .split('.')
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean);

  // Split dash-joined tokens only when the left side is a known technical
  // token (e.g. "x264-grp" → ["x264", "grp"]) but keep hyphenated terms
  // like "web-dl" and "blu-ray" intact.
  const ALL_TERMS = new Set([...RESOLUTIONS, ...CODECS, ...SOURCES, ...AUDIO]);
  const result = [];
  for (const token of raw) {
    // If the full token (with dash) is a known term, keep it intact
    if (ALL_TERMS.has(token)) {
      result.push(token);
      continue;
    }
    if (token.includes('-')) {
      const dashIdx = token.indexOf('-');
      const left = token.slice(0, dashIdx);
      if (DASH_SPLITTABLE.has(left)) {
        result.push(left);
        const right = token.slice(dashIdx + 1);
        if (right) result.push(right);
        continue;
      }
    }
    result.push(token);
  }
  return result;
}

/**
 * Parse structured release tokens from a filename or release name.
 *
 * @param {string} filename - Video or subtitle filename / release name.
 * @returns {ReleaseTokens}
 */
export function parseReleaseTokens(filename) {
  const tokens = tokenize(filename);

  let resolution = '';
  let codec = '';
  let source = '';
  let audio = '';
  let group = '';
  const nameTokens = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!resolution && RESOLUTIONS.includes(token)) {
      resolution = token;
      continue;
    }
    if (!codec && CODECS.includes(token)) {
      codec = token;
      continue;
    }
    if (!source && SOURCES.includes(token)) {
      source = token;
      continue;
    }
    if (!audio && AUDIO.includes(token)) {
      audio = token;
      continue;
    }

    // Group name: typically the last token after a dash, e.g. "x264-GRP"
    // We detect it as the last token if it's not a known technical token.
    if (!ALL_KNOWN.has(token) && !/^\d{3,4}$/.test(token)) {
      nameTokens.push(token);
    }
  }

  // Heuristic: the last name token is often the group (after a dash in the
  // original name). Check the raw string for a dash-separated group.
  if (typeof filename === 'string') {
    const dashMatch = filename.match(/-([A-Za-z0-9]+?)(?:\.\w+)?$/);
    if (dashMatch) {
      group = dashMatch[1].toLowerCase();
      // Remove group from nameTokens if present
      const idx = nameTokens.lastIndexOf(group);
      if (idx !== -1) nameTokens.splice(idx, 1);
    }
  }

  return { resolution, codec, source, audio, group, nameTokens };
}

/**
 * Compute a 0–1 match score between a video filename and a subtitle release
 * name based on token overlap.
 *
 * Scoring weights:
 * - resolution match: 0.25
 * - codec match: 0.20
 * - source match: 0.20
 * - group match: 0.20
 * - name token overlap (Jaccard): 0.15
 *
 * @param {string} videoFilename - The video file's name.
 * @param {string} subReleaseName - The subtitle's release name or filename.
 * @returns {number} Score between 0 (no match) and 1 (perfect match).
 */
export function matchScore(videoFilename, subReleaseName) {
  const video = parseReleaseTokens(videoFilename);
  const sub = parseReleaseTokens(subReleaseName);

  let score = 0;

  // Resolution (0.25)
  if (video.resolution && sub.resolution) {
    if (video.resolution === sub.resolution) score += 0.25;
  }

  // Codec (0.20)
  if (video.codec && sub.codec) {
    if (video.codec === sub.codec) score += 0.20;
  }

  // Source (0.20)
  if (video.source && sub.source) {
    if (video.source === sub.source) score += 0.20;
  }

  // Group (0.20)
  if (video.group && sub.group) {
    if (video.group === sub.group) score += 0.20;
  }

  // Name token overlap — Jaccard similarity (0.15)
  if (video.nameTokens.length > 0 && sub.nameTokens.length > 0) {
    const setA = new Set(video.nameTokens);
    const setB = new Set(sub.nameTokens);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection++;
    }
    const union = new Set([...setA, ...setB]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    score += 0.15 * jaccard;
  }

  return Math.min(score, 1);
}
