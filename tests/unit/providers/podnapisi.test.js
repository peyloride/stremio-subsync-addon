import { afterEach, describe, expect, it, vi } from 'vitest';

import { PodnapisiProvider } from '../../../src/providers/podnapisi.js';

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

describe('PodnapisiProvider.search', () => {
  it('returns [] when there is no IMDB id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PodnapisiProvider();
    const results = await provider.search({ type: 'movie', languages: ['en'] });

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches by IMDB id with repeated language params and normalizes results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 999,
            language: 'eng',
            release: 'Movie.2024.1080p.BluRay.x264-GRP',
            downloads: 210,
            rating: 8.1,
            flags: ['hearing_impaired'],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PodnapisiProvider();
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt1234567',
      languages: ['en', 'fr'],
    });

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('/en/subtitles/search/advanced?');
    expect(calledUrl).toContain('movie=tt1234567');
    expect(calledUrl).toContain('language=en');
    expect(calledUrl).toContain('language=fr');
    expect(calledUrl).toContain('json=');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: '999',
      provider: 'podnapisi',
      lang: 'en',
      url: 'https://www.podnapisi.net/en/subtitles/999/download',
      releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
      hashMatch: false,
      downloads: 210,
      rating: 8.1,
      hearingImpaired: true,
      forced: false,
    });
  });

  it('reads forced/hearing flags from boolean fields too', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [{ id: 1, language: 'en', hearing_impaired: false, forced: true }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PodnapisiProvider();
    const results = await provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] });

    expect(results[0]).toMatchObject({ hearingImpaired: false, forced: true });
  });

  it('throws on an API error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PodnapisiProvider();
    await expect(
      provider.search({ type: 'movie', imdbId: 'tt1', languages: ['en'] }),
    ).rejects.toThrow('HTTP 503');
  });
});

describe('PodnapisiProvider.download', () => {
  it('fetches the download URL into a Buffer', async () => {
    const url = 'https://www.podnapisi.net/en/subtitles/999/download';
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from('PKzipbytes')));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PodnapisiProvider();
    const buffer = await provider.download({ provider: 'podnapisi', url });

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({}));
    expect(buffer.toString()).toBe('PKzipbytes');
  });

  it('throws when the url is missing', async () => {
    const provider = new PodnapisiProvider();
    await expect(provider.download({ provider: 'podnapisi' })).rejects.toThrow('missing url');
  });
});
