import { describe, expect, it } from 'vitest';

import { langTo639_1, normalizeLang } from '../../../src/utils/language.js';

describe('normalizeLang', () => {
  it('passes through valid ISO 639-1 codes', () => {
    expect(normalizeLang('en')).toBe('en');
    expect(normalizeLang('fr')).toBe('fr');
    expect(normalizeLang('de')).toBe('de');
    expect(normalizeLang('ja')).toBe('ja');
  });

  it('converts ISO 639-2/B codes to 639-1', () => {
    expect(normalizeLang('eng')).toBe('en');
    expect(normalizeLang('fra')).toBe('fr');
    expect(normalizeLang('deu')).toBe('de');
    expect(normalizeLang('spa')).toBe('es');
    expect(normalizeLang('jpn')).toBe('ja');
    expect(normalizeLang('zho')).toBe('zh');
    expect(normalizeLang('kor')).toBe('ko');
    expect(normalizeLang('rus')).toBe('ru');
    expect(normalizeLang('ara')).toBe('ar');
    expect(normalizeLang('por')).toBe('pt');
  });

  it('converts ISO 639-2/T (bibliographic) codes to 639-1', () => {
    expect(normalizeLang('fre')).toBe('fr');
    expect(normalizeLang('ger')).toBe('de');
    expect(normalizeLang('dut')).toBe('nl');
    expect(normalizeLang('cze')).toBe('cs');
    expect(normalizeLang('gre')).toBe('el');
    expect(normalizeLang('rum')).toBe('ro');
    expect(normalizeLang('chi')).toBe('zh');
    expect(normalizeLang('per')).toBe('fa');
    expect(normalizeLang('ice')).toBe('is');
  });

  it('converts full English names to 639-1 (case-insensitive)', () => {
    expect(normalizeLang('English')).toBe('en');
    expect(normalizeLang('french')).toBe('fr');
    expect(normalizeLang('GERMAN')).toBe('de');
    expect(normalizeLang('Spanish')).toBe('es');
    expect(normalizeLang('Japanese')).toBe('ja');
    expect(normalizeLang('Korean')).toBe('ko');
    expect(normalizeLang('Chinese')).toBe('zh');
    expect(normalizeLang('Russian')).toBe('ru');
    expect(normalizeLang('Arabic')).toBe('ar');
    expect(normalizeLang('Portuguese')).toBe('pt');
  });

  it('handles common aliases and regional variants', () => {
    expect(normalizeLang('pt-br')).toBe('pt');
    expect(normalizeLang('zh-cn')).toBe('zh');
    expect(normalizeLang('zh-tw')).toBe('zh');
    expect(normalizeLang('zh-hans')).toBe('zh');
    expect(normalizeLang('sr-latn')).toBe('sr');
    expect(normalizeLang('no')).toBe('nb');
    expect(normalizeLang('iw')).toBe('he');
    expect(normalizeLang('in')).toBe('id');
  });

  it('trims whitespace and is case-insensitive', () => {
    expect(normalizeLang('  ENG  ')).toBe('en');
    expect(normalizeLang(' EN ')).toBe('en');
    expect(normalizeLang(' English ')).toBe('en');
  });

  it('returns lowercased input for unrecognized codes', () => {
    expect(normalizeLang('xx')).toBe('xx');
    expect(normalizeLang('UNKNOWN')).toBe('unknown');
    expect(normalizeLang('zzz')).toBe('zzz');
  });

  it('returns empty string for empty/null/non-string input', () => {
    expect(normalizeLang('')).toBe('');
    expect(normalizeLang('  ')).toBe('');
    expect(normalizeLang(null)).toBe('');
    expect(normalizeLang(undefined)).toBe('');
    expect(normalizeLang(42)).toBe('');
  });
});

describe('langTo639_1', () => {
  it('is an alias for normalizeLang', () => {
    expect(langTo639_1('eng')).toBe('en');
    expect(langTo639_1('French')).toBe('fr');
    expect(langTo639_1('de')).toBe('de');
  });
});
