import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

import { OpenSubtitlesLegacyProvider } from '../../../src/providers/opensubtitles-legacy.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function osSub(overrides = {}) {
  return {
    IDSubtitleFile: '111',
    SubLanguageID: 'eng',
    SubDownloadLink: 'https://dl.opensubtitles.org/111.gz',
    SubFileName: 'Movie.2024.1080p.BluRay.x264-GRP.srt',
    InfoReleaseGroup: 'GRP',
    InfoFormat: 'BluRay',
    MatchedBy: 'imdbid',
    SubDownloadsCnt: '500',
    SubRating: '8.0',
    SubHearingImpaired: '0',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OpenSubtitlesLegacyProvider.search', () => {
  it('searches a movie by IMDB id without the tt prefix in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([osSub()]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesLegacyProvider();
    const results = await provider.search({
      type: 'movie',
      imdbId: 'tt1234567',
      languages: ['en'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://rest.opensubtitles.org/search/imdbid-1234567/sublanguageid-eng',
    );
    expect(results[0]).toMatchObject({
      id: '111',
      provider: 'opensubtitles-legacy',
      lang: 'en',
      hashMatch: false,
      downloads: 500,
      rating: 8,
      hearingImpaired: false,
    });
  });

  it('filters series results by season and episode client-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        osSub({ IDSubtitleFile: 'wrong', SeriesSeason: '1', SeriesEpisode: '1' }),
        osSub({ IDSubtitleFile: 'right', SeriesSeason: '1', SeriesEpisode: '2' }),
        osSub({ IDSubtitleFile: 'wrong-2', SeriesSeason: '2', SeriesEpisode: '2' }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesLegacyProvider();
    const results = await provider.search({
      type: 'series',
      imdbId: 'tt4770018',
      season: 1,
      episode: 2,
      languages: ['tr'],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://rest.opensubtitles.org/search/imdbid-4770018/sublanguageid-tur',
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain('/season-');
    expect(results.map((result) => result.id)).toEqual(['right']);
  });

  it('falls back to IMDB search when the hash search has no results', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([], 200))
      .mockResolvedValueOnce(jsonResponse([osSub()]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesLegacyProvider();
    const results = await provider.search({
      type: 'movie',
      videoHash: 'abc123',
      videoSize: 123456,
      imdbId: 'tt1234567',
      languages: ['en'],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/moviehash-abc123/moviebytesize-123456');
    expect(fetchMock.mock.calls[1][0]).toContain('/imdbid-1234567/sublanguageid-eng');
    expect(results).toHaveLength(1);
  });

  it('returns [] when there is no searchable identifier', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesLegacyProvider();
    await expect(provider.search({ type: 'movie', languages: ['en'] })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenSubtitlesLegacyProvider.download', () => {
  it('decompresses the gzipped subtitle response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(gzipSync(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n')), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenSubtitlesLegacyProvider();
    const result = await provider.download({ url: 'https://dl.opensubtitles.org/111.gz' });

    expect(result.toString()).toContain('Hello');
  });

  it('returns an uncompressed response as-is', async () => {
    const body = Buffer.from('plain srt');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));

    const provider = new OpenSubtitlesLegacyProvider();
    const result = await provider.download({ url: 'https://example.test/sub.srt' });

    expect(result).toEqual(body);
  });

  it('throws when the url is missing', async () => {
    const provider = new OpenSubtitlesLegacyProvider();
    await expect(provider.download({})).rejects.toThrow('missing url');
  });
});
