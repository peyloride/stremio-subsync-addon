# Subtitle Sync: Stremio Addon

Stremio addon that fetches subtitles from multiple providers and syncs them with ffsubsync (SRT-to-SRT). Standalone, no Bazarr/Sonarr/Radarr/HA.

## Architecture

- Node.js 20+, ESM (`"type": "module"`)
- Express + `stremio-addon-sdk` (addonBuilder, getRouter)
- ffsubsync (Python 3.8+) called as a child process via `child_process.execFile`
- No ffmpeg needed. SRT-to-SRT sync reads speech patterns from subtitle text

## Modules

```
src/
├── server.js              # Express app, startServer()
├── manifest.js            # Stremio manifest (id: com.subsync.stremio)
├── config.js              # parseConfig(): merges Stremio config + env + defaults
├── providers/
│   ├── base.js            # SubtitleProvider interface (JSDoc typedefs)
│   ├── index.js           # ProviderRegistry: parallel search, dedup, normalization
│   ├── opensubtitles.js   # OpenSubtitles REST API v1 (needs API key)
│   ├── subdl.js           # SubDL API (needs API key)
│   ├── subsource.js       # Subsource API (no key)
│   └── podnapisi.js       # Podnapisi (no key)
├── sync/
│   ├── reference.js       # Selection cascade: hash > release-name > score
│   ├── ffsubsync.js       # Subprocess wrapper (spawn, 30s timeout, parse output)
│   └── engine.js          # Orchestrator: pick ref, sync candidates, cache
├── cache/
│   └── store.js           # Disk cache: <cacheDir>/<videoHash>/<subtitleId>.srt + .meta.json
├── handlers/
│   ├── subtitles.js       # defineSubtitlesHandler: the main pipeline
│   ├── health.js          # GET /health: status, version, cache stats
│   └── sub.js             # GET /sub/:videoHash/:subtitleId: serve synced files
└── utils/
    ├── language.js        # ISO 639-1/639-2/name normalization
    ├── release-match.js   # Release name token parsing and matching
    ├── archive.js         # ZIP/GZ extraction (adm-zip)
    └── encoding.js        # Encoding detection (chardet) + conversion (iconv-lite)
```

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /manifest.json` | Addon manifest with configurable settings |
| `GET /subtitles/:type/:id.json` | Subtitle handler (search, sync, cache, serve) |
| `GET /sub/:videoHash/:subtitleId` | Serve synced subtitle files |
| `GET /health` | Health check + cache stats |

Series ID format: `tt1234567:1:5` (imdbId:season:episode).

## External dependencies

- ffsubsync (`pip install ffsubsync`): Python subprocess for SRT-to-SRT sync
- OpenSubtitles REST API: needs user API key, free tier is 10 req/s and 100 downloads/day
- SubDL API: needs user API key
- Subsource API: no key
- Podnapisi: no key

## Configuration

| Field | Default | Source |
|---|---|---|
| `languages` | `["en"]` | Stremio config UI |
| `opensubtitlesApiKey` | `""` | Stremio config UI |
| `subdlApiKey` | `""` | Stremio config UI |
| `syncEnabled` | `true` | Stremio config UI |
| `maxOffsetSeconds` | `120` | Stremio config UI |
| `cacheTtlDays` | `30` | Stremio config UI |
| `PORT` | `3100` | Env var |
| `CACHE_DIR` | `./data/cache` | Env var |

## Testing

Vitest with two projects: `unit` (no Python needed) and `integration` (needs ffsubsync). Provider HTTP calls mocked with MSW. ffsubsync mocked via child_process spy in unit tests, real in integration. Coverage via `@vitest/coverage-v8` with thresholds (providers 80%, sync/cache/utils 90%, overall 75%).

```bash
npm run test              # all
npm run test:unit         # unit only
npm run test:integration  # needs ffsubsync
npm run lint              # ESLint
```

## Deployment

Docker image based on `node:20-slim` + Python 3 + ffsubsync. One container, port 3100, volume mount at `/data/cache` for persistence.

## Specs

Full specs in `openspec/changes/stremio-subtitle-sync-addon/specs/` (providers, sync, server) and `openspec/changes/add-testing/specs/` (test infra, CI).
