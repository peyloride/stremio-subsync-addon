import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOWNLOAD_SCHEME,
  OpenSubtitlesProvider,
} from '../../../src/providers/opensubtitles.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function searchPayload() {
  return {
    data: [
      {
        id: 'sub-1',
        attributes: {
          subtitle_id: 'sub-1',
          language: 'English',
          release: 'Movie.2024.1080p.BluRay.x264-GRP',
          download_count: 1500,
          rating: 8.5,
          hearing_impaired: true,
          foreign_parts_only: false,
          files: [{ file_id: 111, file_name: 'Movie.2024.1080p.BluRay.x264-GRP.srt' }],
        },
      },
    ],
  };
}

const CONFIG = { opensubtitlesApiKey: 'test-key' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenSubtitlesProvider.search', () => {
  it('returns [] and does not call fetch when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider({});
    const results = await provider.search({ type: 'movie', imdbId: 'tt1234567', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when there is nothing to search with', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    const results = await provider.search({ type: 'movie', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does a hash lookup with moviehash/moviebytesize and marks hashMatch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(searchPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    const results = await provider.search({
      type: 'movie',
      videoHash: 'abcdef0123456789',
      videoSize: 734003200,
      languages: ['en', 'fr'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('/subtitles?');
    expect(calledUrl).toContain('moviehash=abcdef0123456789');
    expect(calledUrl).toContain('moviebytesize=734003200');
    expect(calledUrl).toContain('languages=en%2Cfr');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '111',
      provider: 'opensubtitles',
      lang: 'en',
      url: `${DOWNLOAD_SCHEME}111`,
      filename: 'Movie.2024.1080p.BluRay.x264-GRP.srt',
      releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
      hashMatch: true,
      downloads: 1500,
      rating: 8.5,
      hearingImpaired: true,
      forced: false,
    });
  });

  it('does an IMDB search, strips the tt prefix, and adds series params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await provider.search({
      type: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 5,
      languages: ['en'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('imdb_id=0903747');
    expect(calledUrl).not.toContain('imdb_id=tt');
    expect(calledUrl).toContain('season_number=1');
    expect(calledUrl).toContain('episode_number=5');
    expect(calledUrl).toContain('languages=en');
  });

  it('does a filename search via the query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await provider.search({
      type: 'movie',
      filename: 'Movie.2024.1080p.BluRay.x264-GRP.mkv',
      languages: ['en'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('query=Movie.2024.1080p.BluRay.x264-GRP.mkv');
  });

  it('sends the required headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await provider.search({ type: 'movie', imdbId: 'tt1234567', languages: ['en'] });

    const options = fetchMock.mock.calls[0][1];
    expect(options.headers['Api-Key']).toBe('test-key');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['User-Agent']).toBe('stremio-subsync-addon/1.0');
  });

  it('normalizes multiple files into separate subtitles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            attributes: {
              language: 'fre',
              release: 'Some.Release',
              files: [
                { file_id: 1, file_name: 'a.srt' },
                { file_id: 2, file_name: 'b.srt' },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    const results = await provider.search({ type: 'movie', imdbId: 'tt1', languages: ['fr'] });

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['1', '2']);
    expect(results.every((r) => r.lang === 'fr')).toBe(true);
  });

  it('throws on a non-429 API error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('HTTP 500');
  });

  it('retries once on HTTP 429 honoring Retry-After, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse(searchPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    const results = await provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it('throws when rate limiting persists past the retry budget', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('OpenSubtitlesProvider.download', () => {
  it('POSTs the file_id then fetches the temporary link into a Buffer', async () => {
    const link = 'https://dl.opensubtitles.com/tmp/file.srt';
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).endsWith('/download') && options?.method === 'POST') {
        return jsonResponse({ link, file_name: 'file.srt' });
      }
      if (url === link) {
        return new Response(Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHi'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    const sub = { provider: 'opensubtitles', url: `${DOWNLOAD_SCHEME}111`, id: '111' };
    const buffer = await provider.download(sub);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toContain('00:00:00,000');

    const postCall = fetchMock.mock.calls[0];
    expect(postCall[0]).toContain('/download');
    expect(JSON.parse(postCall[1].body)).toEqual({ file_id: 111 });
  });

  it('throws when the download response has no link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await expect(
      provider.download({ provider: 'opensubtitles', url: `${DOWNLOAD_SCHEME}1`, id: '1' }),
    ).rejects.toThrow('no link');
  });

  it('throws when the file id cannot be determined', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesProvider(CONFIG);
    await expect(provider.download({ provider: 'opensubtitles' })).rejects.toThrow(
      'missing file id',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
