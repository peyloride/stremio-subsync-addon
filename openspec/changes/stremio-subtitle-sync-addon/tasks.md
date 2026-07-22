## 1. Project Setup

- [x] 1.1 Initialize Node.js project with `package.json` (name: `stremio-subsync-addon`, type: module), add dependencies: `stremio-addon-sdk`, `node-fetch` (or native fetch), `iconv-lite`, `chardet`, `adm-zip`, `express` (or use addon-sdk's built-in serveHTTP)
- [x] 1.2 Create directory structure: `src/providers/`, `src/sync/`, `src/cache/`, `src/handlers/`, `src/utils/`
- [x] 1.3 Add dev dependencies: `vitest` (or `jest`), `eslint`, `prettier`; configure test and lint scripts
- [x] 1.4 Create `src/config.js` — parse addon config from Stremio's `config` object with defaults: `languages: ['en']`, `syncEnabled: true`, `maxOffsetSeconds: 120`, `cacheTtlDays: 30`, `opensubtitlesApiKey: ''`, `subdlApiKey: ''`

## 2. Addon Server & Manifest

- [x] 2.1 Create `src/manifest.js` — build the Stremio manifest object: id `com.subsync.stremio`, resources `["subtitles"]`, types `["movie", "series"]`, idPrefixes `["tt"]`, behaviorHints.configurable with fields for languages, API keys, sync toggle, max offset, cache TTL
- [x] 2.2 Create `src/server.js` — initialize the addon using `stremio-addon-sdk`'s `addonBuilder`, register the subtitles handler, serve via `serveHTTP` on configurable port (default 3100)
- [x] 2.3 Implement `GET /health` endpoint returning `{ status, version, cache: { entries, sizeBytes } }`; check ffsubsync availability on PATH and report "degraded" if missing
- [x] 2.4 Implement `GET /sub/:videoHash/:subtitleId` file-serving endpoint — read from cache directory, set correct Content-Type (`text/srt` or `text/x-ssa`), return 404 if missing

## 3. Subtitle Provider Interface & Utilities

- [ ] 3.1 Define `src/providers/base.js` — `SubtitleProvider` interface (JSDoc or TypeScript types): `name`, `search(query) → ProviderSubtitle[]`, `download(sub) → Buffer`
- [ ] 3.2 Create `src/utils/language.js` — normalize language codes between ISO 639-1, 639-2, and full names (e.g., "eng" → "en", "English" → "en")
- [ ] 3.3 Create `src/utils/archive.js` — extract first `.srt`/`.ass` file from ZIP/GZ/RAR buffers using `adm-zip`
- [ ] 3.4 Create `src/utils/encoding.js` — detect encoding with `chardet`, convert to UTF-8 with `iconv-lite`
- [ ] 3.5 Create `src/utils/release-match.js` — parse release name tokens (group, resolution, codec) from filenames and compute match score between video filename and subtitle release name

## 4. Provider Implementations

- [x] 4.1 Implement `src/providers/opensubtitles.js` — OpenSubtitles REST API v1: hash lookup (`GET /subtitles?moviehash=&moviebytesize=`), IMDB search, filename search; handle API key header, rate limiting (10 req/s), pagination; skip silently if no API key configured
- [x] 4.2 Implement `src/providers/subdl.js` — SubDL API: movie search by IMDB ID, series search with season/episode; normalize results to ProviderSubtitle format
- [x] 4.3 Implement `src/providers/subsource.js` — Subsource API: IMDB-based search for movies and series; normalize results
- [x] 4.4 Implement `src/providers/podnapisi.js` — Podnapisi search: IMDB-based with language filter; normalize results
- [x] 4.5 Create `src/providers/index.js` — provider registry: instantiate enabled providers, run `search()` in parallel with per-provider 10s timeout, merge results, deduplicate by download URL, normalize language codes

## 5. Sync Engine

- [ ] 5.1 Create `src/sync/reference.js` — reference selection cascade: (1) best hash-matched subtitle by score, (2) best release-name match, (3) highest composite score; return null if single candidate
- [ ] 5.2 Create `src/sync/ffsubsync.js` — spawn ffsubsync as child process: `ffsubsync <ref> -i <input> -o <output> --max-offset-seconds <n> --output-encoding same`; 30s timeout; parse stdout/stderr for offset and framerate scale; return `{ offsetSeconds, framerateScaleFactor }` on success, throw on failure
- [ ] 5.3 Create `src/sync/engine.js` — orchestrate: for each non-reference subtitle, write temp files, run ffsubsync (up to 3 concurrent), validate offset ≤ maxOffsetSeconds, replace or fallback to unsynced; clean up temp files
- [ ] 5.4 Add ffsubsync availability check on startup (`which ffsubsync`); if missing, disable sync and log warning

## 6. Cache Layer

- [ ] 6.1 Create `src/cache/store.js` — disk cache at `<cacheDir>/<videoHash>/<subtitleId>.srt` with JSON sidecar `.meta.json` (offsetSeconds, framerateScaleFactor, referenceId, syncedAt, provider); methods: `get(videoHash, subId)`, `put(videoHash, subId, content, meta)`, `has(videoHash, subId)`, `evict()`
- [ ] 6.2 Implement TTL-based eviction: on `get()`, check `syncedAt` against `cacheTtlDays`; on startup, scan and delete expired entries
- [ ] 6.3 Add cache stats for `/health` endpoint: count entries and total size in bytes

## 7. Subtitle Handler (Wiring)

- [ ] 7.1 Create `src/handlers/subtitles.js` — the main `defineSubtitlesHandler` callback: parse `type`, `id` (extract IMDB ID, season, episode from `tt1234:1:5` format), read `extra` (videoHash, videoSize, filename), read `config`
- [ ] 7.2 Implement the pipeline: check cache → search providers → select reference → sync → cache results → build subtitle response objects with URLs pointing to `/sub/<hash>/<id>.srt`
- [ ] 7.3 Handle series ID parsing (`tt1234567:1:5` → imdbId=tt1234567, season=1, episode=5) and movie ID parsing (`tt1234567`)
- [ ] 7.4 Set `cacheMaxAge: 86400` on the response for Stremio client-side caching
- [ ] 7.5 Handle edge cases: no videoHash (use filename only), no providers configured, sync disabled (serve best provider result directly)

## 8. Docker & Deployment

- [ ] 8.1 Write `Dockerfile` — multi-stage: `node:20-slim` base, install `python3 python3-pip`, `pip install ffsubsync`, copy addon code, `npm ci --production`, expose port 3100, `CMD ["node", "src/server.js"]`
- [ ] 8.2 Write `docker-compose.yml` with volume mount for cache persistence (`./data:/data/cache`) and port mapping
- [ ] 8.3 Add `HEALTHCHECK` instruction using `curl http://localhost:3100/health`
- [ ] 8.4 Write `.dockerignore` (node_modules, .git, data, tests)

## 9. Testing

- [ ] 9.1 Unit tests for `utils/language.js` (code normalization), `utils/release-match.js` (release name parsing and matching), `utils/archive.js` (ZIP extraction), `utils/encoding.js` (encoding detection)
- [ ] 9.2 Unit tests for `sync/reference.js` (selection cascade with mock candidate lists)
- [ ] 9.3 Unit tests for `cache/store.js` (put/get/evict with temp directory)
- [ ] 9.4 Integration test for `sync/ffsubsync.js` — sync two known SRT files, verify output exists and offset is within expected range (requires ffsubsync installed)
- [ ] 9.5 Integration test for the subtitle handler — mock provider responses, verify the full pipeline returns correct subtitle objects with valid URLs
- [ ] 9.6 Test the `/health` and `/sub/` endpoints with supertest or similar

## 10. Documentation

- [ ] 10.1 Write `README.md` — what the addon does, architecture diagram, setup instructions (Docker and bare-metal), configuration guide, how sync works, limitations
- [ ] 10.2 Update `CONTEXT.md` to reflect the actual Stremio addon architecture (replace the Home Assistant / Bazarr content)
