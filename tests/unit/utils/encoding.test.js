import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';

import { detectAndConvert } from '../../../src/utils/encoding.js';

describe('detectAndConvert', () => {
  it('passes through valid UTF-8 content', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nHello world\n';
    const buf = Buffer.from(text, 'utf-8');
    const result = detectAndConvert(buf);
    expect(result.content).toBe(text);
    expect(result.encoding).toMatch(/utf-?8/i);
  });

  it('strips UTF-8 BOM', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const text = 'Hello BOM';
    const buf = Buffer.concat([bom, Buffer.from(text, 'utf-8')]);
    const result = detectAndConvert(buf);
    expect(result.content).toBe(text);
    expect(result.content).not.toContain('\uFEFF');
  });

  it('detects and converts Latin-1 / ISO-8859-1 content', () => {
    // "café" in Latin-1: 0x63 0x61 0x66 0xe9
    const latin1Buf = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const result = detectAndConvert(latin1Buf);
    expect(result.content).toBe('café');
    expect(result.encoding).toMatch(/iso-8859|latin|windows-1252/i);
  });

  it('detects and converts Windows-1252 content', () => {
    // Smart quotes: \x93 = left double quote, \x94 = right double quote
    const text = iconv.encode('\u201cHello\u201d', 'win1252');
    const result = detectAndConvert(text);
    expect(result.content).toContain('\u201c');
    expect(result.content).toContain('\u201d');
  });

  it('detects and converts Windows-1251 (Cyrillic) content', () => {
    const cyrillic = 'Привет мир';
    const buf = iconv.encode(cyrillic, 'win1251');
    const result = detectAndConvert(buf);
    expect(result.content).toBe(cyrillic);
    expect(result.encoding).toMatch(/windows-1251|iso-8859-5/i);
  });

  it('handles empty buffer', () => {
    const result = detectAndConvert(Buffer.alloc(0));
    expect(result.content).toBe('');
    expect(result.encoding).toBe('UTF-8');
  });

  it('throws for non-Buffer input', () => {
    expect(() => detectAndConvert('string')).toThrow(TypeError);
    expect(() => detectAndConvert(null)).toThrow(TypeError);
  });

  it('handles pure ASCII content', () => {
    const buf = Buffer.from('plain ascii text', 'ascii');
    const result = detectAndConvert(buf);
    expect(result.content).toBe('plain ascii text');
  });
});
