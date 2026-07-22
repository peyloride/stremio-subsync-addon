import { describe, expect, it } from 'vitest';

import { matchScore, parseReleaseTokens } from '../../../src/utils/release-match.js';

describe('parseReleaseTokens', () => {
  it('extracts resolution, codec, source, and group from a typical release name', () => {
    const tokens = parseReleaseTokens('Movie.Title.2024.1080p.BluRay.x264-GRP.mkv');
    expect(tokens.resolution).toBe('1080p');
    expect(tokens.codec).toBe('x264');
    expect(tokens.source).toBe('bluray');
    expect(tokens.group).toBe('grp');
    expect(tokens.nameTokens).toContain('movie');
    expect(tokens.nameTokens).toContain('title');
  });

  it('handles WEB-DL sources', () => {
    const tokens = parseReleaseTokens('Show.S01E01.2160p.WEB-DL.x265-GRP');
    expect(tokens.resolution).toBe('2160p');
    expect(tokens.source).toBe('web-dl');
    expect(tokens.codec).toBe('x265');
    expect(tokens.group).toBe('grp');
  });

  it('handles HDTV sources', () => {
    const tokens = parseReleaseTokens('Show.S01E01.720p.HDTV.x264-GRP');
    expect(tokens.resolution).toBe('720p');
    expect(tokens.source).toBe('hdtv');
  });

  it('extracts audio tokens', () => {
    const tokens = parseReleaseTokens('Movie.2024.1080p.BluRay.DTS.x264-GRP');
    expect(tokens.audio).toBe('dts');
  });

  it('handles underscores and spaces as separators', () => {
    const tokens = parseReleaseTokens('Movie_Title_2024_1080p_BluRay_x264-GRP');
    expect(tokens.resolution).toBe('1080p');
    expect(tokens.source).toBe('bluray');
    expect(tokens.nameTokens).toContain('movie');
  });

  it('strips file extensions', () => {
    const tokens = parseReleaseTokens('Movie.2024.1080p.srt');
    expect(tokens.nameTokens).not.toContain('srt');
  });

  it('returns empty fields for a plain title with no technical tokens', () => {
    const tokens = parseReleaseTokens('Some.Movie.Title');
    expect(tokens.resolution).toBe('');
    expect(tokens.codec).toBe('');
    expect(tokens.source).toBe('');
    expect(tokens.nameTokens).toEqual(expect.arrayContaining(['some', 'movie', 'title']));
  });

  it('handles empty/null input gracefully', () => {
    const tokens = parseReleaseTokens('');
    expect(tokens.resolution).toBe('');
    expect(tokens.nameTokens).toEqual([]);

    const nullTokens = parseReleaseTokens(null);
    expect(nullTokens.nameTokens).toEqual([]);
  });

  it('handles 4k / UHD resolution', () => {
    expect(parseReleaseTokens('Movie.4K.BluRay').resolution).toBe('4k');
    expect(parseReleaseTokens('Movie.UHD.WEB-DL').resolution).toBe('uhd');
  });
});

describe('matchScore', () => {
  it('returns 1.0 for identical release names', () => {
    const name = 'Movie.Title.2024.1080p.BluRay.x264-GRP.mkv';
    expect(matchScore(name, name)).toBeCloseTo(1.0, 1);
  });

  it('returns high score for same resolution, codec, source, and group', () => {
    const video = 'Movie.Title.2024.1080p.BluRay.x264-GRP.mkv';
    const sub = 'Movie.Title.2024.1080p.BluRay.x264-GRP.srt';
    expect(matchScore(video, sub)).toBeGreaterThan(0.8);
  });

  it('returns partial score when only resolution matches', () => {
    const video = 'Movie.2024.1080p.BluRay.x264-GRP.mkv';
    const sub = 'Movie.2024.1080p.WEB-DL.x265-OTHER.srt';
    const score = matchScore(video, sub);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it('returns 0 when nothing matches', () => {
    const video = 'Movie.2024.1080p.BluRay.x264-GRP.mkv';
    const sub = 'Completely.Different.720p.HDTV.x265-OTHER.srt';
    const score = matchScore(video, sub);
    // Name tokens are different, resolution different, codec different, source different, group different
    expect(score).toBeLessThan(0.15);
  });

  it('is case-insensitive', () => {
    const video = 'Movie.2024.1080p.BluRay.x264-GRP.mkv';
    const sub = 'movie.2024.1080p.bluray.x264-grp.srt';
    expect(matchScore(video, sub)).toBeGreaterThan(0.8);
  });

  it('handles empty inputs', () => {
    expect(matchScore('', '')).toBe(0);
    expect(matchScore('Movie.1080p.mkv', '')).toBe(0);
    expect(matchScore('', 'Movie.1080p.srt')).toBe(0);
  });

  it('scores group match highly', () => {
    const video = 'Movie.2024.1080p.BluRay.x264-GRP.mkv';
    const subSameGroup = 'Movie.2024.1080p.BluRay.x264-GRP.srt';
    const subDiffGroup = 'Movie.2024.1080p.BluRay.x264-OTHER.srt';
    expect(matchScore(video, subSameGroup)).toBeGreaterThan(matchScore(video, subDiffGroup));
  });

  it('gives name token overlap partial credit via Jaccard', () => {
    const video = 'The.Big.Movie.2024.1080p.mkv';
    const subPartial = 'The.Big.Movie.2024.720p.srt';
    const subNone = 'Totally.Different.Film.2024.720p.srt';
    expect(matchScore(video, subPartial)).toBeGreaterThan(matchScore(video, subNone));
  });
});
