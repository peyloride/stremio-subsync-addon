/**
 * Sync engine: orchestrates ffsubsync across multiple subtitle candidates.
 *
 * For each non-reference candidate, writes temp files, runs ffsubsync
 * (up to 3 concurrent), validates the offset, and returns synced content
 * or falls back to the original unsynced content.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runFfsubsync } from './ffsubsync.js';

const MAX_CONCURRENT = 3;

/**
 * Simple counting semaphore for limiting concurrency.
 */
class Semaphore {
  constructor(max) {
    this._max = max;
    this._count = 0;
    this._queue = [];
  }

  async acquire() {
    if (this._count < this._max) {
      this._count++;
      return;
    }
    await new Promise((resolve) => this._queue.push(resolve));
  }

  release() {
    this._count--;
    if (this._queue.length > 0) {
      this._count++;
      const next = this._queue.shift();
      next();
    }
  }
}

/**
 * @typedef {object} SyncResult
 * @property {string} id - Candidate id
 * @property {string} lang - Language code
 * @property {Buffer} content - Synced (or original) subtitle content
 * @property {boolean} synced - Whether sync was applied
 * @property {number|null} offsetSeconds - Offset applied (null if unsynced)
 * @property {number|null} framerateScaleFactor - FPS scale (null if unsynced)
 * @property {string|null} error - Error message if sync failed
 */

/**
 * Synchronize all non-reference candidates against the reference subtitle.
 *
 * @param {object[]} candidates - Array of ProviderSubtitle objects with
 *   an additional `content` property (Buffer) holding the downloaded subtitle.
 * @param {object} reference - The selected reference candidate (also has `content`).
 * @param {string} [videoFilename] - Video filename (for logging, not used here).
 * @param {object} config - Parsed addon config (maxOffsetSeconds, syncEnabled, etc.)
 * @returns {Promise<SyncResult[]>} One result per candidate (including the reference itself).
 */
export async function syncSubtitles(candidates, reference, videoFilename, config = {}) {
  const { maxOffsetSeconds = 120, syncEnabled = true } = config;

  // If sync is disabled or no reference, return everything unsynced
  if (!syncEnabled || !reference) {
    return candidates.map((c) => ({
      id: c.id,
      lang: c.lang,
      content: c.content,
      synced: false,
      offsetSeconds: null,
      framerateScaleFactor: null,
      error: null,
    }));
  }

  const semaphore = new Semaphore(MAX_CONCURRENT);
  let tempDir;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'subsync-'));

    // Write the reference file once
    const refExt = _ext(reference);
    const refPath = join(tempDir, `reference${refExt}`);
    await writeFile(refPath, reference.content);

    const tasks = candidates.map(async (candidate) => {
      // The reference itself is returned as-is (it's already in sync)
      if (candidate === reference || candidate.id === reference.id) {
        return {
          id: candidate.id,
          lang: candidate.lang,
          content: candidate.content,
          synced: false,
          offsetSeconds: null,
          framerateScaleFactor: null,
          error: null,
        };
      }

      await semaphore.acquire();
      const inputPath = join(tempDir, `input-${candidate.id}${_ext(candidate)}`);
      const outputPath = join(tempDir, `output-${candidate.id}${_ext(candidate)}`);

      try {
        await writeFile(inputPath, candidate.content);

        const { offsetSeconds, framerateScaleFactor } = await runFfsubsync(
          refPath,
          inputPath,
          outputPath,
          { maxOffsetSeconds },
        );

        // Validate offset is within threshold
        if (Math.abs(offsetSeconds) > maxOffsetSeconds) {
          return {
            id: candidate.id,
            lang: candidate.lang,
            content: candidate.content,
            synced: false,
            offsetSeconds,
            framerateScaleFactor,
            error: `offset ${offsetSeconds}s exceeds max ${maxOffsetSeconds}s`,
          };
        }

        const syncedContent = await readFile(outputPath);
        return {
          id: candidate.id,
          lang: candidate.lang,
          content: syncedContent,
          synced: true,
          offsetSeconds,
          framerateScaleFactor,
          error: null,
        };
      } catch (err) {
        return {
          id: candidate.id,
          lang: candidate.lang,
          content: candidate.content,
          synced: false,
          offsetSeconds: null,
          framerateScaleFactor: null,
          error: err.message,
        };
      } finally {
        semaphore.release();
        // Clean up individual temp files
        await rm(inputPath, { force: true });
        await rm(outputPath, { force: true });
      }
    });

    return await Promise.all(tasks);
  } finally {
    // Clean up the entire temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Determine file extension from a candidate's filename or default to .srt.
 * @param {object} candidate
 * @returns {string}
 */
function _ext(candidate) {
  const name = candidate.filename || '';
  if (name.toLowerCase().endsWith('.ass')) return '.ass';
  if (name.toLowerCase().endsWith('.ssa')) return '.ssa';
  return '.srt';
}
