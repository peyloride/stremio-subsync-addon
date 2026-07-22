## Context

The addon has three core modules (providers, sync engine, cache) plus an HTTP server. External dependencies include four subtitle provider APIs and the ffsubsync Python subprocess. Tests must isolate these external boundaries while still verifying real behavior at integration points.

The parent change (`stremio-subtitle-sync-addon`) defines 18 requirements across 3 specs with 40+ WHEN/THEN scenarios. Each scenario maps to at least one test case.

## Goals / Non-Goals

**Goals:**
- Every spec scenario has a corresponding test case
- Provider tests run without network access (mocked HTTP)
- Sync engine tests run without ffsubsync for unit tests; integration tests use real ffsubsync
- CI runs on every push/PR and blocks merge on failure
- Coverage thresholds enforce minimum coverage on core modules

**Non-Goals:**
- End-to-end tests against live provider APIs (flaky, rate-limited)
- Visual/snapshot testing (no UI)
- Performance/load testing
- Testing Stremio client behavior

## Decisions

### 1. Vitest over Jest

**Choice**: Vitest as the test runner.

**Why**: Native ESM support (the project uses `"type": "module"`), built-in coverage via `@vitest/coverage-v8`, fast watch mode, and compatible API with Jest. Jest's ESM support requires experimental flags and is slower.

### 2. MSW for HTTP mocking, child_process spy for ffsubsync

**Choice**: Use `msw` (Mock Service Worker) to intercept provider HTTP calls in tests. For ffsubsync, spy on `child_process.spawn`/`execFile` in unit tests; use real ffsubsync in integration tests.

**Why not nock**: MSW works at the network level and supports both Node and browser, making it future-proof. It also handles streaming responses (relevant for large subtitle downloads).

**Why not mock ffsubsync entirely**: The sync engine's value is in the actual ffsubsync output. Unit tests mock the subprocess to test orchestration logic (reference selection, caching, fallback). Integration tests run real ffsubsync on known SRT pairs to verify the output is correct.

### 3. Fixture-based test data

**Choice**: Store test fixtures in `tests/fixtures/`:
- `srt/` — sample SRT files: `reference.srt` (correctly timed), `unsynced.srt` (offset by +5s), `synced-expected.srt` (expected output), `latin1.srt` (non-UTF-8 encoding), `sample.ass` (ASS format)
- `providers/` — JSON files with recorded API responses for each provider (OpenSubtitles hash search, IMDB search, SubDL movie/series, etc.)
- `archives/` — small ZIP files containing SRT files for extraction tests

**Why**: Fixtures make tests deterministic, fast, and independent of external services. Recorded responses can be refreshed periodically to catch API schema changes.

### 4. Test directory mirrors source structure

**Choice**: `tests/unit/` mirrors `src/` (e.g., `tests/unit/providers/opensubtitles.test.js`, `tests/unit/sync/reference.test.js`). `tests/integration/` holds cross-module tests (full pipeline, HTTP endpoints).

**Why**: Easy to find the test for any module. Clear separation between fast unit tests and slower integration tests. Vitest config runs them as separate projects so unit tests can run without ffsubsync.

### 5. GitHub Actions CI with two jobs

**Choice**: `.github/workflows/ci.yml` with:
- **lint+unit** job: Node 20, `npm ci`, `npm run lint`, `npm run test:unit` with coverage. No Python needed.
- **integration** job: Node 20 + Python 3 + `pip install ffsubsync`, `npm run test:integration`. Runs after lint+unit passes.

**Why**: Unit tests are fast and don't need Python — run them first for quick feedback. Integration tests need ffsubsync and are slower — run them only after unit tests pass. Both must pass for merge.

### 6. Coverage thresholds

**Choice**: Enforce minimum coverage on core modules:
- `src/providers/` — 80% lines
- `src/sync/` — 90% lines
- `src/cache/` — 90% lines
- `src/utils/` — 90% lines
- Overall — 75% lines

**Why**: Providers have more external variability (API response shapes), so 80% is pragmatic. Sync and cache are critical path — 90% ensures edge cases are covered. Overall 75% prevents untested dead code from accumulating.

## Risks / Trade-offs

**[ffsubsync version drift]** → Integration tests may break when ffsubsync updates its output format. Mitigation: pin ffsubsync version in CI (`pip install ffsubsync==<version>`), update deliberately.

**[MSW maintenance]** → MSW major versions have breaking API changes. Mitigation: pin MSW version, keep mock setup in a shared `tests/helpers/mock-server.js`.

**[Fixture staleness]** → Recorded provider responses may drift from live APIs. Mitigation: add a `npm run fixtures:refresh` script (manual, not in CI) that re-records responses with real API keys.

**[CI time]** → Integration tests with real ffsubsync add ~30-60s. Mitigation: only 2-3 integration test cases with small SRT files; run after unit tests pass.
