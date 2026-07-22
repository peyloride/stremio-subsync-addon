## Why

The stremio-subtitle-sync-addon has no test infrastructure. The specs define 18 requirements with 40+ scenarios that need verification, but there is no test runner, no mocking strategy for external provider APIs, no fixture data for subtitle files, and no CI pipeline to catch regressions. Without tests, provider API changes, ffsubsync behavior shifts, and cache bugs will reach users undetected.

## What Changes

- Add Vitest as the test runner with unit and integration test suites
- Create shared test fixtures: sample SRT/ASS files, mock provider API responses (OpenSubtitles, SubDL, Subsource, Podnapisi), and known sync input/output pairs
- Build mock/stub utilities for provider HTTP calls and ffsubsync subprocess invocations
- Add a GitHub Actions CI pipeline that runs lint, unit tests, and integration tests on every push and PR
- Establish coverage thresholds for core modules (providers, sync engine, cache)

## Capabilities

### New Capabilities
- `test-infrastructure`: Test framework setup (Vitest), shared fixtures (SRT files, provider responses, ffsubsync outputs), mock utilities for external APIs and subprocesses, and test helper functions
- `ci-pipeline`: GitHub Actions workflow running lint, unit tests, and integration tests with coverage reporting on push and pull request events

### Modified Capabilities

(none)

## Impact

- **New dev dependencies**: `vitest`, `@vitest/coverage-v8`, `msw` or `nock` (HTTP mocking), `supertest` (HTTP endpoint testing)
- **New files**: `tests/` directory tree, `tests/fixtures/`, `.github/workflows/ci.yml`
- **No runtime dependency changes** — testing is dev-only
- **Requires ffsubsync installed** for integration tests (CI installs it via pip)
