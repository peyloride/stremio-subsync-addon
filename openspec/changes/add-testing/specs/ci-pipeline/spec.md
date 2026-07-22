## ADDED Requirements

### Requirement: CI workflow on push and PR
The project SHALL include a GitHub Actions workflow at `.github/workflows/ci.yml` that triggers on every push to `main` and every pull request targeting `main`. The workflow SHALL run lint, unit tests, and integration tests.

#### Scenario: Push to main
- **WHEN** a commit is pushed to `main`
- **THEN** the CI workflow SHALL trigger and run all jobs

#### Scenario: Pull request opened
- **WHEN** a pull request targeting `main` is opened or updated
- **THEN** the CI workflow SHALL trigger and run all jobs

### Requirement: Lint and unit test job
The CI workflow SHALL include a `lint-unit` job that: uses Node 20, runs `npm ci`, runs `npm run lint`, and runs `npm run test:unit` with coverage. This job SHALL NOT require Python or ffsubsync. The job SHALL fail if lint errors exist or unit tests fail or coverage thresholds are not met.

#### Scenario: Lint failure blocks CI
- **WHEN** the codebase has ESLint errors
- **THEN** the `lint-unit` job SHALL fail and report the lint errors

#### Scenario: Unit test failure blocks CI
- **WHEN** a unit test fails
- **THEN** the `lint-unit` job SHALL fail with the test failure output

#### Scenario: Coverage threshold violation blocks CI
- **WHEN** unit test coverage drops below the configured thresholds
- **THEN** the `lint-unit` job SHALL fail with a coverage report

### Requirement: Integration test job
The CI workflow SHALL include an `integration` job that: uses Node 20, installs Python 3 and ffsubsync via pip, runs `npm ci`, and runs `npm run test:integration`. This job SHALL depend on the `lint-unit` job (runs only after it passes). The ffsubsync version SHALL be pinned to a specific version.

#### Scenario: Integration tests run after unit tests pass
- **WHEN** the `lint-unit` job passes
- **THEN** the `integration` job SHALL start and run integration tests with real ffsubsync

#### Scenario: Integration tests skipped on unit failure
- **WHEN** the `lint-unit` job fails
- **THEN** the `integration` job SHALL NOT run

#### Scenario: ffsubsync version pinned
- **WHEN** the `integration` job installs ffsubsync
- **THEN** it SHALL install a specific pinned version (e.g., `ffsubsync==0.5.0`) to ensure reproducible results

### Requirement: CI status badge
The project README SHALL include a CI status badge linking to the GitHub Actions workflow. The badge SHALL reflect the latest CI run status on `main`.

#### Scenario: Badge shows passing
- **WHEN** the latest CI run on `main` passed all jobs
- **THEN** the README badge SHALL display a "passing" status

#### Scenario: Badge shows failing
- **WHEN** the latest CI run on `main` failed
- **THEN** the README badge SHALL display a "failing" status
