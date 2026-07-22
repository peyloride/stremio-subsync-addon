## ADDED Requirements

### Requirement: Stremio addon manifest
The system SHALL serve a valid Stremio addon manifest at `GET /manifest.json`. The manifest SHALL declare the `subtitles` resource, support `movie` and `series` content types, and include a `behaviorHints.configurable` block for user settings.

#### Scenario: Manifest structure
- **WHEN** Stremio fetches `/manifest.json`
- **THEN** the response SHALL include: `id` (reverse-domain format), `version`, `name`, `description`, `resources: ["subtitles"]`, `types: ["movie", "series"]`, `idPrefixes: ["tt"]`, and a `behaviorHints.configurable` array defining user settings

#### Scenario: Configurable settings exposed
- **WHEN** the manifest is served
- **THEN** the `behaviorHints.configurable` array SHALL include fields for: preferred languages (multi-select), OpenSubtitles API key (string), SubDL API key (string), sync enabled toggle (boolean), max offset seconds (number), and cache TTL days (number)

### Requirement: Subtitle handler endpoint
The system SHALL implement `GET /subtitles/{type}/{id}.json` accepting Stremio's extra args (`videoHash`, `videoSize`, `filename`) and returning `{ subtitles: [{ id, url, lang }] }`.

#### Scenario: Movie subtitle request
- **WHEN** Stremio requests `/subtitles/movie/tt1234567.json?videoHash=abc&videoSize=123456&filename=Movie.2024.1080p.mkv`
- **THEN** the system SHALL search providers, sync subtitles, and return subtitle objects with `url` pointing to the addon's own `/sub/` file-serving endpoint

#### Scenario: Series subtitle request
- **WHEN** Stremio requests `/subtitles/series/tt1234567:1:5.json` (season 1, episode 5)
- **THEN** the system SHALL parse the season and episode from the ID, search providers with episode-specific queries, sync, and return subtitle objects

#### Scenario: No subtitles available
- **WHEN** no provider returns results for the requested video
- **THEN** the system SHALL return `{ subtitles: [] }` with HTTP 200

#### Scenario: Cache headers
- **WHEN** subtitles are returned
- **THEN** the response SHALL include `Cache-Control: max-age=86400` (24 hours) to prevent Stremio from re-requesting

### Requirement: Subtitle file serving
The system SHALL serve synced (or unsynced) subtitle files at `GET /sub/{videoHash}/{subtitleId}.srt`. The response SHALL have `Content-Type: text/srt; charset=utf-8` and include the subtitle file content.

#### Scenario: Serve cached synced file
- **WHEN** a request arrives for `/sub/<hash>/<id>.srt` and the file exists in cache
- **THEN** the system SHALL return the file with HTTP 200 and correct content type

#### Scenario: File not found
- **WHEN** a request arrives for a non-existent subtitle file
- **THEN** the system SHALL return HTTP 404

#### Scenario: ASS subtitle format
- **WHEN** the synced output is in ASS format (source was `.ass`)
- **THEN** the system SHALL serve it at `/sub/{videoHash}/{subtitleId}.ass` with `Content-Type: text/x-ssa; charset=utf-8`

### Requirement: Health check endpoint
The system SHALL serve `GET /health` returning `{ status: "ok", version: "<semver>", cache: { entries: <n>, sizeBytes: <n> } }` for monitoring and Docker health checks.

#### Scenario: Healthy
- **WHEN** the addon is running and ffsubsync is available on PATH
- **THEN** `/health` SHALL return HTTP 200 with status "ok"

#### Scenario: ffsubsync missing
- **WHEN** the addon starts but `ffsubsync` is not found on PATH
- **THEN** `/health` SHALL return HTTP 200 with status "degraded" and a warning field, and the addon SHALL still serve unsynced subtitles

### Requirement: Docker deployment
The system SHALL provide a Dockerfile based on `node:20-slim` that installs Python 3, ffsubsync, and the addon code. The container SHALL expose a configurable port (default 3100) and accept a volume mount for the cache directory.

#### Scenario: Docker build and run
- **WHEN** a user builds and runs the Docker image
- **THEN** the addon SHALL be accessible at `http://localhost:3100/manifest.json` and fully functional

#### Scenario: Persistent cache volume
- **WHEN** a user mounts a volume at `/data/cache`
- **THEN** synced subtitle files SHALL persist across container restarts

### Requirement: Addon catalog publishability
The system SHALL be publishable to the Stremio addon catalog. The manifest SHALL include a valid `id`, `version`, `logo`, `background`, and `description`. The addon SHALL support installation via `stremio://<url>/manifest.json`.

#### Scenario: Install via URL
- **WHEN** a user navigates to `stremio://<addon-url>/manifest.json`
- **THEN** Stremio SHALL install the addon and it SHALL appear in the addon list
