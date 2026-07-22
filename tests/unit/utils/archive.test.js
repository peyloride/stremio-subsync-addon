import { gzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import { extractSubtitle } from '../../../src/utils/archive.js';

const SRT_CONTENT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';

function makeZip(files) {
  const zip = new AdmZip();
  for (const { name, content } of files) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

describe('extractSubtitle', () => {
  describe('ZIP archives', () => {
    it('extracts the first .srt from a ZIP', () => {
      const buf = makeZip([
        { name: 'readme.txt', content: 'not a subtitle' },
        { name: 'movie.srt', content: SRT_CONTENT },
      ]);
      const result = extractSubtitle(buf, 'subs.zip');
      expect(result.filename).toBe('movie.srt');
      expect(result.content.toString()).toBe(SRT_CONTENT);
    });

    it('prefers .srt over .ass when both exist', () => {
      const buf = makeZip([
        { name: 'movie.ass', content: '[Script Info]\n' },
        { name: 'movie.srt', content: SRT_CONTENT },
      ]);
      const result = extractSubtitle(buf);
      expect(result.filename).toBe('movie.srt');
    });

    it('falls back to .ass when no .srt exists', () => {
      const assContent = '[Script Info]\nTitle: Test\n';
      const buf = makeZip([{ name: 'movie.ass', content: assContent }]);
      const result = extractSubtitle(buf);
      expect(result.filename).toBe('movie.ass');
      expect(result.content.toString()).toBe(assContent);
    });

    it('handles nested directories in ZIP', () => {
      const buf = makeZip([
        { name: 'folder/nested/deep.srt', content: SRT_CONTENT },
      ]);
      const result = extractSubtitle(buf);
      expect(result.filename).toBe('deep.srt');
      expect(result.content.toString()).toBe(SRT_CONTENT);
    });

    it('detects ZIP by magic bytes even without .zip extension', () => {
      const buf = makeZip([{ name: 'sub.srt', content: SRT_CONTENT }]);
      const result = extractSubtitle(buf, 'unknown.bin');
      expect(result.filename).toBe('sub.srt');
    });

    it('returns the first file when no subtitle extension is found', () => {
      const buf = makeZip([{ name: 'data.txt', content: 'text' }]);
      const result = extractSubtitle(buf);
      expect(result.filename).toBe('data.txt');
    });

    it('throws for an empty ZIP', () => {
      const buf = makeZip([]);
      expect(() => extractSubtitle(buf)).toThrow('no files');
    });
  });

  describe('GZIP archives', () => {
    it('decompresses a GZ file', () => {
      const buf = gzipSync(Buffer.from(SRT_CONTENT));
      const result = extractSubtitle(buf, 'movie.srt.gz');
      expect(result.content.toString()).toBe(SRT_CONTENT);
      expect(result.filename).toBe('movie.srt');
    });

    it('detects GZIP by magic bytes without .gz extension', () => {
      const buf = gzipSync(Buffer.from(SRT_CONTENT));
      const result = extractSubtitle(buf, 'unknown.bin');
      expect(result.content.toString()).toBe(SRT_CONTENT);
    });
  });

  describe('non-archive passthrough', () => {
    it('returns plain SRT buffer as-is', () => {
      const buf = Buffer.from(SRT_CONTENT);
      const result = extractSubtitle(buf, 'movie.srt');
      expect(result.content).toBe(buf);
      expect(result.filename).toBe('movie.srt');
    });

    it('uses default filename when none provided', () => {
      const buf = Buffer.from(SRT_CONTENT);
      const result = extractSubtitle(buf);
      expect(result.filename).toBe('subtitle.srt');
    });
  });
});
