import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, parseConfig } from '../../src/config.js';

describe('parseConfig', () => {
  it('returns all defaults for an empty config', () => {
    expect(parseConfig({}, {})).toEqual({
      languages: ['en'],
      syncEnabled: true,
      maxOffsetSeconds: 120,
      cacheTtlDays: 30,
      opensubtitlesApiKey: '',
      subdlApiKey: '',
      port: 3100,
      cacheDir: './data/cache',
    });
  });

  it('exposes the documented defaults', () => {
    expect(DEFAULT_CONFIG.languages).toEqual(['en']);
    expect(DEFAULT_CONFIG.syncEnabled).toBe(true);
    expect(DEFAULT_CONFIG.maxOffsetSeconds).toBe(120);
    expect(DEFAULT_CONFIG.cacheTtlDays).toBe(30);
    expect(DEFAULT_CONFIG.port).toBe(3100);
    expect(DEFAULT_CONFIG.cacheDir).toBe('./data/cache');
  });

  it('splits comma-separated languages and lowercases them', () => {
    expect(parseConfig({ languages: 'EN, fr ,de' }, {}).languages).toEqual(['en', 'fr', 'de']);
  });

  it('accepts an array of languages', () => {
    expect(parseConfig({ languages: ['pt', 'es'] }, {}).languages).toEqual(['pt', 'es']);
  });

  it('falls back to default languages for blank input', () => {
    expect(parseConfig({ languages: ' , ' }, {}).languages).toEqual(['en']);
    expect(parseConfig({ languages: '' }, {}).languages).toEqual(['en']);
  });

  it('coerces string and real booleans for syncEnabled', () => {
    expect(parseConfig({ syncEnabled: 'false' }, {}).syncEnabled).toBe(false);
    expect(parseConfig({ syncEnabled: 'true' }, {}).syncEnabled).toBe(true);
    expect(parseConfig({ syncEnabled: false }, {}).syncEnabled).toBe(false);
    expect(parseConfig({ syncEnabled: 'garbage' }, {}).syncEnabled).toBe(true);
  });

  it('coerces numeric strings and falls back on invalid input', () => {
    expect(parseConfig({ maxOffsetSeconds: '45' }, {}).maxOffsetSeconds).toBe(45);
    expect(parseConfig({ maxOffsetSeconds: 'nope' }, {}).maxOffsetSeconds).toBe(120);
    expect(parseConfig({ cacheTtlDays: '7' }, {}).cacheTtlDays).toBe(7);
    expect(parseConfig({ cacheTtlDays: '7.9' }, {}).cacheTtlDays).toBe(7);
  });

  it('trims API keys and treats blank as unset', () => {
    expect(parseConfig({ opensubtitlesApiKey: '  key123 ' }, {}).opensubtitlesApiKey).toBe('key123');
    expect(parseConfig({ subdlApiKey: '   ' }, {}).subdlApiKey).toBe('');
  });

  it('prefers raw config over environment for port and cacheDir', () => {
    const env = { PORT: '9999', CACHE_DIR: '/tmp/env-cache' };
    expect(parseConfig({ port: 4000 }, env).port).toBe(4000);
    expect(parseConfig({}, env).port).toBe(9999);
    expect(parseConfig({}, env).cacheDir).toBe('/tmp/env-cache');
    expect(parseConfig({ cacheDir: '/tmp/raw' }, env).cacheDir).toBe('/tmp/raw');
  });
});
