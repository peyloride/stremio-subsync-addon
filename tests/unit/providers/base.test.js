import { describe, expect, it } from 'vitest';

import { validateProvider } from '../../../src/providers/base.js';

function makeValidProvider(overrides = {}) {
  return {
    name: 'test-provider',
    search: async () => [],
    download: async () => Buffer.from(''),
    ...overrides,
  };
}

describe('validateProvider', () => {
  it('accepts a valid provider', () => {
    expect(validateProvider(makeValidProvider())).toBe(true);
  });

  it('rejects null', () => {
    expect(() => validateProvider(null)).toThrow(TypeError);
    expect(() => validateProvider(null)).toThrow('non-null object');
  });

  it('rejects non-object types', () => {
    expect(() => validateProvider('string')).toThrow(TypeError);
    expect(() => validateProvider(42)).toThrow(TypeError);
    expect(() => validateProvider(undefined)).toThrow(TypeError);
  });

  it('rejects a provider with missing name', () => {
    expect(() => validateProvider(makeValidProvider({ name: undefined }))).toThrow(
      'non-empty string "name"',
    );
    expect(() => validateProvider(makeValidProvider({ name: '' }))).toThrow(
      'non-empty string "name"',
    );
    expect(() => validateProvider(makeValidProvider({ name: 123 }))).toThrow(
      'non-empty string "name"',
    );
  });

  it('rejects a provider with missing search', () => {
    expect(() => validateProvider(makeValidProvider({ search: undefined }))).toThrow(
      '"search" function',
    );
    expect(() => validateProvider(makeValidProvider({ search: 'not-a-fn' }))).toThrow(
      '"search" function',
    );
  });

  it('rejects a provider with missing download', () => {
    expect(() => validateProvider(makeValidProvider({ download: undefined }))).toThrow(
      '"download" function',
    );
    expect(() => validateProvider(makeValidProvider({ download: null }))).toThrow(
      '"download" function',
    );
  });

  it('includes the provider name in search/download error messages', () => {
    expect(() => validateProvider(makeValidProvider({ name: 'myprov', search: 42 }))).toThrow(
      'Provider "myprov"',
    );
  });
});
