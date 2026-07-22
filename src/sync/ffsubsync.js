/**
 * ffsubsync subprocess wrapper.
 *
 * Spawns `ffsubsync <ref> -i <input> -o <output> --max-offset-seconds <n>
 * --output-encoding same` as a child process with a 30-second timeout.
 * Parses the result for offset_seconds and framerate_scale_factor.
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;

let ffsubsyncAvailableCache = null;

/**
 * Check whether the ffsubsync binary is available on PATH.
 * Caches the result after the first call.
 *
 * @returns {Promise<boolean>}
 */
export async function checkFfsubsyncAvailable() {
  if (ffsubsyncAvailableCache !== null) return ffsubsyncAvailableCache;
  try {
    await execFileAsync('which', ['ffsubsync']);
    ffsubsyncAvailableCache = true;
  } catch {
    ffsubsyncAvailableCache = false;
  }
  return ffsubsyncAvailableCache;
}

/**
 * Synchronous-style cached availability check. Returns the cached value
 * if already resolved, otherwise returns null (call checkFfsubsyncAvailable
 * first to populate).
 *
 * @returns {boolean|null}
 */
export function isFfsubsyncAvailable() {
  return ffsubsyncAvailableCache;
}

/**
 * Reset the cached availability (useful for tests).
 */
export function resetFfsubsyncCache() {
  ffsubsyncAvailableCache = null;
}

/**
 * Parse ffsubsync CLI output for offset_seconds and framerate_scale_factor.
 * ffsubsync prints lines like:
 *   "offset seconds: 5.123"
 *   "framerate scale factor: 1.000"
 * It may also print a JSON result dict in some versions.
 *
 * @param {string} output - combined stdout + stderr
 * @returns {{ offsetSeconds: number, framerateScaleFactor: number }}
 */
export function parseFfsubsyncOutput(output) {
  let offsetSeconds = 0;
  let framerateScaleFactor = 1;

  // Try JSON result first (some versions print a result dict)
  const jsonMatch = output.match(/\{[^{}]*"offset_seconds"\s*:\s*([^,}]+)/);
  if (jsonMatch) {
    offsetSeconds = parseFloat(jsonMatch[1]) || 0;
    const fpsMatch = output.match(/"framerate_scale_factor"\s*:\s*([^,}]+)/);
    if (fpsMatch) framerateScaleFactor = parseFloat(fpsMatch[1]) || 1;
    return { offsetSeconds, framerateScaleFactor };
  }

  // Fall back to human-readable lines
  const offsetMatch = output.match(/offset\s*(?:seconds)?\s*[:=]\s*(-?[\d.]+)/i);
  if (offsetMatch) {
    offsetSeconds = parseFloat(offsetMatch[1]) || 0;
  }

  const fpsMatch = output.match(/framerate\s*(?:scale\s*(?:factor)?)?\s*[:=]\s*(-?[\d.]+)/i);
  if (fpsMatch) {
    framerateScaleFactor = parseFloat(fpsMatch[1]) || 1;
  }

  return { offsetSeconds, framerateScaleFactor };
}

/**
 * Run ffsubsync to synchronize a subtitle file against a reference.
 *
 * @param {string} referencePath - Path to the reference .srt file
 * @param {string} inputPath - Path to the unsynced .srt file
 * @param {string} outputPath - Path where the synced .srt will be written
 * @param {object} [options]
 * @param {number} [options.maxOffsetSeconds=120] - Maximum allowed offset
 * @param {number} [options.timeoutMs=30000] - Process timeout in ms
 * @returns {Promise<{ offsetSeconds: number, framerateScaleFactor: number }>}
 * @throws {Error} On non-zero exit, timeout, or missing output file
 */
export async function runFfsubsync(referencePath, inputPath, outputPath, options = {}) {
  const {
    maxOffsetSeconds = 120,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const args = [
    referencePath,
    '-i', inputPath,
    '-o', outputPath,
    '--max-offset-seconds', String(maxOffsetSeconds),
    '--output-encoding', 'same',
  ];

  let stdout;
  let stderr;
  try {
    const result = await execFileAsync('ffsubsync', args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1 MB
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (err) {
    if (err.killed || (err.signal && err.signal === 'SIGTERM')) {
      throw new Error(`ffsubsync timed out after ${timeoutMs}ms`);
    }
    const msg = err.stderr || err.message || 'unknown error';
    throw new Error(`ffsubsync failed (exit ${err.code ?? '?'}): ${msg}`);
  }

  // Verify the output file was created
  try {
    await access(outputPath, constants.F_OK);
  } catch {
    throw new Error('ffsubsync completed but did not produce an output file');
  }

  return parseFfsubsyncOutput(`${stdout}\n${stderr}`);
}
