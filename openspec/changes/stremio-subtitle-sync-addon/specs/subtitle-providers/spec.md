## ADDED Requirements

### Requirement: Multi-provider subtitle search
The system SHALL query multiple subtitle providers in parallel and return a unified list of candidate subtitles for a given video. Each provider module SHALL implement a common `SubtitleProvider` interface with `search(query)` and `download(sub)` methods.

#### Scenario: Search by video hash
- **WHEN** the subtitle handler receives a request with a valid `videoHash` and `videoSize`
- **THEN** the system SHALL query all enabled providers using the hash and return all matching subtitles with `hashMatch: true` on exact matches

#### Scenario: Search by filename and metadata
- **WHEN** the subtitle handler receives a request with `filename` and IMDB/TMDB ID but no hash match is found
- **THEN** the system SHALL query providers using the filename, IMDB ID, and (for series) season/episode number, and return matching subtitles

#### Scenario: Provider failure is non-fatal
- **WHEN** one provider returns an error or times out (default 10s per provider)
- **THEN** the system SHALL log the error, exclude that provider's results, and return results from all remaining providers

#### Scenario: No results from any provider
- **WHEN** all providers return zero results
- **THEN** the system SHALL return an empty subtitle list to Stremio

### Requirement: OpenSubtitles provider
The system SHALL integrate with the OpenSubtitles REST API (`https://api.opensubtitles.com/api/v1/`). The user MUST supply their own API key via addon configuration. The provider SHALL support hash-based lookup, IMDB-based search, and full-text filename search.

#### Scenario: Hash-based lookup
- **WHEN** a `videoHash` and `videoSize` are provided
- **THEN** the provider SHALL call `GET /subtitles?moviehash=<hash>&moviebytesize=<size>` and return results with `hashMatch: true`

#### Scenario: IMDB-based search with language filter
- **WHEN** an IMDB ID and language list are provided
- **THEN** the provider SHALL call `GET /subtitles?imdb_id=<id>&languages=<langs>` and return matching subtitles

#### Scenario: Missing API key
- **WHEN** the user has not configured an OpenSubtitles API key
- **THEN** the provider SHALL be skipped silently and other providers SHALL still be queried

### Requirement: SubDL provider
The system SHALL integrate with the SubDL API. The provider SHALL support IMDB-based search with season/episode filtering for series.

#### Scenario: Movie subtitle search
- **WHEN** a movie IMDB ID and language list are provided
- **THEN** the provider SHALL query SubDL and return matching subtitles with release name metadata

#### Scenario: Series subtitle search
- **WHEN** a series IMDB ID, season number, and episode number are provided
- **THEN** the provider SHALL query SubDL with season/episode filters and return matching subtitles

### Requirement: Subsource provider
The system SHALL integrate with the Subsource API. The provider SHALL support IMDB-based search for movies and series.

#### Scenario: Search with IMDB ID
- **WHEN** an IMDB ID and language list are provided
- **THEN** the provider SHALL query Subsource and return matching subtitles

### Requirement: Podnapisi provider
The system SHALL integrate with Podnapisi for subtitle search. The provider SHALL support IMDB-based search with language filtering.

#### Scenario: Search with IMDB ID
- **WHEN** an IMDB ID and language list are provided
- **THEN** the provider SHALL query Podnapisi and return matching subtitles

### Requirement: Result normalization
The system SHALL normalize all provider results into a common `ProviderSubtitle` format with fields: `id`, `provider`, `lang` (ISO 639-1), `url`, `filename`, `releaseName`, `hashMatch`, `downloads`, `rating`, `hearingImpaired`, `forced`.

#### Scenario: Language code normalization
- **WHEN** a provider returns a language as ISO 639-2 (e.g., "eng") or a full name (e.g., "English")
- **THEN** the system SHALL normalize it to ISO 639-1 (e.g., "en")

#### Scenario: Deduplication across providers
- **WHEN** multiple providers return the same subtitle file (identified by matching download URL or file hash)
- **THEN** the system SHALL deduplicate, keeping the entry from the provider with the highest-priority match (hash > release name > score)

### Requirement: Subtitle download
The system SHALL download subtitle files from provider URLs. Downloaded files SHALL be stored temporarily for sync processing. The system SHALL handle compressed formats (ZIP, GZ, RAR) by extracting the first `.srt` or `.ass` file found.

#### Scenario: Download and extract ZIP
- **WHEN** a provider returns a subtitle URL pointing to a ZIP archive
- **THEN** the system SHALL download the archive, extract the first `.srt` file, and return its content as a Buffer

#### Scenario: Download plain SRT
- **WHEN** a provider returns a direct `.srt` URL
- **THEN** the system SHALL download and return the file content as a Buffer

#### Scenario: Encoding detection
- **WHEN** a downloaded subtitle file is not valid UTF-8
- **THEN** the system SHALL detect the encoding (Latin-1, CP1252, etc.) and convert to UTF-8 before further processing
