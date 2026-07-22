import AdmZip from 'adm-zip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the sync engine so no ffsubsync/temp-file work happens in unit tests.
vi.mock('../../../src/sync/engine.js', () => ({
  syncSubtitles: vi.fn(),
}));

import { syncSubtitles } from '../../../src/sync/engine.js';
import {
  CACHE_MAX_AGE,
  createSubtitlesHandler,
  parseVideoId,
  resolveVideoKey,
} from '../../../src/handlers/subtitles.js';

// --- helpers ---------------------------------------------------------------

function sub(overrides = {}) {
  return {
    id: 'sub-1',
    provider: 'test',
    lang: 'en',
    url: 'https://example.com/sub-1.srt',
    filename: 'Movie.2024.1080p.BluRay.x264-GRP.srt',
    releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
    hashMatch: false,
    downloads: 100,
    rating: 5,
    ...overrides,
  };
}

function makeRegistry(results, { providers = [{ name: 'test' }], download } = {}) {
  return {
    providers,
    searchAll: vi.fn().mockResolvedValue(results),
    download: vi.fn().mockImplementation(download ?? (async (s) => Buffer.from(`content-${s.id}`))),
  };
}

function makeCache({ has = false } = {}) {
  return {
    has: vi.fn().mockResolvedValue(has),
    put: vi.fn().mockResolvedValue(),
    getPath: vi.fn().mockResolvedValue(null),
    stats: vi.fn().mockResolvedValue({ entries: 0, sizeBytes: 0 }),
  };
}

function buildHandler({ registry, cache, ff = true }) {
  return createSubtitlesHandler({
    registry,
    cache,
    checkFfsubsync: async () => ff,
  });
}

const MOVIE_ARGS = {
  type: 'movie',
  id: 'tt1234567',
  extra: {
    videoHash: 'abc123',
    videoSize: '123456',
    filename: 'Movie.2024.1080p.BluRay.x264-GRP.mkv',
  },
  config: { languages: 'en', syncEnabled: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default sync mock: echo candidates, marking non-reference as synced.
  syncSubtitles.mockImplementation(async (cands, ref) =>
    cands.map((c) => ({
      id: c.id,
      lang: c.lang,
      content: Buffer.from(`synced-${c.id}`),
      synced: ref ? c.id !== ref.id : false,
      offsetSeconds: ref && c.id !== ref.id ? 2.5 : null,
      framerateScaleFactor: ref && c.id !== ref.id ? 1 : null,
      error: null,
    })),
  );
});

// --- parseVideoId (task 7.3) ----------------------------------------------

describe('parseVideoId', () => {
  it('parses a movie id', () => {
    expect(parseVideoId('movie', 'tt1234567')).toEqual({
      type: 'movie',
      imdbId: 'tt1234567',
      season: undefined,
      episode: undefined,
    });
  });

  it('parses a series id with season and episode', () => {
    expect(parseVideoId('series', 'tt1234567:1:5')).toEqual({
      type: 'series',
      imdbId: 'tt1234567',
      season: 1,
      episode: 5,
    });
  });

  it('returns null imdbId for a malformed id', () => {
    expect(parseVideoId('movie', 'notanid').imdbId).toBeNull();
  });
});

