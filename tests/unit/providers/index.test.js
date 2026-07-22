import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderRegistry,
  createDefaultProviders,
} from '../../../src/providers/index.js';

function fakeProvider(name, results, { delay = 0, error = null } = {}) {
  return {
    name,
    search: vi.fn(async () => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (error) throw error;
      return results;
    }),
    download: vi.fn(async (sub) => Buffer.from(`${name}:${sub.id}`)),
  };
}

function sub(overrides = {}) {
  return {
    id: 'x',
    provider: 'p',
    lang: 'en',
    url: 'https://example.com/sub.srt',
    releaseName: '',
    hashMatch: false,
    downloads: 0,
    rating: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createDefaultProviders / constructor', () => {
  it('skips keyed providers when their API keys are missing', () => {
    const names = createDefaultProviders({}).map((p) => p.name);
    expect(names).toEqual(['subsource', 'podnapisi']);
  });

  it('includes keyed providers when their API keys are present', () => {
    const names = createDefaultProviders({
      opensubtitlesApiKey: 'os',
      subdlApiKey: 'subdl',
    }).map((p) => p.name);
    expect(names).toEqual(['opensubtitles', 'subdl', 'subsource', 'podnapisi']);
  });

  it('exposes the enabled providers on the registry', () => {
    const registry = new ProviderRegistry({ opensubtitlesApiKey: 'os' });
    expect(registry.providers.map((p) => p.name)).toEqual([
      'opensubtitles',
      'subsource',
      'podnapisi',
    ]);
  });
});

describe('ProviderRegistry.searchAll', () => {
  it('merges results from all providers', async () => {
    const a = fakeProvider('a', [sub({ id: '1', provider: 'a', url: 'u1' })]);
    const b = fakeProvider('b', [sub({ id: '2', provider: 'b', url: 'u2' })]);
    const registry = new ProviderRegistry({}, { providers: [a, b] });

    const results = await registry.searchAll({ type: 'movie', languages: ['en'] });

    expect(results.map((r) => r.id).sort()).toEqual(['1', '2']);
  });

  it('normalizes language codes across provider results', async () => {
    const a = fakeProvider('a', [sub({ id: '1', provider: 'a', url: 'u1', lang: 'eng' })]);
    const registry = new ProviderRegistry({}, { providers: [a] });

    const results = await registry.searchAll({ type: 'movie', languages: ['en'] });
    expect(results[0].lang).toBe('en');
  });

  it('isolates a failing provider and keeps the rest', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = fakeProvider('good', [sub({ id: '1', provider: 'good', url: 'u1' })]);
    const bad = fakeProvider('bad', [], { error: new Error('boom') });
    const registry = new ProviderRegistry({}, { providers: [good, bad] });

    const results = await registry.searchAll({ type: 'movie', languages: ['en'] });

    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('good');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"bad"'));
  });

  it('excludes a provider that exceeds the per-provider timeout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fast = fakeProvider('fast', [sub({ id: '1', provider: 'fast', url: 'u1' })]);
    const slow = fakeProvider('slow', [sub({ id: '2', provider: 'slow', url: 'u2' })], {
      delay: 200,
    });
    const registry = new ProviderRegistry({}, { providers: [fast, slow], timeoutMs: 50 });

    const results = await registry.searchAll({ type: 'movie', languages: ['en'] });

    expect(results.map((r) => r.provider)).toEqual(['fast']);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('returns an empty list when every provider fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad1 = fakeProvider('bad1', [], { error: new Error('x') });
    const bad2 = fakeProvider('bad2', [], { error: new Error('y') });
    const registry = new ProviderRegistry({}, { providers: [bad1, bad2] });

    const results = await registry.searchAll({ type: 'movie', languages: ['en'] });
    expect(results).toEqual([]);
  });

  describe('deduplication', () => {
    it('keeps a hash match over a non-hash duplicate regardless of order', async () => {
      const hashSub = sub({ id: 'h', provider: 'a', url: 'same', hashMatch: true, downloads: 1, rating: 1 });
      const plainSub = sub({ id: 'p', provider: 'b', url: 'same', hashMatch: false, downloads: 99999, rating: 10 });

      for (const order of [[hashSub, plainSub], [plainSub, hashSub]]) {
        const provider = fakeProvider('mix', order);
        const registry = new ProviderRegistry({}, { providers: [provider] });
        const results = await registry.searchAll({ type: 'movie', languages: ['en'] });
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('h');
      }
    });

    it('prefers a better release-name match over a higher composite score', async () => {
      const filename = 'Movie.2024.1080p.BluRay.x264-GRP.mkv';
      const goodRelease = sub({
        id: 'good',
        provider: 'a',
        url: 'same',
        releaseName: 'Movie.2024.1080p.BluRay.x264-GRP',
        downloads: 1,
        rating: 1,
      });
      const badRelease = sub({
        id: 'bad',
        provider: 'b',
        url: 'same',
        releaseName: 'Totally.Different.Release.720p.WEB',
        downloads: 99999,
        rating: 10,
      });

      const provider = fakeProvider('mix', [badRelease, goodRelease]);
      const registry = new ProviderRegistry({}, { providers: [provider] });
      const results = await registry.searchAll({ type: 'movie', filename, languages: ['en'] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('good');
    });

    it('falls back to the higher composite score when hash and release tie', async () => {
      const popular = sub({ id: 'pop', provider: 'a', url: 'same', downloads: 100, rating: 5 });
      const obscure = sub({ id: 'obs', provider: 'b', url: 'same', downloads: 1, rating: 1 });

      const provider = fakeProvider('mix', [obscure, popular]);
      const registry = new ProviderRegistry({}, { providers: [provider] });
      const results = await registry.searchAll({ type: 'movie', languages: ['en'] });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('pop');
    });

    it('keeps distinct URLs separate', async () => {
      const provider = fakeProvider('mix', [
        sub({ id: '1', provider: 'a', url: 'u1' }),
        sub({ id: '2', provider: 'b', url: 'u2' }),
      ]);
      const registry = new ProviderRegistry({}, { providers: [provider] });
      const results = await registry.searchAll({ type: 'movie', languages: ['en'] });
      expect(results).toHaveLength(2);
    });
  });
});

describe('ProviderRegistry.download', () => {
  it('delegates to the provider named by sub.provider', async () => {
    const a = fakeProvider('a', []);
    const b = fakeProvider('b', []);
    const registry = new ProviderRegistry({}, { providers: [a, b] });

    const buffer = await registry.download({ provider: 'b', id: '77', url: 'u' });

    expect(buffer.toString()).toBe('b:77');
    expect(b.download).toHaveBeenCalledTimes(1);
    expect(a.download).not.toHaveBeenCalled();
  });

  it('throws for an unknown provider', async () => {
    const registry = new ProviderRegistry({}, { providers: [fakeProvider('a', [])] });
    await expect(registry.download({ provider: 'nope', id: '1', url: 'u' })).rejects.toThrow(
      'unknown provider "nope"',
    );
  });

  it('throws when the subtitle has no provider', async () => {
    const registry = new ProviderRegistry({}, { providers: [fakeProvider('a', [])] });
    await expect(registry.download({ id: '1', url: 'u' })).rejects.toThrow('missing a provider');
  });
});
