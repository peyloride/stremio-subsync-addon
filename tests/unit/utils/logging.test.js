import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRequestId,
  fetchLogged,
  redactUrl,
  summarizeConfig,
} from '../../../src/utils/logging.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('logging utilities', () => {
  it('creates a short request id', () => {
    expect(createRequestId()).toMatch(/^[0-9a-f-]{12}$/);
  });

  it('redacts API credentials from URLs', () => {
    const safe = redactUrl(
      'https://api.example.test/subtitles?api_key=super-secret&imdb_id=tt123',
    );
    expect(safe).toContain('api_key=%5Bredacted%5D');
    expect(safe).toContain('imdb_id=tt123');
    expect(safe).not.toContain('super-secret');
  });

  it('summarizes configured keys without exposing their values', () => {
    const summary = summarizeConfig({
      languages: ['tr'],
      syncEnabled: false,
      subdlApiKey: 'super-secret',
    });
    expect(summary).toMatchObject({
      languages: ['tr'],
      syncEnabled: false,
      subdlApiKey: 'configured',
      opensubtitlesApiKey: 'not-configured',
    });
    expect(JSON.stringify(summary)).not.toContain('super-secret');
  });

  it('logs each HTTP request and response with status and latency', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    await fetchLogged(
      'subdl',
      'https://api.subdl.com/api/v1/subtitles?api_key=secret&imdb_id=tt1',
      {},
      { requestId: 'req-123', action: 'search', attempt: 1 },
    );

    const events = logSpy.mock.calls.map(([line]) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({
        event: 'provider_http_request',
        requestId: 'req-123',
        provider: 'subdl',
        action: 'search',
        attempt: 1,
        method: 'GET',
        url: expect.not.stringContaining('secret'),
      }),
      expect.objectContaining({
        event: 'provider_http_response',
        requestId: 'req-123',
        status: 200,
        ok: true,
      }),
    ]);
  });
});
