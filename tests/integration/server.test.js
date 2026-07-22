import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseConfig } from '../../src/config.js';
import { manifest } from '../../src/manifest.js';
import { createApp, startServer } from '../../src/server.js';

const SRT_BODY = '1\n00:00:01,000 --> 00:00:02,000\nHello there\n';
const ASS_BODY = '[Script Info]\nScriptType: v4.00+\n';

describe('addon HTTP endpoints', () => {
  let cacheDir;
  let app;

  beforeAll(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'subsync-cache-'));
    mkdirSync(path.join(cacheDir, 'abc123'), { recursive: true });
    writeFileSync(path.join(cacheDir, 'abc123', 'sub-1.srt'), SRT_BODY);
    writeFileSync(path.join(cacheDir, 'abc123', 'sub-2.ass'), ASS_BODY);
    // Inject a provider-less registry and a failing ffsubsync probe so the
    // subtitles handler is exercised deterministically without network access.
    app = createApp(parseConfig({ cacheDir }, {}), {
      registry: {
        providers: [],
        searchAll: async () => [],
        download: async () => {
          throw new Error('no providers configured');
        },
      },
      checkFfsubsync: async () => false,
    });
  });

  afterAll(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('serves the manifest with configurable behavior hints', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('com.subsync.stremio');
    expect(res.body.version).toBe(manifest.version);
    expect(res.body.resources).toEqual([{ name: 'subtitles', types: ['movie', 'series'] }]);
    expect(res.body.types).toEqual(['movie', 'series']);
    expect(res.body.idPrefixes).toBeUndefined();
    expect(res.body.behaviorHints.configurable).toBe(true);
    expect(res.body.config.length).toBeGreaterThan(0);
  });

  it('returns empty subtitles when no providers are configured, with a 24h cache header', async () => {
    const res = await request(app).get('/subtitles/movie/tt1234567.json');
    expect(res.status).toBe(200);
    // The SDK router echoes cacheMaxAge in the body and maps it to the
    // Cache-Control header.
    expect(res.body.subtitles).toEqual([]);
    expect(res.body.cacheMaxAge).toBe(86400);
    expect(res.headers['cache-control']).toContain('max-age=86400');
  });

  it('accepts series ids with season and episode', async () => {
    const res = await request(app).get('/subtitles/series/tt1234567:1:5.json');
    expect(res.status).toBe(200);
    expect(res.body.subtitles).toEqual([]);
  });

  it('reports health with version and cache stats', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(res.body.version).toBe(manifest.version);
    // The cache dir seeded in beforeAll holds one .srt and one .ass file.
    expect(res.body.cache).toEqual({
      entries: 2,
      sizeBytes: Buffer.byteLength(SRT_BODY) + Buffer.byteLength(ASS_BODY),
    });
    if (res.body.status === 'degraded') {
      expect(res.body.warning).toMatch(/ffsubsync/);
    }
  });

  it('serves cached .srt files as text/srt', async () => {
    const res = await request(app).get('/sub/abc123/sub-1.srt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/srt');
    expect(res.text).toBe(SRT_BODY);
  });

  it('serves cached .ass files as text/x-ssa', async () => {
    const res = await request(app).get('/sub/abc123/sub-2.ass');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/x-ssa');
    expect(res.text).toBe(ASS_BODY);
  });

  it('returns 404 for missing subtitle files', async () => {
    const res = await request(app).get('/sub/abc123/missing.srt');
    expect(res.status).toBe(404);
  });

  it('returns 404 for missing video hash directories', async () => {
    const res = await request(app).get('/sub/doesnotexist/sub-1.srt');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unsupported extensions', async () => {
    const res = await request(app).get('/sub/abc123/sub-1.txt');
    expect(res.status).toBe(404);
  });

  it('rejects path traversal attempts with 404', async () => {
    const traversal = await request(app).get('/sub/..%2fsrc/manifest.js.srt');
    expect(traversal.status).toBe(404);

    const dotted = await request(app).get('/sub/../package.json.srt');
    expect([301, 404]).toContain(dotted.status);
  });
});

describe('startServer', () => {
  it('listens on an ephemeral port and serves the manifest over HTTP', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'subsync-srv-'));
    const { server } = await startServer(parseConfig({ port: 0, cacheDir }, {}));
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/manifest.json`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('com.subsync.stremio');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
