## Why

Stremio users frequently encounter out-of-sync subtitles from provider addons. Existing subtitle addons (SubSense, subtitle-pro, community-subtitles) aggregate sources but serve them as-is, leaving users to manually fix timing offsets. Bazarr solves this for local media libraries by running ffsubsync automatically, but it requires a full server stack (Sonarr/Radarr/Bazarr) and has no Stremio integration. There is no standalone Stremio addon that fetches, syncs, and serves subtitles in one step.

## What Changes

- New Stremio addon exposing the `subtitles` resource via the standard addon protocol (`/manifest.json`, `/subtitles/{type}/{id}.json`)
- Multi-provider subtitle search using `videoHash`, `videoSize`, and `filename` from Stremio's subtitle handler args (OpenSubtitles, SubDL, Subsource, Podnapisi)
- Automatic SRT-to-SRT synchronization via ffsubsync: pick the best-matching subtitle as reference (exact videoHash match > release-name match > highest score), sync all other candidates against it
- HTTP file serving for synced subtitle artifacts with aggressive disk caching keyed by `(videoHash, subtitleId)`
- User-configurable settings via Stremio's manifest config: preferred languages, provider API keys, sync on/off toggle, max offset threshold

## Capabilities

### New Capabilities
- `subtitle-providers`: Multi-provider subtitle search and download (OpenSubtitles REST API, SubDL, Subsource, Podnapisi) with hash/filename/release-name matching and result normalization
- `subtitle-sync`: ffsubsync-based SRT-to-SRT synchronization engine — reference selection, subprocess execution, output caching, and fallback to unsynced when no reference is available
- `addon-server`: Stremio addon HTTP server — manifest with configurable user settings, subtitle handler endpoint, static file serving for synced subtitles, and cache management

### Modified Capabilities

(none — greenfield project)

## Impact

- **New codebase**: Node.js (or Python) HTTP server implementing the Stremio addon protocol
- **Runtime dependency**: ffsubsync (Python package) invoked as a subprocess; requires Python 3.8+ on the host
- **External APIs**: OpenSubtitles REST API (requires user API key), SubDL API, Subsource API, Podnapisi (scraping or API)
- **No Bazarr, Sonarr, Radarr, or Home Assistant dependency** — fully standalone
- **Deployment**: Self-hosted (Docker image) or published to Stremio addon catalog
