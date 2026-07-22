import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CacheStore } from '../../../src/cache/store.js';

const SRT_CONTENT = Buffer.from(
  '1\n00:00:01,000 --> 00:00:03,000\nHello world\n',
  'utf-8',
);

const ASS_CONTENT = Buffer.from(
  '[Script Info]\nTitle: Test\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:03.00,,Hello\n',
  'utf-8',
);

function makeMeta(overrides = {}) {
  return {
    offsetSeconds: -5.2,
    framerateScaleFactor: 1.0,
    referenceId: 'ref-001',
    syncedAt: new Date().toISOString(),
    provider: 'opensubtitles',
    ...overrides,
  };
}

describe('CacheStore', () => {
  let tmpDir;
  let store;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cache-test-'));
    store = new CacheStore(tmpDir, 30);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── put / get round-trip ──────────────────────────────────────────

  describe('put + get round-trip', () => {
    it('stores and retrieves an SRT file with metadata', async () => {
      const meta = makeMeta();
      await store.put('hash1', 'sub1', SRT_CONTENT, meta);

      const result = await store.get('hash1', 'sub1');
      expect(result).not.toBeNull();
      expect(result.content).toEqual(SRT_CONTENT);
      expect(result.meta.offsetSeconds).toBe(-5.2);
      expect(result.meta.referenceId).toBe('ref-001');
      expect(result.meta.provider).toBe('opensubtitles');
    });

    it('stores and retrieves an ASS file', async () => {
      const meta = makeMeta();
      await store.put('hash1', 'sub-ass', ASS_CONTENT, meta, '.ass');

      const result = await store.get('hash1', 'sub-ass');
      expect(result).not.toBeNull();
      expect(result.content).toEqual(ASS_CONTENT);
    });

    it('creates nested directories automatically', async () => {
      await store.put('deep', 'sub1', SRT_CONTENT, makeMeta());

      const dirEntries = await fs.readdir(path.join(tmpDir, 'deep'));
      expect(dirEntries).toContain('sub1.srt');
      expect(dirEntries).toContain('sub1.meta.json');
    });

    it('overwrites an existing entry', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta({ offsetSeconds: -1 }));
      const updated = Buffer.from('updated content');
      await store.put('hash1', 'sub1', updated, makeMeta({ offsetSeconds: -2 }));

      const result = await store.get('hash1', 'sub1');
      expect(result.content).toEqual(updated);
      expect(result.meta.offsetSeconds).toBe(-2);
    });
  });

  // ── cache miss ────────────────────────────────────────────────────

  describe('cache miss', () => {
    it('returns null for a non-existent entry', async () => {
      const result = await store.get('nope', 'nothing');
      expect(result).toBeNull();
    });

    it('returns null when meta exists but content file is missing', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());
      // Delete only the content file
      await fs.unlink(path.join(tmpDir, 'hash1', 'sub1.srt'));

      const result = await store.get('hash1', 'sub1');
      expect(result).toBeNull();
    });

    it('returns null when content exists but meta is missing', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());
      await fs.unlink(path.join(tmpDir, 'hash1', 'sub1.meta.json'));

      const result = await store.get('hash1', 'sub1');
      expect(result).toBeNull();
    });
  });

  // ── has ───────────────────────────────────────────────────────────

  describe('has', () => {
    it('returns true for a valid entry', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());
      expect(await store.has('hash1', 'sub1')).toBe(true);
    });

    it('returns false for a missing entry', async () => {
      expect(await store.has('hash1', 'nope')).toBe(false);
    });

    it('returns false for an expired entry', async () => {
      const oldMeta = makeMeta({
        syncedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await store.put('hash1', 'sub1', SRT_CONTENT, oldMeta);
      expect(await store.has('hash1', 'sub1')).toBe(false);
    });
  });

  // ── TTL expiry ────────────────────────────────────────────────────

  describe('TTL expiry', () => {
    it('returns null and deletes the entry when expired', async () => {
      const oldMeta = makeMeta({
        syncedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await store.put('hash1', 'sub1', SRT_CONTENT, oldMeta);

      const result = await store.get('hash1', 'sub1');
      expect(result).toBeNull();

      // Files should be cleaned up
      const files = await fs.readdir(path.join(tmpDir, 'hash1')).catch(() => []);
      expect(files).not.toContain('sub1.srt');
      expect(files).not.toContain('sub1.meta.json');
    });

    it('returns the entry when within TTL', async () => {
      const recentMeta = makeMeta({
        syncedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await store.put('hash1', 'sub1', SRT_CONTENT, recentMeta);

      const result = await store.get('hash1', 'sub1');
      expect(result).not.toBeNull();
      expect(result.content).toEqual(SRT_CONTENT);
    });

    it('treats corrupt syncedAt as expired', async () => {
      const badMeta = makeMeta({ syncedAt: 'not-a-date' });
      await store.put('hash1', 'sub1', SRT_CONTENT, badMeta);

      const result = await store.get('hash1', 'sub1');
      expect(result).toBeNull();
    });
  });

  // ── getPath ───────────────────────────────────────────────────────

  describe('getPath', () => {
    it('returns the absolute path for an SRT entry', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());

      const p = await store.getPath('hash1', 'sub1');
      expect(p).toBe(path.join(tmpDir, 'hash1', 'sub1.srt'));
    });

    it('returns the absolute path for an ASS entry', async () => {
      await store.put('hash1', 'sub1', ASS_CONTENT, makeMeta(), '.ass');

      const p = await store.getPath('hash1', 'sub1');
      expect(p).toBe(path.join(tmpDir, 'hash1', 'sub1.ass'));
    });

    it('returns null for a missing entry', async () => {
      const p = await store.getPath('hash1', 'nope');
      expect(p).toBeNull();
    });
  });

  // ── evict ─────────────────────────────────────────────────────────

  describe('evict', () => {
    it('deletes expired entries and returns the count', async () => {
      const old = makeMeta({
        syncedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const fresh = makeMeta();

      await store.put('hash1', 'old1', SRT_CONTENT, old);
      await store.put('hash1', 'old2', SRT_CONTENT, old);
      await store.put('hash2', 'fresh1', SRT_CONTENT, fresh);

      const evicted = await store.evict();
      expect(evicted).toBe(2);

      // Fresh entry still exists
      expect(await store.has('hash2', 'fresh1')).toBe(true);
      // Old entries gone
      expect(await store.has('hash1', 'old1')).toBe(false);
      expect(await store.has('hash1', 'old2')).toBe(false);
    });

    it('removes empty hash directories after eviction', async () => {
      const old = makeMeta({
        syncedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await store.put('lonely', 'sub1', SRT_CONTENT, old);

      await store.evict();

      const entries = await fs.readdir(tmpDir);
      expect(entries).not.toContain('lonely');
    });

    it('returns 0 when cache directory does not exist', async () => {
      const emptyStore = new CacheStore(path.join(tmpDir, 'nonexistent'), 30);
      const evicted = await emptyStore.evict();
      expect(evicted).toBe(0);
    });

    it('returns 0 when nothing is expired', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());
      const evicted = await store.evict();
      expect(evicted).toBe(0);
    });

    it('evicts entries with corrupt meta', async () => {
      // Write a corrupt meta file manually
      const dir = path.join(tmpDir, 'hash1');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'sub1.srt'), SRT_CONTENT);
      await fs.writeFile(path.join(dir, 'sub1.meta.json'), '{invalid json');

      const evicted = await store.evict();
      expect(evicted).toBe(1);
    });
  });

  // ── stats ─────────────────────────────────────────────────────────

  describe('stats', () => {
    it('counts entries and sums sizes', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());
      await store.put('hash1', 'sub2', ASS_CONTENT, makeMeta(), '.ass');
      await store.put('hash2', 'sub3', SRT_CONTENT, makeMeta());

      const { entries, sizeBytes } = await store.stats();
      expect(entries).toBe(3);
      expect(sizeBytes).toBe(SRT_CONTENT.length * 2 + ASS_CONTENT.length);
    });

    it('ignores meta.json files in the count', async () => {
      await store.put('hash1', 'sub1', SRT_CONTENT, makeMeta());

      const { entries } = await store.stats();
      expect(entries).toBe(1); // only the .srt, not the .meta.json
    });

    it('returns zeros for an empty cache', async () => {
      const { entries, sizeBytes } = await store.stats();
      expect(entries).toBe(0);
      expect(sizeBytes).toBe(0);
    });

    it('returns zeros when cache directory does not exist', async () => {
      const emptyStore = new CacheStore(path.join(tmpDir, 'nonexistent'), 30);
      const { entries, sizeBytes } = await emptyStore.stats();
      expect(entries).toBe(0);
      expect(sizeBytes).toBe(0);
    });
  });

  // ── ASS extension handling ────────────────────────────────────────

  describe('ASS extension handling', () => {
    it('serves ASS content when stored with .ass extension', async () => {
      await store.put('hash1', 'ass-sub', ASS_CONTENT, makeMeta(), '.ass');

      const result = await store.get('hash1', 'ass-sub');
      expect(result).not.toBeNull();
      expect(result.content.toString()).toContain('[Script Info]');
    });

    it('prefers .srt over .ass when both exist for the same subId', async () => {
      // Write both extensions for the same subId
      await store.put('hash1', 'dual', SRT_CONTENT, makeMeta(), '.srt');
      // Manually write an .ass file alongside
      await fs.writeFile(path.join(tmpDir, 'hash1', 'dual.ass'), ASS_CONTENT);

      const p = await store.getPath('hash1', 'dual');
      expect(p).toBe(path.join(tmpDir, 'hash1', 'dual.srt'));
    });
  });
});
