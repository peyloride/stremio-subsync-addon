import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

// vi.mock is hoisted, so we must use vi.hoisted() for variables referenced
// inside the factory.
const { mockExecFileImpl, mockAccess } = vi.hoisted(() => {
  const impl = vi.fn();
  impl[Symbol.for('nodejs.util.promisify.custom')] = vi.fn();
  return {
    mockExecFileImpl: impl,
    mockAccess: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('node:child_process', () => ({
  execFile: mockExecFileImpl,
}));

vi.mock('node:fs/promises', () => ({
  access: mockAccess,
  constants: { F_OK: 0 },
}));

import {
  checkFfsubsyncAvailable,
  isFfsubsyncAvailable,
  parseFfsubsyncOutput,
  resetFfsubsyncCache,
  runFfsubsync,
} from '../../../src/sync/ffsubsync.js';

const mockExecFileAsync = mockExecFileImpl[promisify.custom];

beforeEach(() => {
  vi.clearAllMocks();
  resetFfsubsyncCache();
  mockAccess.mockResolvedValue(undefined);
});

afterEach(() => {
  resetFfsubsyncCache();
});

// --- parseFfsubsyncOutput ---

describe('parseFfsubsyncOutput', () => {
  it('parses human-readable offset and framerate lines', () => {
    const output = 'offset seconds: 5.123\nframerate scale factor: 1.002\n';
    const result = parseFfsubsyncOutput(output);
    expect(result.offsetSeconds).toBeCloseTo(5.123);
    expect(result.framerateScaleFactor).toBeCloseTo(1.002);
  });

  it('parses negative offsets', () => {
    const output = 'offset seconds: -3.5\n';
    const result = parseFfsubsyncOutput(output);
    expect(result.offsetSeconds).toBeCloseTo(-3.5);
  });

  it('parses JSON-style output', () => {
    const output = '{"offset_seconds": 2.5, "framerate_scale_factor": 0.999}';
    const result = parseFfsubsyncOutput(output);
    expect(result.offsetSeconds).toBeCloseTo(2.5);
    expect(result.framerateScaleFactor).toBeCloseTo(0.999);
  });

  it('defaults to 0 offset and 1.0 scale when nothing matches', () => {
    const result = parseFfsubsyncOutput('some random output');
    expect(result.offsetSeconds).toBe(0);
    expect(result.framerateScaleFactor).toBe(1);
  });

  it('handles empty output', () => {
    const result = parseFfsubsyncOutput('');
    expect(result.offsetSeconds).toBe(0);
    expect(result.framerateScaleFactor).toBe(1);
  });
});

// --- checkFfsubsyncAvailable / isFfsubsyncAvailable ---

describe('checkFfsubsyncAvailable', () => {
  it('returns true when which ffsubsync succeeds', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '/usr/bin/ffsubsync\n', stderr: '' });

    const result = await checkFfsubsyncAvailable();
    expect(result).toBe(true);
    expect(isFfsubsyncAvailable()).toBe(true);
  });

  it('returns false when which ffsubsync fails', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('not found'));

    const result = await checkFfsubsyncAvailable();
    expect(result).toBe(false);
    expect(isFfsubsyncAvailable()).toBe(false);
  });

  it('caches the result across calls', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '/usr/bin/ffsubsync\n', stderr: '' });

    await checkFfsubsyncAvailable();
    await checkFfsubsyncAvailable();
    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });

  it('isFfsubsyncAvailable returns null before first check', () => {
    expect(isFfsubsyncAvailable()).toBeNull();
  });
});

// --- runFfsubsync ---

describe('runFfsubsync', () => {
  it('spawns ffsubsync with correct arguments', async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: 'offset seconds: 2.0\nframerate scale factor: 1.0\n',
      stderr: '',
    });

    const result = await runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt', {
      maxOffsetSeconds: 60,
    });

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'ffsubsync',
      ['/tmp/ref.srt', '-i', '/tmp/in.srt', '-o', '/tmp/out.srt',
       '--max-offset-seconds', '60', '--output-encoding', 'same'],
      expect.objectContaining({ timeout: 30000 }),
    );
    expect(result.offsetSeconds).toBeCloseTo(2.0);
    expect(result.framerateScaleFactor).toBeCloseTo(1.0);
  });

  it('uses default maxOffsetSeconds of 120', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: 'offset seconds: 0\n', stderr: '' });

    await runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt');

    const args = mockExecFileAsync.mock.calls[0][1];
    const idx = args.indexOf('--max-offset-seconds');
    expect(args[idx + 1]).toBe('120');
  });

  it('throws on non-zero exit code', async () => {
    const err = new Error('sync failed');
    err.code = 1;
    err.stderr = 'some error output';
    mockExecFileAsync.mockRejectedValue(err);

    await expect(
      runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt'),
    ).rejects.toThrow('ffsubsync failed');
  });

  it('throws on timeout (killed process)', async () => {
    const err = new Error('timeout');
    err.killed = true;
    err.signal = 'SIGTERM';
    mockExecFileAsync.mockRejectedValue(err);

    await expect(
      runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt', { timeoutMs: 100 }),
    ).rejects.toThrow('timed out');
  });

  it('throws when output file is not created', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: 'offset seconds: 0\n', stderr: '' });
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    await expect(
      runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt'),
    ).rejects.toThrow('did not produce an output file');
  });

  it('respects custom timeoutMs', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    await runFfsubsync('/tmp/ref.srt', '/tmp/in.srt', '/tmp/out.srt', { timeoutMs: 5000 });

    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'ffsubsync',
      expect.any(Array),
      expect.objectContaining({ timeout: 5000 }),
    );
  });
});
