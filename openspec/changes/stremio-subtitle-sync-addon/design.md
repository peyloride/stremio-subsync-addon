## Context

Stremio addons communicate over a simple HTTP protocol: the client fetches `/manifest.json` for capabilities, then calls resource handlers like `/subtitles/{type}/{id}.json` with extra args (`videoHash`, `videoSize`, `filename`). The handler returns `{ subtitles: [{ id, url, lang }] }` where `url` points to a servable subtitle file.

ffsubsync is a Python CLI/library that performs language-agnostic subtitle synchronization. For SRT-to-SRT sync it needs no ffmpeg — it extracts speech patterns from subtitle text directly. It is invoked as: `ffsubsync reference.srt -i unsynced.srt -o synced.srt`.

No existing Stremio addon combines multi-provider subtitle search with automatic synchronization.

## Goals / Non-Goals

**Goals:**
- Serve correctly-synced subtitles to Stremio for any movie/series episode
- Aggregate subtitles from ≥3 providers with hash, filename, and release-name matching
- Automatically sync non-matching subtitles against the best available reference using ffsubsync
- Cache synced results to avoid redundant computation
- Zero external service dependencies beyond subtitle provider APIs (no Bazarr, Sonarr, Radarr, HA)
- User-configurable via Stremio's built-in addon config UI

**Non-Goals:**
- Audio/video-based sync (VAD against the media file) — the addon has no access to the video stream
- Subtitle translation
- Subtitle editing or manual offset adjustment UI
- Serving video streams or metadata (subtitles resource only)
- Community-uploaded subtitle database (future consideration)

## Decisions

### 1. Node.js addon with ffsubsync as a child process

**Choice**: Build the addon in Node.js using `stremio-addon-sdk`. Invoke ffsubsync via `child_process.spawnFile`.

**Why not Python**: The `stremio-addon-sdk` is Node.js and handles manifest generation, HTTP routing, CORS, and config parsing. Reimplementing this in Python adds unnecessary work. ffsubsync's CLI interface is stable and subprocess invocation is trivial.

**Why not a Python microservice**: Adds deployment complexity (two processes, inter-process HTTP) for no benefit. A subprocess call is simpler and ffsubsync exits after each sync.

**Requirement**: Python 3.8+ and `pip install ffsubsync` on the host. The Docker image bundles both Node.js and Python.

### 2. Provider modules behind a common interface

**Choice**: Each provider (OpenSubtitles, SubDL, Subsource, Podnapisi) implements a `SubtitleProvider` interface:

```ts
interface SubtitleProvider {
  name: string;
  search(query: SubtitleQuery): Promise<ProviderSubtitle[]>;
  download(sub: ProviderSubtitle): Promise<Buffer>;
}

interface SubtitleQuery {
  type: 'movie' | 'series';
  imdbId?: string;
  tmdbId?: string;
  videoHash?: string;
  videoSize?: number;
  filename?: string;
  season?: number;
  episode?: number;
  languages: string[];  // ISO 639-1
}

interface ProviderSubtitle {
  id: string;           // provider-specific unique ID
  provider: string;
  lang: string;         // ISO 639-1
  url: string;          // download URL
  filename?: string;    // original subtitle filename
  releaseName?: string; // matched release name
  hashMatch: boolean;   // true if matched by videoHash
  downloads?: number;
  rating?: number;
  hearingImpaired?: boolean;
  forced?: boolean;
}
```

**Why**: Uniform interface lets the sync engine and handler treat all providers identically. Adding a new provider is one module.

### 3. Reference selection: hash-match-first cascade

**Choice**: Select the reference subtitle using a priority cascade:

1. **Exact videoHash match** — subtitle was uploaded for this exact video file; almost certainly in sync
2. **Release-name match** — subtitle filename/release matches the video filename (e.g., both contain `Movie.2024.1080p.BluRay.x264`)
3. **Highest score** — most downloads × rating from the provider
4. **No reference** — if only one subtitle exists or none qualify, serve it unsynced

**Why**: Hash matches are the gold standard (the uploader synced against this exact file). Release-name matching covers the common case where the same encode circulates under the same name. Score-based is a reasonable heuristic fallback.

### 4. Disk cache keyed by (videoHash, subtitleId)

**Choice**: Store synced `.srt` files on disk at `<cacheDir>/<videoHash>/<subtitleId>.srt`. A JSON sidecar stores metadata (sync offset, reference used, timestamp). Evict entries older than a configurable TTL (default 30 days).

**Why**: The same video + same source subtitle always produces the same synced output. Disk cache survives restarts. No database needed.

### 5. Sync happens on-demand in the subtitle handler, not eagerly

**Choice**: When `/subtitles/{type}/{id}.json` is called, the addon searches providers, selects a reference, syncs non-reference subtitles, caches them, and returns URLs pointing to its own `/sub/<hash>/<id>.srt` endpoint.

**Why**: Stremio calls the handler when the user opens the subtitle picker. There is no "download event" to hook into. On-demand is the only trigger available. First call is slower (~2-5s for sync), subsequent calls hit cache.

### 6. Docker image with Node.js + Python + ffsubsync

**Choice**: Multi-stage Dockerfile. Final image: `node:20-slim` base, install `python3`, `pip install ffsubsync`, copy addon code.

**Why**: Single container, no external dependencies for the user. ffsubsync's SRT-to-SRT mode needs no ffmpeg, keeping the image small.

## Risks / Trade-offs

**[First-request latency]** → Syncing takes 2-5 seconds on first request for a given video+subtitle pair. Mitigation: aggressive caching; Stremio's `cacheMaxAge` header (set to 24h) prevents the client from re-requesting. The subtitle picker shows a brief loading state.

**[ffsubsync subprocess failures]** → Python crashes, OOM, or corrupt subtitle files. Mitigation: wrap spawn in try/catch with timeout (30s). On failure, serve the unsynced subtitle as fallback. Log the error.

**[Provider API rate limits]** → OpenSubtitles free tier: 10 req/s, 100 downloads/day. Mitigation: parallel provider queries with per-provider rate limiting. User supplies their own API key. Cache provider search results alongside synced files.

**[No video audio access]** → Cannot do VAD-based sync against the actual media. Mitigation: SRT-to-SRT sync against a hash-matched reference covers the primary use case. This is a documented limitation.

**[Reference subtitle is itself out of sync]** → If the hash-matched reference is wrong, all synced subtitles inherit the error. Mitigation: hash-matched subtitles are overwhelmingly accurate (uploaded for that exact file). Release-name matches carry more risk; the max-offset-seconds threshold (default 120s) rejects wild offsets.

**[Subtitle encoding issues]** → Providers serve subtitles in various encodings (UTF-8, Latin-1, CP1252). Mitigation: detect encoding with `chardet`/`iconv-lite` before passing to ffsubsync. Stremio's local streaming server also has an encoding-guessing proxy (`127.0.0.1:11470/subtitles.vtt?from=`).
