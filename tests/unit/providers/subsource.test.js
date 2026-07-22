import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubsourceProvider } from '../../../src/providers/subsource.js';

const BASE_URL = 'https://api.subsource.net/api/v1';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Mock fetch that handles the movie-search then subtitle-search flow. */
function mockFetchFlow({ movieItems = [], subtitles = {}, subtitleStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith(`${BASE_URL}/movies/search`)) {
      return jsonResponse({ items: movieItems });
    }
    if (u.startsWith(`${BASE_URL}/subtitles?`)) {
      return new Response(JSON.stringify(subtitles), { status: subtitleStatus });
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SubsourceProvider.search', () => {
  it('returns [] when there is no API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    const results = await provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when there is no IMDB id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    const results = await provider.search({ type: 'movie', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves linkName then searches subtitles via GET with X-API-Key', async () => {
    const fetchMock = mockFetchFlow({
      movieItems: [{ linkName: 'the-movie-2024' }],
      subtitles: {
        items: [
          {
            id: 555,
            release: 'Movie.2024.1080p.BluRay.x264-GRP',
            language: 'english',
            downloads: 88,
            rating: 8,
            hi: true,
            forced: false,
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'test-key' });
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt1234567',
      languages: ['en'],
    });

    // First call: movie search
    const [movieUrl, movieOpts] = fetchMock.mock.calls[0];
    expect(String(movieUrl)).toContain(`${BASE_URL}/movies/search`);
    expect(String(movieUrl)).toContain('searchType=imdb');
    expect(String(movieUrl)).toContain('imdb=tt1234567');
    expect(movieOpts.headers['X-API-Key']).toBe('test-key');

    // Second call: subtitle search
    const [subUrl, subOpts] = fetchMock.mock.calls[1];
    expect(String(subUrl)).toContain(`${BASE_URL}/subtitles?`);
    expect(String(subUrl)).toContain('movieName=the-movie-2024');
    expect(String(subUrl)).toContain('language=en');
    expect(subOpts.headers['X-API-Key']).toBe('test-key');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '555',
      provider: 'subsource',
      lang: 'en',
      url: `${BASE_URL}/subtitles/555/download`,
      releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
      hashMatch: false,
      downloads: 88,
      rating: 8,
      hearingImpaired: true,
    });
  });

  it('accepts the API data response field', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (String(url).startsWith(`${BASE_URL}/movies/search`)) {
        return jsonResponse({ data: [{ linkName: 'the-movie' }] });
      }
      return jsonResponse({ data: [{ id: 1, language: 'tr' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    const results = await provider.search({ type: 'movie', imdbId: 'tt1', languages: ['tr'] });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('includes season param for series queries', async () => {
    const fetchMock = mockFetchFlow({
      movieItems: [{ linkName: 'breaking-bad' }],
      subtitles: { items: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    await provider.search({
      type: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 2,
      languages: ['en'],
    });

    const subUrl = String(fetchMock.mock.calls[1][0]);
    expect(subUrl).toContain('movieName=breaking-bad');
    expect(subUrl).toContain('season=1');
  });

  it('returns [] when movie search finds no results', async () => {
    const fetchMock = mockFetchFlow({ movieItems: [] });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt9999999',
      languages: ['en'],
    });

    expect(results).toEqual([]);
    // Only the movie search call, no subtitle search
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a subtitle search API error', async () => {
    const fetchMock = mockFetchFlow({
      movieItems: [{ linkName: 'some-movie' }],
      subtitleStatus: 500,
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('SubsourceProvider.download', () => {
  it('fetches the subtitle URL via GET with X-API-Key and returns a Buffer', async () => {
    const subUrl = `${BASE_URL}/subtitles/555/download`;
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url) === subUrl) {
        expect(options.headers['X-API-Key']).toBe('my-key');
        return new Response(Buffer.from('SUB CONTENT'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'my-key' });
    const buffer = await provider.download({
      provider: 'subsource',
      id: '555',
      url: subUrl,
    });

    expect(buffer.toString()).toBe('SUB CONTENT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on a download HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    await expect(
      provider.download({ provider: 'subsource', id: '1', url: `${BASE_URL}/subtitles/1/download` }),
    ).rejects.toThrow('HTTP 404');
  });

  it('throws when the subtitle url is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider({ subsourceApiKey: 'key' });
    await expect(provider.download({ provider: 'subsource' })).rejects.toThrow('missing url');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
