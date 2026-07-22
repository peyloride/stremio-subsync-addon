/**
 * MSW (Mock Service Worker) setup for provider HTTP mocking.
 *
 * Loads recorded JSON fixtures from tests/fixtures/providers/ and registers
 * handlers for all four provider API base URLs. No real network requests
 * escape when the mock server is active.
 *
 * Usage in tests:
 *   import { startMockServer, stopMockServer, overrideHandler } from '../helpers/mock-server.js';
 *   beforeAll(() => startMockServer());
 *   afterAll(() => stopMockServer());
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixtureJson } from './fixtures.js';

/** Provider base URLs used by the source modules. */
export const PROVIDER_URLS = {
  opensubtitles: 'https://api.opensubtitles.com/api/v1',
  subdl: 'https://api.subdl.com/api/v1',
  subsource: 'https://subsource.net/api',
  podnapisi: 'https://www.podnapisi.net',
};

/** @type {import('msw/node').SetupServerApi | null} */
let server = null;

/**
 * Build the default set of MSW handlers from fixture files.
 * @returns {Promise<import('msw').HttpHandler[]>}
 */
async function buildDefaultHandlers() {
  const [osHash, osImdb, subdlMovie, subdlSeries, subsource, podnapisi] =
    await Promise.all([
      loadFixtureJson('providers/opensubtitles-hash.json'),
      loadFixtureJson('providers/opensubtitles-imdb.json'),
      loadFixtureJson('providers/subdl-movie.json'),
      loadFixtureJson('providers/subdl-series.json'),
      loadFixtureJson('providers/subsource.json'),
      loadFixtureJson('providers/podnapisi.json'),
    ]);

  return [
    // OpenSubtitles: hash search (moviehash param present)
    http.get(`${PROVIDER_URLS.opensubtitles}/subtitles`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.has('moviehash')) {
        return HttpResponse.json(osHash);
      }
      return HttpResponse.json(osImdb);
    }),

    // OpenSubtitles: download (POST /download)
    http.post(`${PROVIDER_URLS.opensubtitles}/download`, () => {
      return HttpResponse.json({ link: 'https://mock.opensubtitles.com/dl/test.srt' });
    }),

    // SubDL: subtitle search
    http.get(`${PROVIDER_URLS.subdl}/subtitles`, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.has('season_number')) {
        return HttpResponse.json(subdlSeries);
      }
      return HttpResponse.json(subdlMovie);
    }),

    // Subsource: search (POST)
    http.post(`${PROVIDER_URLS.subsource}/searchSubtitles`, () => {
      return HttpResponse.json(subsource);
    }),

    // Subsource: download (POST)
    http.post(`${PROVIDER_URLS.subsource}/downloadSub`, () => {
      return HttpResponse.json({ link: 'https://mock.subsource.net/dl/test.srt' });
    }),

    // Podnapisi: search
    http.get(`${PROVIDER_URLS.podnapisi}/en/subtitles/search/advanced`, () => {
      return HttpResponse.json(podnapisi);
    }),
  ];
}

/**
 * Start the MSW mock server with default provider handlers.
 * Call in beforeAll().
 */
export async function startMockServer() {
  const handlers = await buildDefaultHandlers();
  server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: 'error' });
}

/**
 * Stop the MSW mock server and clean up.
 * Call in afterAll().
 */
export function stopMockServer() {
  if (server) {
    server.close();
    server = null;
  }
}

/**
 * Reset handlers back to the defaults (built from fixtures).
 * Call in afterEach() if tests override handlers.
 */
export async function resetHandlers() {
  if (server) {
    const handlers = await buildDefaultHandlers();
    server.resetHandlers(...handlers);
  }
}

/**
 * Override the handler for a specific provider with a custom response.
 * Useful for testing error scenarios.
 *
 * @param {'opensubtitles' | 'subdl' | 'subsource' | 'podnapisi'} provider
 * @param {object} options
 * @param {number} [options.status=500] - HTTP status code
 * @param {any} [options.body] - JSON body (defaults to { error: 'mock error' })
 */
export function overrideHandler(provider, { status = 500, body = { error: 'mock error' } } = {}) {
  if (!server) throw new Error('Mock server not started. Call startMockServer() first.');

  const base = PROVIDER_URLS[provider];
  if (!base) throw new Error(`Unknown provider: ${provider}`);

  let handler;
  switch (provider) {
    case 'opensubtitles':
      handler = http.get(`${base}/subtitles`, () =>
        HttpResponse.json(body, { status }),
      );
      break;
    case 'subdl':
      handler = http.get(`${base}/subtitles`, () =>
        HttpResponse.json(body, { status }),
      );
      break;
    case 'subsource':
      handler = http.post(`${base}/searchSubtitles`, () =>
        HttpResponse.json(body, { status }),
      );
      break;
    case 'podnapisi':
      handler = http.get(`${base}/en/subtitles/search/advanced`, () =>
        HttpResponse.json(body, { status }),
      );
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  server.use(handler);
}
