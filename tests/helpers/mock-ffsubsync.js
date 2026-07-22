/**
 * ffsubsync subprocess mock for unit tests.
 *
 * Spies on child_process.execFile to simulate ffsubsync in three modes:
 *   - 'success' : exits 0, creates the output file with synced content
 *   - 'failure' : exits 1, no output file
 *   - 'timeout' : never resolves (caller must handle the timeout)
 *
 * Usage:
 *   import { mockFfsubsync, restoreFfsubsync } from '../helpers/mock-ffsubsync.js';
 *   beforeEach(() => mockFfsubsync('success'));
 *   afterEach(() => restoreFfsubsync());
 */

import { writeFile } from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import { vi } from 'vitest';

/** Default content written to the output file in success mode. */
const SYNCED_SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  'Welcome to the world of tomorrow.',
  '',
  '2',
  '00:00:05,500 --> 00:00:08,200',
  'I have been expecting you, Mr. Anderson.',
  '',
].join('\n');

/** Simulated ffsubsync stdout in success mode. */
const SUCCESS_STDOUT = JSON.stringify({
  offset_seconds: -5.0,
  framerate_scale_factor: 1.0,
});

let execFileSpy = null;

/**
 * Install the ffsubsync mock.
 *
 * @param {'success' | 'failure' | 'timeout'} mode
 * @param {object} [opts]
 * @param {string} [opts.syncedContent] - override the content written to the output file
 * @param {string} [opts.stdout] - override stdout in success mode
 */
export function mockFfsubsync(mode = 'success', opts = {}) {
  restoreFfsubsync(); // clean up any previous mock

  const syncedContent = opts.syncedContent ?? SYNCED_SRT;
  const stdout = opts.stdout ?? SUCCESS_STDOUT;

  execFileSpy = vi.spyOn(childProcess, 'execFile');

  execFileSpy.mockImplementation((_file, args, _options, callback) => {
    // args: [reference, '-i', input, '-o', output, ...]
    const outputIdx = args.indexOf('-o');
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : null;

    // Support both callback and promisified usage
    const cb = typeof callback === 'function' ? callback : _options;

    switch (mode) {
      case 'success':
        // Write the output file, then call back with success
        if (outputPath) {
          writeFile(outputPath, syncedContent).then(() => {
            if (typeof cb === 'function') cb(null, stdout, '');
          });
        } else if (typeof cb === 'function') {
          cb(null, stdout, '');
        }
        break;

      case 'failure':
        if (typeof cb === 'function') {
          const err = new Error('ffsubsync failed');
          err.code = 1;
          cb(err, '', 'sync error');
        }
        break;

      case 'timeout':
        // Never call back — the caller's timeout should fire
        break;

      default:
        throw new Error(`Unknown mock mode: ${mode}`);
    }

    // Return a fake ChildProcess-like object
    return {
      kill: vi.fn(),
      pid: 99999,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    };
  });
}

/**
 * Remove the ffsubsync mock and restore the original execFile.
 */
export function restoreFfsubsync() {
  if (execFileSpy) {
    execFileSpy.mockRestore();
    execFileSpy = null;
  }
}
