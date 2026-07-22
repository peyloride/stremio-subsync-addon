import { describe, expect, it } from 'vitest';

import { manifest } from '../../src/manifest.js';

describe('manifest', () => {
  it('declares identity and protocol fields', () => {
    expect(manifest.id).toBe('com.subsync.stremio');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.resources).toEqual(['subtitles']);
    expect(manifest.types).toEqual(['movie', 'series']);
    expect(manifest.idPrefixes).toEqual(['tt']);
    expect(manifest.catalogs).toEqual([]);
  });

  it('exposes configurable settings for the Stremio config UI', () => {
    const fields = Object.fromEntries(
      manifest.behaviorHints.configurable.map((field) => [field.key, field]),
    );
    expect(Object.keys(fields).sort()).toEqual(
      [
        'languages',
        'opensubtitlesApiKey',
        'subdlApiKey',
        'syncEnabled',
        'maxOffsetSeconds',
        'cacheTtlDays',
      ].sort(),
    );
    expect(fields.languages.type).toBe('select');
    expect(fields.languages.default).toEqual(['en']);
    expect(fields.syncEnabled.type).toBe('boolean');
    expect(fields.maxOffsetSeconds.type).toBe('number');
    expect(fields.cacheTtlDays.type).toBe('number');
  });

  it('stays under the 8kb addon collection limit', () => {
    expect(JSON.stringify(manifest).length).toBeLessThan(8192);
  });
});
