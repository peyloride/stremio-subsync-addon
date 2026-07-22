## ADDED Requirements

### Requirement: Test runner setup
The project SHALL use Vitest as the test runner with two separate project configurations: `unit` (no external dependencies required) and `integration` (requires ffsubsync on PATH). The `npm run test` command SHALL run both; `npm run test:unit` and `npm run test:integration` SHALL run them independently.

#### Scenario: Run unit tests without Python
- **WHEN** a developer runs `npm run test:unit` on a machine without Python or ffsubsync
- **THEN** all unit tests SHALL execute and pass without errors related to missing external tools

#### Scenario: Run integration tests with ffsubsync
- **WHEN** a developer runs `npm run test:integration` on a machine with ffsubsync installed
- **THEN** integration tests SHALL execute, invoke real ffsubsync, and verify actual sync output

#### Scenario: Run all tests
- **WHEN** a developer runs `npm run test`
- **THEN** both unit and integration test suites SHALL execute sequentially and report combined results

### Requirement: Provider HTTP mocking
The project SHALL provide a shared MSW (Mock Service Worker) setup that intercepts HTTP requests to all four provider APIs (OpenSubtitles, SubDL, Subsource, Podnapisi). Mock handlers SHALL be loaded from recorded JSON fixtures in `tests/fixtures/providers/`.

#### Scenario: Mock OpenSubtitles hash search
- **WHEN** a unit test calls the OpenSubtitles provider's `search()` with a videoHash
- **THEN** the MSW handler SHALL return the recorded fixture response from `tests/fixtures/providers/opensubtitles-hash.json` without making a real network request

#### Scenario: Mock provider error
- **WHEN** a unit test configures the mock to return HTTP 500 for a provider
- **THEN** the provider module SHALL handle the error gracefully and the test SHALL verify the fallback behavior

#### Scenario: No network leakage
- **WHEN** any unit test runs
- **THEN** zero real HTTP requests SHALL be made to external provider APIs

### Requirement: ffsubsync subprocess mocking
The project SHALL provide a test helper that spies on `child_process.execFile` (or `spawn`) to mock ffsubsync invocations in unit tests. The mock SHALL simulate success (exit 0, output file created), failure (exit 1), and timeout scenarios.

#### Scenario: Mock successful sync
- **WHEN** a unit test invokes the sync engine with the ffsubsync mock in "success" mode
- **THEN** the mock SHALL create the expected output file and the sync engine SHALL proceed as if ffsubsync succeeded

#### Scenario: Mock ffsubsync failure
- **WHEN** a unit test invokes the sync engine with the ffsubsync mock in "failure" mode
- **THEN** the mock SHALL exit with code 1 and the sync engine SHALL fall back to the unsynced subtitle

#### Scenario: Mock ffsubsync timeout
- **WHEN** a unit test invokes the sync engine with the ffsubsync mock in "timeout" mode
- **THEN** the mock SHALL not exit within the timeout period and the sync engine SHALL kill the process and fall back

### Requirement: Test fixtures
The project SHALL include fixture files in `tests/fixtures/`: at minimum `srt/reference.srt` (correctly timed, ≥10 cues), `srt/unsynced.srt` (same content offset by +5 seconds), `srt/latin1.srt` (Latin-1 encoded), `srt/sample.ass` (ASS format), and `archives/sample.zip` (ZIP containing one SRT file).

#### Scenario: SRT-to-SRT sync fixture pair
- **WHEN** an integration test runs ffsubsync with `reference.srt` as reference and `unsynced.srt` as input
- **THEN** the output SHALL have an offset of approximately -5 seconds relative to the unsynced input, and cue text SHALL match the reference

#### Scenario: Encoding fixture
- **WHEN** a unit test reads `srt/latin1.srt` through the encoding utility
- **THEN** the utility SHALL detect the encoding as Latin-1 (or compatible) and convert to valid UTF-8

#### Scenario: Archive extraction fixture
- **WHEN** a unit test passes `archives/sample.zip` to the archive extraction utility
- **THEN** the utility SHALL extract and return the content of the SRT file inside

### Requirement: Test directory structure
The project SHALL organize tests in `tests/unit/` (mirroring `src/` structure) and `tests/integration/`. Each source module SHALL have a corresponding test file (e.g., `src/providers/opensubtitles.js` → `tests/unit/providers/opensubtitles.test.js`).

#### Scenario: Unit test mirrors source
- **WHEN** a developer looks for the test for `src/sync/reference.js`
- **THEN** it SHALL be at `tests/unit/sync/reference.test.js`

#### Scenario: Integration tests are separate
- **WHEN** a developer runs `npm run test:unit`
- **THEN** no files in `tests/integration/` SHALL be executed

### Requirement: Coverage thresholds
The project SHALL enforce minimum line coverage thresholds via Vitest's coverage configuration: `src/providers/` ≥ 80%, `src/sync/` ≥ 90%, `src/cache/` ≥ 90%, `src/utils/` ≥ 90%, overall ≥ 75%. The `npm run test:unit` command SHALL fail if thresholds are not met.

#### Scenario: Coverage below threshold
- **WHEN** unit test coverage for `src/sync/` drops below 90%
- **THEN** the `npm run test:unit` command SHALL exit with a non-zero code and report the coverage violation

#### Scenario: Coverage report generated
- **WHEN** unit tests run
- **THEN** a coverage report SHALL be generated in `coverage/` directory in both text-summary and lcov formats

### Requirement: Spec scenario traceability
Every WHEN/THEN scenario in the project's spec files SHALL have at least one corresponding test case. Test cases SHALL reference the spec requirement name in a comment or test description (e.g., `// spec: subtitle-sync > Reference subtitle selection > Scenario: Hash-matched reference available`).

#### Scenario: All scenarios covered
- **WHEN** a developer reviews test files against spec scenarios
- **THEN** every scenario in `subtitle-providers`, `subtitle-sync`, and `addon-server` specs SHALL have at least one test case referencing it
