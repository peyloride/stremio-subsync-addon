import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the ffsubsync module
vi.mock('../../../src/sync/ffsubsync.js', () => ({
  runFfsubsync: vi.fn(),
}));

import { runFfsubsync } from '../../../src/sync/ffsubsync.js';
import { syncSubtitles } from '../../../src/sync/engine.js';

const SRT_CONTENT = Buffer.from(
  '1\n00:00:01,000 --> 00:00:03,000\nHello world\n',
);
const SYNCED_CONTENT = Buffer.from(
  '1\n00:00:02,000 --> 00:00:04,000\nHello world\n',
);

function candidate(overrides = {}) {
  return {
    id: 'sub-1',
    lang: 'en',
    content: SRT_CONTENT,
    filename: 'test.srt',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncSubtitles', () => {
  // spec: subtitle-sync > Sync toggle and configuration > Scenario: Sync disabled
  it('returns all unsynced when syncEnabled is false', async () => {
    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1' });
    const sub2 = candidate({ id: 'sub-2', lang: 'fr' });

    const results = await syncSubtitles([ref, sub1, sub2], ref, 'video.mkv', {
      syncEnabled: false,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.synced === false)).toBe(true);
    expect(runFfsubsync).not.toHaveBeenCalled();
  });

  it('returns all unsynced when reference is null', async () => {
    const sub1 = candidate({ id: 'sub-1' });
    const sub2 = candidate({ id: 'sub-2' });

    const results = await syncSubtitles([sub1, sub2], null, 'video.mkv', {});

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.synced === false)).toBe(true);
    expect(runFfsubsync).not.toHaveBeenCalled();
  });

  // spec: subtitle-sync > SRT-to-SRT synchronization > Scenario: Successful sync
  it('syncs non-reference candidates and returns synced content', async () => {
    runFfsubsync.mockResolvedValue({ offsetSeconds: 1.5, framerateScaleFactor: 1.0 });

    // The engine writes input files and reads output files.
    // Make runFfsubsync write the output file as a side effect.
    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      return { offsetSeconds: 1.5, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1', lang: 'fr' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    expect(results).toHaveLength(2);

    // Reference is returned as-is
    const refResult = results.find((r) => r.id === 'ref');
    expect(refResult.synced).toBe(false);
    expect(refResult.content).toEqual(SRT_CONTENT);

    // Non-reference is synced
    const subResult = results.find((r) => r.id === 'sub-1');
    expect(subResult.synced).toBe(true);
    expect(subResult.offsetSeconds).toBeCloseTo(1.5);
    expect(subResult.content).toEqual(SYNCED_CONTENT);
  });

  // spec: subtitle-sync > SRT-to-SRT synchronization > Scenario: Sync exceeds max offset
  it('falls back to unsynced when offset exceeds maxOffsetSeconds', async () => {
    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      return { offsetSeconds: 200, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    const subResult = results.find((r) => r.id === 'sub-1');
    expect(subResult.synced).toBe(false);
    expect(subResult.content).toEqual(SRT_CONTENT);
    expect(subResult.error).toContain('exceeds max');
  });

  // spec: subtitle-sync > SRT-to-SRT synchronization > Scenario: ffsubsync process failure
  it('falls back to unsynced when ffsubsync throws', async () => {
    runFfsubsync.mockRejectedValue(new Error('ffsubsync failed (exit 1): boom'));

    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    const subResult = results.find((r) => r.id === 'sub-1');
    expect(subResult.synced).toBe(false);
    expect(subResult.content).toEqual(SRT_CONTENT);
    expect(subResult.error).toContain('ffsubsync failed');
  });

  // spec: subtitle-sync > SRT-to-SRT synchronization > Scenario: Multiple languages synced against same reference
  it('syncs multiple candidates in parallel against the same reference', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      // Simulate some async work
      await new Promise((r) => setTimeout(r, 10));
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      concurrentCount--;
      return { offsetSeconds: 1.0, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref' });
    const subs = [
      candidate({ id: 'sub-1', lang: 'fr' }),
      candidate({ id: 'sub-2', lang: 'de' }),
      candidate({ id: 'sub-3', lang: 'es' }),
      candidate({ id: 'sub-4', lang: 'pt' }),
    ];

    const results = await syncSubtitles([ref, ...subs], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    expect(results).toHaveLength(5);
    expect(results.filter((r) => r.synced)).toHaveLength(4);
    // Semaphore limits to 3 concurrent
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(runFfsubsync).toHaveBeenCalledTimes(4);
  });

  it('handles negative offsets within threshold', async () => {
    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      return { offsetSeconds: -5.0, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    const subResult = results.find((r) => r.id === 'sub-1');
    expect(subResult.synced).toBe(true);
    expect(subResult.offsetSeconds).toBeCloseTo(-5.0);
  });

  it('preserves ASS extension for ASS subtitle candidates', async () => {
    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      expect(outputPath).toMatch(/\.ass$/);
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      return { offsetSeconds: 1.0, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref', filename: 'ref.ass' });
    const sub1 = candidate({ id: 'sub-1', filename: 'test.ass' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv', {
      syncEnabled: true,
      maxOffsetSeconds: 120,
    });

    expect(results.find((r) => r.id === 'sub-1').synced).toBe(true);
  });

  it('uses default config values when config is empty', async () => {
    runFfsubsync.mockImplementation(async (refPath, inputPath, outputPath) => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(outputPath, SYNCED_CONTENT);
      return { offsetSeconds: 1.0, framerateScaleFactor: 1.0 };
    });

    const ref = candidate({ id: 'ref' });
    const sub1 = candidate({ id: 'sub-1' });

    const results = await syncSubtitles([ref, sub1], ref, 'video.mkv');

    expect(results).toHaveLength(2);
    expect(runFfsubsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ maxOffsetSeconds: 120 }),
    );
  });
});
