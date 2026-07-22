import AdmZip from 'adm-zip';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

/** ZIP local file header: PK\x03\x04 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** ZIP end-of-central-directory: PK\x05\x06 (present even in empty ZIPs) */
const ZIP_EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
/** GZIP magic bytes: \x1f\x8b */
const GZ_MAGIC = Buffer.from([0x1f, 0x8b]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

/**
 * @typedef {Object} ExtractedSubtitle
 * @property {Buffer} content - Raw subtitle file content.
 * @property {string} filename - Name of the extracted file.
 */

/**
 * Detect whether a buffer looks like a ZIP archive by checking magic bytes.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isZip(buffer) {
  if (buffer.length < 4) return false;
  if (buffer.subarray(0, 4).equals(ZIP_MAGIC)) return true;
  // Empty ZIPs only have the end-of-central-directory record
  return buffer.includes(ZIP_EOCD);
}

/**
 * Detect whether a buffer looks like a GZIP archive by checking magic bytes.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isGzip(buffer) {
  return buffer.length >= 2 && buffer.subarray(0, 2).equals(GZ_MAGIC);
}

/**
 * Pick the best subtitle entry from a list of {name, content} candidates.
 * Prefers .srt, then .ass/.ssa, then any other subtitle extension.
 * Returns null when no candidate qualifies.
 */
function pickSubtitle(entries) {
  const byPriority = ['.srt', '.ass', '.ssa', '.sub', '.vtt'];

  for (const ext of byPriority) {
    const match = entries.find((e) => path.extname(e.name).toLowerCase() === ext);
    if (match) return match;
  }

  // Fallback: any file with a known subtitle extension
  const fallback = entries.find((e) =>
    SUBTITLE_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
  );
  return fallback ?? null;
}

/**
 * Extract the first subtitle file from an archive buffer.
 *
 * Supports ZIP (via adm-zip) and GZIP (via node:zlib). Detection is by magic
 * bytes first, then by filename extension as a fallback. Non-archive buffers
 * are returned as-is.
 *
 * @param {Buffer} buffer - Raw file content (may be an archive).
 * @param {string} [filename=''] - Original filename hint for extension-based detection.
 * @returns {ExtractedSubtitle} The extracted (or passthrough) subtitle.
 */
export function extractSubtitle(buffer, filename = '') {
  const ext = path.extname(filename).toLowerCase();

  // --- ZIP ---
  if (isZip(buffer) || ext === '.zip') {
    const zip = new AdmZip(buffer);
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({
        name: path.basename(entry.entryName),
        content: entry.getData(),
      }));

    const picked = pickSubtitle(entries);
    if (picked) {
      return { content: picked.content, filename: picked.name };
    }

    // No recognized subtitle extension — return the first file if any
    if (entries.length > 0) {
      return { content: entries[0].content, filename: entries[0].name };
    }

    throw new Error('ZIP archive contains no files');
  }

  // --- GZIP ---
  if (isGzip(buffer) || ext === '.gz') {
    const decompressed = gunzipSync(buffer);
    // Derive inner filename by stripping .gz
    const innerName = ext === '.gz' ? path.basename(filename, '.gz') : 'subtitle.srt';
    return { content: decompressed, filename: innerName || 'subtitle.srt' };
  }

  // --- Not an archive: passthrough ---
  return { content: buffer, filename: path.basename(filename) || 'subtitle.srt' };
}
