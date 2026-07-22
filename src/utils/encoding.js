import chardet from 'chardet';
import iconv from 'iconv-lite';

/** UTF-8 BOM: EF BB BF */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * @typedef {Object} ConvertedContent
 * @property {string} content - The subtitle text as a UTF-8 string.
 * @property {string} encoding - The detected source encoding (e.g. "UTF-8", "ISO-8859-1").
 */

/**
 * Detect the encoding of a buffer and convert it to a UTF-8 string.
 *
 * Uses chardet for detection and iconv-lite for conversion. Strips a UTF-8
 * BOM if present. When detection fails or returns null, falls back to UTF-8.
 *
 * @param {Buffer} buffer - Raw subtitle file content.
 * @returns {ConvertedContent}
 */
export function detectAndConvert(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Expected a Buffer');
  }

  if (buffer.length === 0) {
    return { content: '', encoding: 'UTF-8' };
  }

  // Strip UTF-8 BOM before detection so chardet doesn't get confused
  let working = buffer;
  if (buffer.subarray(0, 3).equals(UTF8_BOM)) {
    working = buffer.subarray(3);
  }

  // Fast path: if the buffer is valid UTF-8 (or pure ASCII), use it directly.
  // chardet often misdetects short ASCII-only strings as ISO-8859-1.
  if (isValidUtf8(working)) {
    return { content: working.toString('utf-8'), encoding: 'UTF-8' };
  }

  // chardet.detect() can return 'UTF-8' for short non-UTF-8 buffers.
  // Use analyse() and skip UTF-8 candidates when the buffer isn't valid.
  let detected = 'Windows-1252';
  const candidates = chardet.analyse(working);
  if (candidates && candidates.length > 0) {
    for (const candidate of candidates) {
      const name = candidate.name;
      // Skip UTF-8/ASCII if the buffer has invalid sequences
      if (/utf-?8/i.test(name) && !isValidUtf8(working)) continue;
      if (/^ascii$/i.test(name) && !isValidUtf8(working)) continue;
      detected = name;
      break;
    }
  }

  // chardet may return names iconv-lite doesn't recognize directly.
  // Normalize a few common variants.
  const encoding = normalizeEncodingName(detected);

  if (!iconv.encodingExists(encoding)) {
    // Unknown encoding — fall back to latin1 (never throws, maps bytes 1:1)
    return { content: iconv.decode(working, 'latin1'), encoding: detected };
  }

  const content = iconv.decode(working, encoding);
  return { content, encoding: detected };
}

/**
 * Check whether a buffer is valid UTF-8 (no replacement characters produced).
 * Pure ASCII always passes.
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isValidUtf8(buf) {
  // If every byte is < 0x80 it's pure ASCII — trivially valid UTF-8.
  let hasHighBytes = false;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 0x80) { hasHighBytes = true; break; }
  }
  if (!hasHighBytes) return true;

  // Round-trip through UTF-8 decode/encode and check for replacement chars.
  const decoded = buf.toString('utf-8');
  return !decoded.includes('\uFFFD');
}

/**
 * Map chardet encoding names to iconv-lite-compatible names.
 * @param {string} name
 * @returns {string}
 */
function normalizeEncodingName(name) {
  const upper = name.toUpperCase();

  const MAP = {
    'UTF-8': 'utf8',
    'UTF-16LE': 'utf16-le',
    'UTF-16BE': 'utf16-be',
    'ISO-8859-1': 'latin1',
    'ISO-8859-2': 'latin2',
    'ISO-8859-5': 'iso-8859-5',
    'ISO-8859-6': 'iso-8859-6',
    'ISO-8859-7': 'iso-8859-7',
    'ISO-8859-8': 'iso-8859-8',
    'ISO-8859-9': 'iso-8859-9',
    'ISO-8859-15': 'iso-8859-15',
    'WINDOWS-1250': 'win1250',
    'WINDOWS-1251': 'win1251',
    'WINDOWS-1252': 'win1252',
    'WINDOWS-1253': 'win1253',
    'WINDOWS-1254': 'win1254',
    'WINDOWS-1255': 'win1255',
    'WINDOWS-1256': 'win1256',
    'KOI8-R': 'koi8-r',
    'SHIFT_JIS': 'shiftjis',
    'EUC-JP': 'eucjp',
    'EUC-KR': 'euckr',
    'BIG5': 'big5',
    'GB18030': 'gb18030',
    'GBK': 'gbk',
    'ASCII': 'ascii',
  };

  return MAP[upper] ?? name;
}
