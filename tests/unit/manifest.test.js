import { describe, expect, it } from 'vitest';

import { manifest } from '../../src/manifest.js';

describe('manifest', () => {
  it('declares identity and protocol fields', () => {
    expect(manifest.id).toBe('com.subsync.stremio');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.resources).toEqual(['subtitles']);
    expect(manifest.types).toEqual(['movie', 'series']);
    expect(manifest.idPrefixes).toEqual(['tt']);
    expect(manifest.catalogs).toEqual([]);
  });

  it('exposes configurable settings for the Stremio config UI', () => {
    expect(manifest.behaviorHints.configurable).toBe(true);
    const fields = Object.fromEntries(
      manifest.config.map((field) => [field.key, field]),
    );
    expect(Object.keys(fields).sort()).toEqual(
      [
        'languages',
        'opensubtitlesApiKey',
        'subdlApiKey',
        'subsourceApiKey',
        'syncEnabled',
        'maxOffsetSeconds',
        'cacheTtlDays',
      ].sort(),
    );
    expect(fields.languages.type).toBe('select');
    expect(fields.languages.default).toEqual('en');
    expect(fields.syncEnabled.type).toBe('checkbox');
    expect(fields.maxOffsetSeconds.type).toBe('number');
    expect(fields.cacheTtlDays.type).toBe('number');
  });

  it('stays under the 8kb addon collection limit', () => {
    expect(JSON.stringify(manifest).length).toBeLessThan(8192);
  });
});
