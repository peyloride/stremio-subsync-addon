## 1. Test Runner Setup

- [ ] 1.1 Install dev dependencies: `vitest`, `@vitest/coverage-v8`, `msw`, `supertest`
- [ ] 1.2 Create `vitest.config.js` with two project configs: `unit` (include `tests/unit/**/*.test.js`) and `integration` (include `tests/integration/**/*.test.js`)
- [ ] 1.3 Add npm scripts: `test` (run both), `test:unit` (unit only + coverage), `test:integration` (integration only)
- [ ] 1.4 Configure coverage thresholds in vitest config: `src/providers/` ≥ 80%, `src/sync/` ≥ 90%, `src/cache/` ≥ 90%, `src/utils/` ≥ 90%, overall ≥ 75%; reporters: text-summary + lcov

## 2. Test Fixtures

- [ ] 2.1 Create `tests/fixtures/srt/reference.srt` — correctly timed SRT with ≥10 cues (English dialogue)
- [ ] 2.2 Create `tests/fixtures/srt/unsynced.srt` — same content as reference but offset by +5 seconds
- [ ] 2.3 Create `tests/fixtures/srt/latin1.srt` — SRT file encoded in Latin-1 with accented characters
- [ ] 2.4 Create `tests/fixtures/srt/sample.ass` — minimal ASS subtitle file with styling
- [ ] 2.5 Create `tests/fixtures/archives/sample.zip` — ZIP containing one SRT file
- [ ] 2.6 Create `tests/fixtures/providers/opensubtitles-hash.json` — recorded OpenSubtitles API response for hash-based search
- [ ] 2.7 Create `tests/fixtures/providers/opensubtitles-imdb.json` — recorded OpenSubtitles API response for IMDB search
- [ ] 2.8 Create `tests/fixtures/providers/subdl-movie.json` — recorded SubDL API response for movie search
- [ ] 2.9 Create `tests/fixtures/providers/subdl-series.json` — recorded SubDL API response for series search with season/episode
- [ ] 2.10 Create `tests/fixtures/providers/subsource.json` — recorded Subsource API response
- [ ] 2.11 Create `tests/fixtures/providers/podnapisi.json` — recorded Podnapisi response

## 3. Shared Test Helpers

- [ ] 3.1 Create `tests/helpers/mock-server.js` — MSW setup that loads provider fixture JSON and registers handlers for all four provider API base URLs; export `startMockServer()`, `stopMockServer()`, `overrideHandler(provider, response)`
- [ ] 3.2 Create `tests/helpers/mock-ffsubsync.js` — helper that spies on `child_process.execFile`/`spawn` and simulates ffsubsync in three modes: success (creates output file, exits 0), failure (exits 1), timeout (never exits); export `mockFfsubsync(mode)`, `restoreFfsubsync()`
- [ ] 3.3 Create `tests/helpers/fixtures.js` — utility to load fixture files as Buffers/strings, create temp directories for cache tests, and clean up after tests

## 4. Unit Tests — Utilities

- [ ] 4.1 Write `tests/unit/utils/language.test.js` — test ISO 639-2 → 639-1 conversion, full name → 639-1, passthrough for already-valid codes, unknown code handling
- [ ] 4.2 Write `tests/unit/utils/release-match.test.js` — test release name token parsing, exact match, partial match, no match, case insensitivity
- [ ] 4.3 Write `tests/unit/utils/archive.test.js` — test ZIP extraction (single SRT, multiple files picks first SRT), GZ extraction, non-archive passthrough
- [ ] 4.4 Write `tests/unit/utils/encoding.test.js` — test UTF-8 passthrough, Latin-1 detection and conversion, CP1252 detection, empty file handling

## 5. Unit Tests — Providers

- [ ] 5.1 Write `tests/unit/providers/opensubtitles.test.js` — test hash search (fixture response → normalized ProviderSubtitle[]), IMDB search, missing API key skip, rate limit handling, HTTP error fallback
- [ ] 5.2 Write `tests/unit/providers/subdl.test.js` — test movie search, series search with season/episode, result normalization, API error handling
- [ ] 5.3 Write `tests/unit/providers/subsource.test.js` — test IMDB search, normalization, error handling
- [ ] 5.4 Write `tests/unit/providers/podnapisi.test.js` — test IMDB search, normalization, error handling
- [ ] 5.5 Write `tests/unit/providers/index.test.js` — test parallel search across providers, per-provider timeout (one slow provider doesn't block others), deduplication by URL, language normalization across providers, all-providers-fail returns empty

## 6. Unit Tests — Sync Engine

- [ ] 6.1 Write `tests/unit/sync/reference.test.js` — test hash-match-first cascade, release-name fallback, score-based fallback, single-candidate returns null, tie-breaking
- [ ] 6.2 Write `tests/unit/sync/ffsubsync.test.js` — test subprocess spawn args construction, success parsing (offset + framerate from stdout), failure handling (non-zero exit), timeout kill, missing ffsubsync binary
- [ ] 6.3 Write `tests/unit/sync/engine.test.js` — test full orchestration with mocked ffsubsync: reference excluded from sync targets, parallel sync (≤3 concurrent), offset exceeds max → fallback to unsynced, ffsubsync failure → fallback, temp file cleanup

## 7. Unit Tests — Cache

- [ ] 7.1 Write `tests/unit/cache/store.test.js` — test put/get round-trip (SRT content + meta JSON sidecar), cache miss returns null, TTL expiry (old entry treated as miss), eviction on startup, ASS format served with correct extension

## 8. Unit Tests — HTTP Endpoints

- [ ] 8.1 Write `tests/unit/handlers/subtitles.test.js` — test movie ID parsing (`tt1234567`), series ID parsing (`tt1234567:1:5`), cache hit returns cached URLs, cache miss triggers provider search + sync pipeline, no results returns empty array, sync disabled serves unsynced, cacheMaxAge header set
- [ ] 8.2 Write `tests/unit/server.test.js` — test `/health` returns ok when ffsubsync available, degraded when missing; test `/sub/:hash/:id.srt` serves file, 404 for missing; test `/manifest.json` structure (resources, types, idPrefixes, configurable fields)

## 9. Integration Tests

- [ ] 9.1 Write `tests/integration/sync-real.test.js` — run real ffsubsync on `reference.srt` + `unsynced.srt` fixture pair; verify output exists, offset ≈ -5s, cue text matches reference
- [ ] 9.2 Write `tests/integration/pipeline.test.js` — full pipeline with MSW-mocked providers + real ffsubsync: subtitle handler receives request → providers return fixture data → reference selected → sync runs → cached file served at `/sub/` endpoint; verify end-to-end response shape

## 10. CI Pipeline

- [ ] 10.1 Create `.github/workflows/ci.yml` — trigger on push to `main` and PRs to `main`
- [ ] 10.2 Add `lint-unit` job: Node 20, `npm ci`, `npm run lint`, `npm run test:unit` with coverage upload as artifact
- [ ] 10.3 Add `integration` job: needs `lint-unit`, Node 20 + Python 3 setup, `pip install ffsubsync==<pinned-version>`, `npm ci`, `npm run test:integration`
- [ ] 10.4 Add CI status badge to README.md linking to the workflow
