import path from 'node:path';
import { promises as fs } from 'node:fs';

const CONTENT_EXTENSIONS = ['.srt', '.ass'];

/**
 * Disk-backed cache for synced subtitle files.
 *
 * Layout:
 *   <cacheDir>/<videoHash>/<subtitleId>.srt        (or .ass)
 *   <cacheDir>/<videoHash>/<subtitleId>.meta.json
 *
 * The meta sidecar records sync metadata including `syncedAt` which drives
 * TTL-based expiry.
 */
export class CacheStore {
  /**
   * @param {string} cacheDir  Root directory for cached files.
   * @param {number} ttlDays   Entries older than this are treated as expired.
   */
  constructor(cacheDir, ttlDays) {
    this.cacheDir = path.resolve(cacheDir);
    this.ttlDays = ttlDays;
    this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  }

  // ── path helpers ────────────────────────────────────────────────────

  _hashDir(videoHash) {
    return path.join(this.cacheDir, videoHash);
  }

  _contentPath(videoHash, subId, ext) {
    return path.join(this.cacheDir, videoHash, `${subId}${ext}`);
  }

  _metaPath(videoHash, subId) {
    return path.join(this.cacheDir, videoHash, `${subId}.meta.json`);
  }

  /**
   * Find the content file for an entry, checking .srt then .ass.
   * @returns {Promise<string|null>} absolute path or null
   */
  async _findContentPath(videoHash, subId) {
    for (const ext of CONTENT_EXTENSIONS) {
      const p = this._contentPath(videoHash, subId, ext);
      try {
        await fs.access(p);
        return p;
      } catch {
        // not found — try next extension
      }
    }
    return null;
  }

  /**
   * Delete all files belonging to one cache entry (content + meta).
   */
  async _deleteEntry(videoHash, subId) {
    const files = [
      ...CONTENT_EXTENSIONS.map((ext) => this._contentPath(videoHash, subId, ext)),
      this._metaPath(videoHash, subId),
    ];
    await Promise.all(files.map((f) => fs.unlink(f).catch(() => {})));
  }

  /**
   * Read and parse the meta sidecar. Returns null when missing or corrupt.
   */
  async _readMeta(videoHash, subId) {
    try {
      const raw = await fs.readFile(this._metaPath(videoHash, subId), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Check whether a meta entry has exceeded the TTL.
   */
  _isExpired(meta) {
    const syncedAt = new Date(meta.syncedAt).getTime();
    if (Number.isNaN(syncedAt)) return true;
    return Date.now() - syncedAt > this.ttlMs;
  }

  // ── public API ──────────────────────────────────────────────────────

  /**
   * Retrieve a cached subtitle.
   *
   * @returns {Promise<{content: Buffer, meta: object}|null>}
   *   null when the entry is missing, expired, or the content file is gone.
   *   Expired entries are deleted as a side-effect.
   */
  async get(videoHash, subId) {
    const meta = await this._readMeta(videoHash, subId);
    if (!meta) return null;

    if (this._isExpired(meta)) {
      await this._deleteEntry(videoHash, subId);
      return null;
    }

    const contentPath = await this._findContentPath(videoHash, subId);
    if (!contentPath) return null;

    try {
      const content = await fs.readFile(contentPath);
      return { content, meta };
    } catch {
      return null;
    }
  }

  /**
   * Store a synced subtitle and its metadata.
   *
   * @param {string} videoHash
   * @param {string} subId       Base identifier (no extension).
   * @param {Buffer} content     Subtitle file bytes.
   * @param {object} meta        Must include `syncedAt` (ISO-8601 string).
   * @param {string} [ext='.srt']  File extension: '.srt' or '.ass'.
   */
  async put(videoHash, subId, content, meta, ext = '.srt') {
    const dir = this._hashDir(videoHash);
    await fs.mkdir(dir, { recursive: true });

    const contentPath = this._contentPath(videoHash, subId, ext);
    const metaPath = this._metaPath(videoHash, subId);

    await Promise.all([
      fs.writeFile(contentPath, content),
      fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8'),
    ]);
  }

  /**
   * Check whether a valid (non-expired) cache entry exists.
   *
   * @returns {Promise<boolean>}
   */
  async has(videoHash, subId) {
    const meta = await this._readMeta(videoHash, subId);
    if (!meta) return false;
    if (this._isExpired(meta)) return false;

    const contentPath = await this._findContentPath(videoHash, subId);
    return contentPath !== null;
  }

  /**
   * Return the absolute path of the cached content file, or null if it
   * does not exist. Useful for building `/sub/` endpoint URLs.
   *
   * @returns {Promise<string|null>}
   */
  async getPath(videoHash, subId) {
    return this._findContentPath(videoHash, subId);
  }

  /**
   * Scan the cache directory and delete entries whose meta sidecar is
   * older than the TTL.
   *
   * @returns {Promise<number>} Number of evicted entries.
   */
  async evict() {
    let evicted = 0;

    let hashDirs;
    try {
      hashDirs = await fs.readdir(this.cacheDir, { withFileTypes: true });
    } catch {
      return 0; // cache dir doesn't exist yet
    }

    for (const hashEntry of hashDirs) {
      if (!hashEntry.isDirectory()) continue;
      const videoHash = hashEntry.name;

      let files;
      try {
        files = await fs.readdir(this._hashDir(videoHash));
      } catch {
        continue;
      }

      // Collect unique subIds from meta sidecars
      const subIds = new Set(
        files
          .filter((f) => f.endsWith('.meta.json'))
          .map((f) => f.slice(0, -'.meta.json'.length)),
      );

      for (const subId of subIds) {
        const meta = await this._readMeta(videoHash, subId);
        if (!meta || this._isExpired(meta)) {
          await this._deleteEntry(videoHash, subId);
          evicted++;
        }
      }

      // Remove the hash directory if it's now empty
      try {
        const remaining = await fs.readdir(this._hashDir(videoHash));
        if (remaining.length === 0) {
          await fs.rmdir(this._hashDir(videoHash));
        }
      } catch {
        // ignore
      }
    }

    return evicted;
  }

  /**
   * Count cached subtitle files and their total size.
   *
   * @returns {Promise<{entries: number, sizeBytes: number}>}
   */
  async stats() {
    let entries = 0;
    let sizeBytes = 0;

    let hashDirs;
    try {
      hashDirs = await fs.readdir(this.cacheDir, { withFileTypes: true });
    } catch {
      return { entries, sizeBytes };
    }

    for (const hashEntry of hashDirs) {
      if (!hashEntry.isDirectory()) continue;

      let files;
      try {
        files = await fs.readdir(this._hashDir(hashEntry.name), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.isFile()) continue;
        const ext = path.extname(file.name).toLowerCase();
        if (ext !== '.srt' && ext !== '.ass') continue;

        entries++;
        try {
          const stat = await fs.stat(path.join(this._hashDir(hashEntry.name), file.name));
          sizeBytes += stat.size;
        } catch {
          // file disappeared between readdir and stat
        }
      }
    }

    return { entries, sizeBytes };
  }
}
