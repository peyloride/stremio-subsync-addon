import { describe, expect, it } from 'vitest';

import {
  compositeScore,
  releaseMatchScore,
  selectReference,
  tokenizeReleaseName,
} from '../../../src/sync/reference.js';

// --- helpers ---

function sub(overrides = {}) {
  return {
    id: 'sub-1',
    provider: 'test',
    lang: 'en',
    url: 'https://example.com/sub1.srt',
    hashMatch: false,
    downloads: 100,
    rating: 5,
    ...overrides,
  };
}

// --- compositeScore ---

describe('compositeScore', () => {
  it('multiplies downloads by rating when both present', () => {
    expect(compositeScore({ downloads: 100, rating: 5 })).toBe(500);
  });

  it('uses downloads alone when rating is 0 or missing', () => {
    expect(compositeScore({ downloads: 100, rating: 0 })).toBe(100);
    expect(compositeScore({ downloads: 100 })).toBe(100);
  });

  it('returns 0 when downloads is missing', () => {
    expect(compositeScore({ rating: 5 })).toBe(0);
    expect(compositeScore({})).toBe(0);
  });
});

// --- tokenizeReleaseName ---

describe('tokenizeReleaseName', () => {
  it('splits on dots, dashes, underscores, brackets', () => {
    expect(tokenizeReleaseName('Movie.2024.1080p.BluRay.x264-GROUP.srt')).toEqual([
      'movie', '2024', '1080p', 'bluray', 'x264', 'group',
    ]);
  });

  it('strips file extension', () => {
    expect(tokenizeReleaseName('test.srt')).toEqual(['test']);
    expect(tokenizeReleaseName('test.ass')).toEqual(['test']);
  });

  it('returns empty array for null/undefined/empty', () => {
    expect(tokenizeReleaseName(null)).toEqual([]);
    expect(tokenizeReleaseName(undefined)).toEqual([]);
    expect(tokenizeReleaseName('')).toEqual([]);
  });
});

// --- releaseMatchScore ---

describe('releaseMatchScore', () => {
  it('counts overlapping tokens between video filename and releaseName', () => {
    const candidate = sub({ releaseName: 'Movie.2024.1080p.BluRay.x264-GROUP' });
    const score = releaseMatchScore('Movie.2024.1080p.BluRay.x264-GROUP.mkv', candidate);
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it('falls back to candidate filename when releaseName is absent', () => {
    const candidate = sub({ releaseName: undefined, filename: 'Movie.2024.1080p.srt' });
    const score = releaseMatchScore('Movie.2024.1080p.BluRay.mkv', candidate);
    expect(score).toBe(3); // movie, 2024, 1080p
  });

  it('returns 0 when videoFilename is empty', () => {
    expect(releaseMatchScore('', sub({ releaseName: 'test' }))).toBe(0);
  });

  it('returns 0 when candidate has no releaseName or filename', () => {
    expect(releaseMatchScore('Movie.2024.mkv', sub({ releaseName: undefined, filename: undefined }))).toBe(0);
  });

  it('is case-insensitive', () => {
    const candidate = sub({ releaseName: 'MOVIE.2024.1080P' });
    const score = releaseMatchScore('movie.2024.1080p.mkv', candidate);
    expect(score).toBe(3);
  });
});

// --- selectReference ---

describe('selectReference', () => {
  // spec: subtitle-sync > Reference subtitle selection > Scenario: Single candidate
  it('returns null for empty list', () => {
    expect(selectReference([], 'video.mkv')).toBeNull();
  });

  it('returns null for single candidate', () => {
    expect(selectReference([sub()], 'video.mkv')).toBeNull();
  });

  it('returns null for non-array input', () => {
    expect(selectReference(null, 'video.mkv')).toBeNull();
    expect(selectReference(undefined, 'video.mkv')).toBeNull();
  });

  // spec: subtitle-sync > Reference subtitle selection > Scenario: Hash-matched reference available
  it('selects hash-matched subtitle with highest composite score', () => {
    const lowHash = sub({ id: 'low', hashMatch: true, downloads: 10, rating: 2 });
    const highHash = sub({ id: 'high', hashMatch: true, downloads: 500, rating: 8 });
    const noHash = sub({ id: 'nohash', hashMatch: false, downloads: 9999, rating: 10 });

    const result = selectReference([lowHash, highHash, noHash], 'video.mkv');
    expect(result.id).toBe('high');
  });

  it('selects the only hash-matched subtitle even if lower score than non-hash', () => {
    const hashSub = sub({ id: 'hash', hashMatch: true, downloads: 1, rating: 1 });
    const popularSub = sub({ id: 'popular', hashMatch: false, downloads: 9999, rating: 10 });

    const result = selectReference([hashSub, popularSub], 'video.mkv');
    expect(result.id).toBe('hash');
  });

  // spec: subtitle-sync > Reference subtitle selection > Scenario: Release-name match fallback
  it('falls back to release-name match when no hash match exists', () => {
    const matchSub = sub({
      id: 'match',
      hashMatch: false,
      releaseName: 'Movie.2024.1080p.BluRay.x264-GROUP',
      downloads: 10,
      rating: 1,
    });
    const noMatchSub = sub({
      id: 'nomatch',
      hashMatch: false,
      releaseName: 'Completely.Different.Release',
      downloads: 9999,
      rating: 10,
    });

    const result = selectReference(
      [matchSub, noMatchSub],
      'Movie.2024.1080p.BluRay.x264-GROUP.mkv',
    );
    expect(result.id).toBe('match');
  });

  it('requires at least 2 overlapping tokens for release-name match', () => {
    // Only 1 token overlap ("movie") — should NOT count as release match
    const weakMatch = sub({
      id: 'weak',
      hashMatch: false,
      releaseName: 'Movie.WEBRip',
      downloads: 10,
      rating: 1,
    });
    const highScore = sub({
      id: 'highscore',
      hashMatch: false,
      releaseName: 'Something.Else.Entirely',
      downloads: 500,
      rating: 8,
    });

    const result = selectReference(
      [weakMatch, highScore],
      'Movie.2024.1080p.BluRay.mkv',
    );
    // weak match has only 1 token overlap → falls through to score-based
    expect(result.id).toBe('highscore');
  });

  it('tie-breaks release-name matches by composite score', () => {
    const matchA = sub({
      id: 'a',
      hashMatch: false,
      releaseName: 'Movie.2024.1080p',
      downloads: 10,
      rating: 2,
    });
    const matchB = sub({
      id: 'b',
      hashMatch: false,
      releaseName: 'Movie.2024.1080p.BluRay',
      downloads: 50,
      rating: 5,
    });

    const result = selectReference(
      [matchA, matchB],
      'Movie.2024.1080p.BluRay.x264.mkv',
    );
    // Both match, but matchB has more overlapping tokens
    expect(result.id).toBe('b');
  });

  // spec: subtitle-sync > Reference subtitle selection > Scenario: Score-based fallback
  it('falls back to highest composite score when no hash or release match', () => {
    const lowScore = sub({ id: 'low', downloads: 10, rating: 2 });
    const highScore = sub({ id: 'high', downloads: 500, rating: 8 });

    const result = selectReference([lowScore, highScore], 'video.mkv');
    expect(result.id).toBe('high');
  });

  it('works without videoFilename (skips release-name step)', () => {
    const lowScore = sub({ id: 'low', downloads: 10, rating: 2 });
    const highScore = sub({ id: 'high', downloads: 500, rating: 8 });

    const result = selectReference([lowScore, highScore]);
    expect(result.id).toBe('high');
  });
});