describe('resolveVideoKey', () => {
  it('uses the videoHash when present', () => {
    expect(resolveVideoKey({ videoHash: 'abc123' })).toBe('abc123');
  });

  it('derives a stable key from the filename when videoHash is absent', () => {
    const a = resolveVideoKey({ filename: 'Movie.mkv' });
    const b = resolveVideoKey({ filename: 'Movie.mkv' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns null when nothing usable is provided', () => {
    expect(resolveVideoKey({})).toBeNull();
  });
});

// --- handler pipeline (task 7.1, 7.2) -------------------------------------

describe('createSubtitlesHandler', () => {
  it('throws when registry or cache is missing', () => {
    expect(() => createSubtitlesHandler({ cache: makeCache() })).toThrow(/registry/);
    expect(() => createSubtitlesHandler({ registry: makeRegistry([]) })).toThrow(/cache/);
  });

  it('builds the registry from the per-request config (API keys honoured)', async () => {
    // Regression: API keys arrive in the Stremio install-URL config, not the
    // startup config. The registry must be built per request from args.config.
    const registry = makeRegistry([sub({ id: 'sub-1' })]);
    const createRegistry = vi.fn().mockReturnValue(registry);
    const handler = createSubtitlesHandler({
      createRegistry,
      cache: makeCache(),
      checkFfsubsync: async () => true,
    });

    await handler({ ...MOVIE_ARGS, config: { subdlApiKey: 'secret-key', languages: 'fr' } });

    expect(createRegistry).toHaveBeenCalledTimes(1);
    const cfg = createRegistry.mock.calls[0][0];
    expect(cfg.subdlApiKey).toBe('secret-key');
    expect(cfg.languages).toEqual(['fr']);
    expect(registry.searchAll).toHaveBeenCalledTimes(1);
  });

  it('handles a movie request through the sync pipeline', async () => {
    const candidates = [
      sub({ id: 'sub-1', downloads: 10 }),
      sub({ id: 'sub-2', downloads: 999, hashMatch: true }),
    ];
    const registry = makeRegistry(candidates);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    // Query built from parsed args (task 7.1).
    expect(registry.searchAll).toHaveBeenCalledTimes(1);
    const query = registry.searchAll.mock.calls[0][0];
    expect(query).toMatchObject({
      type: 'movie',
      imdbId: 'tt1234567',
      videoHash: 'abc123',
      videoSize: 123456,
      filename: 'Movie.2024.1080p.BluRay.x264-GRP.mkv',
      languages: ['en'],
    });
    expect(query.season).toBeUndefined();
    expect(query.episode).toBeUndefined();

    // Sync ran against the hash-matched reference.
    expect(syncSubtitles).toHaveBeenCalledTimes(1);
    const [, reference] = syncSubtitles.mock.calls[0];
    expect(reference.id).toBe('sub-2');

    // Both candidates cached and served.
    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(res.cacheMaxAge).toBe(CACHE_MAX_AGE);
    expect(res.subtitles).toHaveLength(2);
    expect(res.subtitles).toEqual(
      expect.arrayContaining([
        { id: 'sub-1', url: '/sub/abc123/sub-1.srt', lang: 'en' },
        { id: 'sub-2', url: '/sub/abc123/sub-2.srt', lang: 'en' },
      ]),
    );

    // The non-reference candidate is recorded as synced.
    const putCalls = cache.put.mock.calls;
    const sub1Put = putCalls.find((c) => c[1] === 'sub-1');
    expect(sub1Put[4]).toBe('.srt');
    expect(sub1Put[3]).toMatchObject({ synced: true, referenceId: 'sub-2' });
  });

  it('extracts archived provider downloads before syncing and caching', async () => {
    const zip = new AdmZip();
    zip.addFile('House.of.the.Dragon.S03E03.tr.srt', Buffer.from(
      '1\n00:00:01,000 --> 00:00:02,000\nMerhaba\n',
    ));
    const registry = makeRegistry([
      sub({
        id: 'sub-zip',
        provider: 'subdl',
        lang: 'tr',
        filename: 'House.of.the.Dragon.S03E03.zip',
      }),
    ], { download: async () => zip.toBuffer() });
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    await handler({
      ...MOVIE_ARGS,
      config: { languages: 'tr', syncEnabled: true },
    });

    const cachedContent = cache.put.mock.calls[0][2];
    expect(cachedContent.toString()).toContain('Merhaba');
    expect(cachedContent.subarray(0, 2).toString()).not.toBe('PK');
  });

  it('handles a series request, parsing season and episode into the query', async () => {
    const registry = makeRegistry([sub({ id: 'sub-1' })]);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler({
      type: 'series',
      id: 'tt1234567:1:5',
      extra: { videoHash: 'abc123', filename: 'Show.S01E05.mkv' },
      config: { languages: 'en' },
    });

    const query = registry.searchAll.mock.calls[0][0];
    expect(query).toMatchObject({
      type: 'series',
      imdbId: 'tt1234567',
      season: 1,
      episode: 5,
    });
    expect(res.subtitles).toHaveLength(1);
    expect(res.subtitles[0].url).toBe('/sub/abc123/sub-1.srt');
  });

  it('emits absolute subtitle URLs when a public base URL is configured', async () => {
    vi.stubEnv('PUBLIC_URL', 'https://subsync.example.test/');
    const registry = makeRegistry([sub({ id: 'sub-1' })]);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    expect(res.subtitles[0].url).toBe(
      'https://subsync.example.test/sub/abc123/sub-1.srt',
    );
    vi.unstubAllEnvs();
  });

  it('serves cached entries directly without downloading or syncing', async () => {
    const registry = makeRegistry([sub({ id: 'sub-1' })]);
    const cache = makeCache({ has: true });
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    expect(cache.has).toHaveBeenCalledWith('abc123', 'sub-1');
    expect(registry.download).not.toHaveBeenCalled();
    expect(syncSubtitles).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(res.subtitles).toEqual([
      { id: 'sub-1', url: '/sub/abc123/sub-1.srt', lang: 'en' },
    ]);
    expect(res.cacheMaxAge).toBe(CACHE_MAX_AGE);
  });

  it('serves the best result unsynced when sync is disabled', async () => {
    const candidates = [
      sub({ id: 'sub-1', downloads: 10 }),
      sub({ id: 'sub-2', downloads: 999, hashMatch: true }),
    ];
    const registry = makeRegistry(candidates);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler({
      ...MOVIE_ARGS,
      config: { languages: 'en', syncEnabled: false },
    });

    expect(syncSubtitles).not.toHaveBeenCalled();
    // Only the best candidate is served, unsynced.
    expect(res.subtitles).toEqual([
      { id: 'sub-2', url: '/sub/abc123/sub-2.srt', lang: 'en' },
    ]);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0][3]).toMatchObject({ synced: false, referenceId: null });
  });

  it('returns empty subtitles when providers return nothing', async () => {
    const registry = makeRegistry([]);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    expect(res).toEqual({ subtitles: [], cacheMaxAge: CACHE_MAX_AGE });
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('returns empty subtitles when no providers are configured', async () => {
    const registry = makeRegistry([sub()], { providers: [] });
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    expect(res).toEqual({ subtitles: [], cacheMaxAge: CACHE_MAX_AGE });
    expect(registry.searchAll).not.toHaveBeenCalled();
  });

  it('searches by filename only when videoHash is absent', async () => {
    const registry = makeRegistry([sub({ id: 'sub-1' })]);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler({
      type: 'movie',
      id: 'tt1234567',
      extra: { filename: 'Movie.2024.1080p.mkv' },
      config: { languages: 'en' },
    });

    const query = registry.searchAll.mock.calls[0][0];
    expect(query.videoHash).toBeUndefined();
    expect(query.filename).toBe('Movie.2024.1080p.mkv');

    expect(res.subtitles).toHaveLength(1);
    // URL is keyed by a stable hash derived from the filename.
    expect(res.subtitles[0].url).toMatch(/^\/sub\/[0-9a-f]{16}\/sub-1\.srt$/);
  });

  it('serves unsynced subtitles when ffsubsync is unavailable', async () => {
    const candidates = [
      sub({ id: 'sub-1', downloads: 10 }),
      sub({ id: 'sub-2', downloads: 999, hashMatch: true }),
    ];
    const registry = makeRegistry(candidates);
    const cache = makeCache();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = buildHandler({ registry, cache, ff: false });

    try {
      const res = await handler(MOVIE_ARGS);
      expect(syncSubtitles).not.toHaveBeenCalled();
      expect(res.subtitles).toHaveLength(1);
      expect(cache.put.mock.calls[0][3]).toMatchObject({ synced: false });
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ffsubsync/));
    } finally {
      warn.mockRestore();
    }
  });

  it('uses the .ass extension for ASS subtitle candidates', async () => {
    const registry = makeRegistry([sub({ id: 'sub-1', filename: 'Movie.ass' })]);
    const cache = makeCache();
    const handler = buildHandler({ registry, cache });

    const res = await handler(MOVIE_ARGS);

    expect(res.subtitles[0].url).toBe('/sub/abc123/sub-1.ass');
    expect(cache.put.mock.calls[0][4]).toBe('.ass');
  });
});
