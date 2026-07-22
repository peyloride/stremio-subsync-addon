## ADDED Requirements

### Requirement: Reference subtitle selection
The system SHALL select the best reference subtitle from the candidate list using a priority cascade: (1) exact videoHash match, (2) release-name match against the video filename, (3) highest composite score (downloads × rating). If only one candidate exists or none qualify, no sync SHALL be performed and the subtitle SHALL be served as-is.

#### Scenario: Hash-matched reference available
- **WHEN** the candidate list contains one or more subtitles with `hashMatch: true`
- **THEN** the system SHALL select the hash-matched subtitle with the highest score as the reference

#### Scenario: Release-name match fallback
- **WHEN** no hash-matched subtitle exists but a candidate's `releaseName` matches the video `filename` (case-insensitive substring match on the release group and resolution tokens)
- **THEN** the system SHALL select the best release-name-matched subtitle as the reference

#### Scenario: Score-based fallback
- **WHEN** no hash or release-name match exists
- **THEN** the system SHALL select the subtitle with the highest composite score as the reference

#### Scenario: Single candidate
- **WHEN** only one subtitle candidate exists for a given language
- **THEN** the system SHALL serve it unsynced (no reference to sync against)

### Requirement: SRT-to-SRT synchronization via ffsubsync
The system SHALL invoke ffsubsync as a child process to synchronize each non-reference subtitle against the selected reference. The command SHALL be: `ffsubsync <reference.srt> -i <unsynced.srt> -o <synced.srt> --max-offset-seconds <threshold> --output-encoding same`.

#### Scenario: Successful sync
- **WHEN** ffsubsync completes with exit code 0 and produces a valid output file
- **THEN** the system SHALL replace the unsynced subtitle with the synced output and record the offset in cache metadata

#### Scenario: Sync exceeds max offset
- **WHEN** ffsubsync reports an offset greater than the configured `maxOffsetSeconds` (default 120)
- **THEN** the system SHALL discard the synced output and serve the original unsynced subtitle

#### Scenario: ffsubsync process failure
- **WHEN** ffsubsync exits with a non-zero code, times out (default 30s), or produces no output file
- **THEN** the system SHALL log the error and serve the original unsynced subtitle as fallback

#### Scenario: Multiple languages synced against same reference
- **WHEN** candidates exist in multiple languages and a reference is selected
- **THEN** the system SHALL sync each non-reference language subtitle against the same reference in parallel (up to 3 concurrent ffsubsync processes)

### Requirement: Sync result caching
The system SHALL cache synced subtitle files on disk at `<cacheDir>/<videoHash>/<subtitleId>.srt` with a JSON sidecar `<subtitleId>.meta.json` containing: `offsetSeconds`, `framerateScaleFactor`, `referenceId`, `syncedAt`, `providerSyncedFrom`.

#### Scenario: Cache hit
- **WHEN** a subtitle request arrives and a cached synced file exists for the same `(videoHash, subtitleId)` pair and is younger than the configured TTL (default 30 days)
- **THEN** the system SHALL serve the cached file without re-searching providers or re-running ffsubsync

#### Scenario: Cache miss
- **WHEN** no cached file exists for the `(videoHash, subtitleId)` pair
- **THEN** the system SHALL perform the full search-select-sync pipeline and cache the result

#### Scenario: Cache eviction
- **WHEN** a cached entry is older than the configured TTL
- **THEN** the system SHALL treat it as a cache miss and re-sync

#### Scenario: Cache directory cleanup
- **WHEN** the addon starts
- **THEN** the system SHALL scan the cache directory and delete entries older than the TTL

### Requirement: Sync toggle and configuration
The system SHALL allow the user to disable automatic synchronization via addon configuration. When sync is disabled, the system SHALL serve the best-matching subtitle from providers without running ffsubsync.

#### Scenario: Sync disabled
- **WHEN** the user sets `syncEnabled: false` in addon config
- **THEN** the system SHALL return provider subtitles directly without synchronization

#### Scenario: Custom max offset
- **WHEN** the user sets `maxOffsetSeconds: 60` in addon config
- **THEN** the system SHALL pass `--max-offset-seconds 60` to ffsubsync and reject offsets above 60 seconds
