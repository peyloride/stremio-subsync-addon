import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubDLProvider } from '../../../src/providers/subdl.js';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const CONFIG = { subdlApiKey: 'subdl-key' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SubDLProvider.search', () => {
  it('returns [] and skips fetch when no API key is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider({});
    const results = await provider.search({ type: 'movie', imdbId: 'tt1234567', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] when there is no IMDB id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    const results = await provider.search({ type: 'movie', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches by imdb_id and normalizes the subtitles array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        results: [{ sd_id: 9929, name: 'The Movie', imdb_id: 'tt1234567' }],
        subtitles: [
          {
            name: 'Movie.2024.1080p.BluRay.x264-GRP.zip',
            release_name: 'Movie.2024.1080p.BluRay.x264-GRP',
            language: 'EN',
            lang: 'English',
            url: '/subtitle/3533939-8455827.zip?api_key=subdl-key',
            hi: false,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt1234567',
      languages: ['en', 'fr'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('api_key=subdl-key');
    expect(calledUrl).toContain('imdb_id=tt1234567');
    expect(calledUrl).toContain('languages=en%2Cfr');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '3533939-8455827',
      provider: 'subdl',
      lang: 'en',
      url: 'https://dl.subdl.com/subtitle/3533939-8455827.zip?api_key=subdl-key',
      releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
      hashMatch: false,
      hearingImpaired: false,
    });
  });

  it('adds season/episode filters for series', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: true, subtitles: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    await provider.search({
      type: 'series',
      imdbId: 'tt0903747',
      season: 2,
      episode: 3,
      languages: ['en'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('season_number=2');
    expect(calledUrl).toContain('episode_number=3');
  });

  it('throws on an API error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('HTTP 403');
  });
});

describe('SubDLProvider.download', () => {
  it('fetches the resolved download URL into a Buffer', async () => {
    const url = 'https://dl.subdl.com/subtitle/abc123.zip';
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('ZIPBYTES')));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    const buffer = await provider.download({ provider: 'subdl', url });

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({}));
    expect(buffer.toString()).toBe('ZIPBYTES');
  });

  it('throws when the url is missing', async () => {
    const provider = new SubDLProvider(CONFIG);
    await expect(provider.download({ provider: 'subdl' })).rejects.toThrow('missing url');
  });

  it('throws on a failed download response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SubDLProvider(CONFIG);
    await expect(
      provider.download({ provider: 'subdl', url: 'https://dl.subdl.com/x.zip' }),
    ).rejects.toThrow('HTTP 404');
  });
});
