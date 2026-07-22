import { describe, expect, it } from 'vitest';

import { createHealthHandler } from '../../src/handlers/health.js';
import { manifest } from '../../src/manifest.js';

function mockResponse() {
  const res = { headers: {}, statusCode: null, body: null };
  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

describe('createHealthHandler', () => {
  it('reports ok when ffsubsync is available', async () => {
    const handler = createHealthHandler({ checkAvailability: async () => true });
    const res = mockResponse();
    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe(manifest.version);
    expect(res.body.cache).toEqual({ entries: 0, sizeBytes: 0 });
    expect(res.body.warning).toBeUndefined();
  });

  it('reports degraded with a warning when ffsubsync is missing', async () => {
    const handler = createHealthHandler({ checkAvailability: async () => false });
    const res = mockResponse();
    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.warning).toMatch(/ffsubsync/);
  });

  it('treats a failing availability probe as degraded', async () => {
    const handler = createHealthHandler({
      checkAvailability: async () => {
        throw new Error('boom');
      },
    });
    const res = mockResponse();
    await handler({}, res);

    expect(res.body.status).toBe('degraded');
  });
});
