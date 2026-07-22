import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DOWNLOAD_SCHEME,
  SubsourceProvider,
} from '../../../src/providers/subsource.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SubsourceProvider.search', () => {
  it('returns [] when there is no IMDB id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    const results = await provider.search({ type: 'movie', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs imdbId and languages and normalizes results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        subs: [
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
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt1234567',
      languages: ['en'],
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://subsource.net/api/searchSubtitles');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ imdbId: 'tt1234567', languages: ['en'] });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '555',
      provider: 'subsource',
      lang: 'en',
      url: `${DOWNLOAD_SCHEME}555`,
      releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
      hashMatch: false,
      downloads: 88,
      rating: 8,
      hearingImpaired: true,
    });
  });

  it('includes season/episode in the body for series', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ subs: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    await provider.search({
      type: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 2,
      languages: ['en'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ imdbId: 'tt0903747', season: 1, episode: 2 });
  });

  it('throws on an API error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('SubsourceProvider.download', () => {
  it('POSTs the subId then fetches the returned link into a Buffer', async () => {
    const link = 'https://subsource.net/get/xyz';
    const fetchMock = vi.fn(async (url, options) => {
      if (String(url).endsWith('/downloadSub') && options?.method === 'POST') {
        return jsonResponse({ link });
      }
      if (url === link) {
        return new Response(Buffer.from('SUB CONTENT'));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    const buffer = await provider.download({
      provider: 'subsource',
      id: '555',
      url: `${DOWNLOAD_SCHEME}555`,
    });

    expect(buffer.toString()).toBe('SUB CONTENT');
    const postBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(postBody).toEqual({ subId: 555 });
  });

  it('throws when no link is returned', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    await expect(
      provider.download({ provider: 'subsource', id: '1', url: `${DOWNLOAD_SCHEME}1` }),
    ).rejects.toThrow('no link');
  });

  it('throws when the sub id is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubsourceProvider();
    await expect(provider.download({ provider: 'subsource' })).rejects.toThrow('missing sub id');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
