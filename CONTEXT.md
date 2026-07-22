# SubSync — Bazarr-like Subtitle Sync Addon for Stremio/Nuvio

## Problem Statement

Watching movies/shows via AIOStreams + Nuvio. Turkish subtitles are:
1. Hard to find (limited availability on mainstream providers)
2. Often out of sync when found (framerate mismatches, offset errors)
3. No easy way to sync them within the streaming addon ecosystem

Bazarr (part of *arr stack) solves this brilliantly with reference-based sync,
golden-section search, and multi-provider aggregation — but it's tied to local
files + Sonarr/Radarr. We want the same power as a Stremio/Nuvio addon.

---

## Research Findings

### 1. Stremio Addon Protocol — Subtitles

The addon protocol is HTTP-based, REST-like. Subtitles are a first-class resource.

**Endpoint:** `/subtitles/{type}/{id}.json`
- `type`: `movie` or `series`
- `id`: OpenSubtitles file hash; `extraArgs` carries `videoID` and `videoSize`
- For series: video ID format is `tt1234567:1:1` (imdbId:season:episode)

**Response format:**
```json
{
  "subtitles": [
    {
      "id": "unique-id",
      "url": "https://example.com/subtitle.srt",
      "lang": "tur"
    }
  ]
}
```

**Key details:**
- `id` — required, unique per subtitle (differentiates same-language subs)
- `url` — required, direct URL to the subtitle file (.srt, .vtt)
- `lang` — required, ISO 639-2 code (Turkish = `tur`) or free text
- CORS headers must allow all origins
- Can also serve via local streaming server: `http://127.0.0.1:11470/subtitles.vtt?from=<url>`
  (forces encoding detection — useful for Turkish chars in legacy encodings)
- Can link to subtitles inside torrents via infohash + file index

**Manifest registration:**
```json
{
  "resources": [
    {
      "name": "subtitles",
      "types": ["movie", "series"],
      "idPrefixes": ["tt"]
    }
  ]
}
```

**SDK:** `stremio-addon-sdk` (Node.js) — `defineSubtitlesHandler()`
- Also possible in any language via raw HTTP (Go, Python, etc.)
- Protocol docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Subtitle response docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md

### 2. AIOStreams Architecture

AIOStreams (by viren070) is a **meta-addon** that wraps multiple source addons
into one configurable stream list. It handles streams, not subtitles directly.

- Subtitle addons are installed **separately** in Stremio/Nuvio (or wrapped inside AIOStreams)
- AIOStreams config: https://aiostreams.elfhosted.com/configure
- Official docs: https://docs.aiostreams.viren070.me/
- Setup guide: https://guides.viren070.me/stremio/addons/aiostreams/setup
- Discord: https://discord.viren070.me

**Nuvio compatibility:** Any Stremio addon manifest URL works in Nuvio. Same URL,
same config, same behavior. Subtitle addons install identically.

### 3. Bazarr's Sync Features (What We're Replicating)

Bazarr uses **ffsubsync** under the hood for automatic subtitle synchronization.

#### Reference Subtitle Sync (THE killer feature)
- Uses a correctly-synced subtitle (e.g., English) as reference
- Aligns the target subtitle (e.g., Turkish) against it
- **Runs in <1 second** — no video/audio extraction needed
- Command: `ffsubsync reference.srt -i unsynchronized.srt -o synchronized.srt`
- Bazarr setting: "Always use Audio Track as Reference for Syncing" (disable this to use subtitle ref)

#### Golden Section Search (GSS)
- Finds optimal framerate ratio between video and subtitle
- Fixes gradual drift (subtitles start in sync but drift over time)
- Caused by framerate mismatches: 23.976fps vs 25fps, etc.
- Command: `ffsubsync ref -i sub --gss`
- Bazarr setting: "Gold-Section Search" under Subtitles settings

#### Audio-Based Sync (VAD)
- Extracts audio track from video file
- Uses Voice Activity Detection (WebRTC VAD) to find speech segments
- Aligns subtitle timing to speech via FFT cross-correlation
- Slower (20-30s) due to audio extraction
- Bazarr setting: "Automatic Subtitles Synchronization"

#### Other Bazarr Features
- Framerate fix (auto-detect and correct fps mismatch)
- Post-processing (remove hearing-impaired tags like [KNOCKING])
- Custom post-processing scripts
- Multiple subtitle provider support with scoring
- History tracking and manual sync override

### 4. ffsubsync — The Sync Engine

**Repo:** https://github.com/smacke/ffsubsync
**License:** MIT
**Install:** `pip install ffsubsync`
**Docker:** `ghcr.io/smacke/ffsubsync:latest`

#### Algorithm (3 steps):
1. Discretize both reference and target into 10ms windows
2. For each window, determine speech presence (binary: 1 or 0)
   - For subtitles: trivial — is any cue active in this window?
   - For audio: use VAD (WebRTC, auditok, or silero)
3. Align the two binary strings via FFT cross-correlation
   - Score = (# matched 1s) - (# mismatched 1s)
   - FFT brings O(n²) down to O(n log n)
   - Best-scoring offset = the sync correction

#### Key CLI options:
```bash
# Reference subtitle sync (fast, <1s)
ffsubsync reference.srt -i unsynced.srt -o synced.srt

# Audio-based sync (slower, 20-30s)
ffsubsync video.mp4 -i unsynced.srt -o synced.srt

# Golden section search for framerate
ffsubsync ref -i sub --gss -o synced.srt

# No framerate fix (offset only)
ffsubsync ref -i sub --no-fix-framerate -o synced.srt

# Max offset (default 60s)
ffsubsync ref -i sub --max-offset-seconds 120 -o synced.srt

# Piecewise sync for mid-file breaks
ffsubsync ref -i sub --split-penalty -o synced.srt

# Remote reference URL support
ffsubsync "https://example.com/ref.srt" -i sub -o synced.srt

# Skip low-quality syncs
ffsubsync ref -i sub --skip-sync-on-low-quality -o synced.srt
```

#### Python library usage:
```python
import ffsubsync
from ffsubsync.ffsubsync import make_parser

args = make_parser().parse_args(["ref.srt", "-i", "in.srt", "-o", "out.srt"])
result = ffsubsync.run(args)
```

#### Browser version (WASM):
https://smacke.github.io/ffsubsync — syncs in-browser, nothing uploaded.
Uses ffmpeg.wasm for audio decoding. Could be inspiration for client-side approach.

#### Alternative sync tools:
- **alass** (Rust) — dynamic programming, good for piecewise: https://github.com/kaegi/alass
- **subsync** (C#) — neural net: https://github.com/tympanix/subsync
- **autosubsync** — spectrogram + logistic regression: https://github.com/oseiskar/autosubsync
- **AutoSubSync** (denizsafak) — GUI wrapper for alass/ffsubsync: https://github.com/denizsafak/AutoSubSync

### 5. Existing Subtitle Addons (The Gap)

| Addon | Sources | Sync | Translation | Notes |
|---|---|---|---|---|
| OpenSubtitles V3 | OpenSubtitles | ❌ | ❌ | Most popular, basic search |
| OpenSubtitles V3 Pro | OpenSubtitles | ❌ | ❌ | Ad-free, no API key needed |
| SubDL addon | SubDL | ❌ | ❌ | Good coverage |
| SubSource | SubSource | ❌ | ❌ | Community subs |
| SubHero | SubHero | ❌ | ❌ | Newer provider |
| **StremioSubMaker** | OS, SubDL, SubSource, Wyzie, Subs.ro | ❌ (roadmap) | ✅ (10+ AI providers) | Closest to what we want |

**StremioSubMaker** (https://github.com/xtremexq/StremioSubMaker):
- Multi-source fetch + AI translation (Gemini, OpenAI, Claude, DeepL, etc.)
- 197 languages, 433 for translation
- Shared translation cache database
- Hosted instance: https://submaker.elfhosted.com
- **Sync is on their roadmap but NOT implemented**
- Node.js, AGPL v3

**Nobody does subtitle syncing in the Stremio/Nuvio ecosystem. This is the gap.**

### 6. Turkish Subtitle Sources

| Source | Type | API/Access | Notes |
|---|---|---|---|
| **turkcealtyazi.org** | Dedicated Turkish | GitHub scraper: https://github.com/febalci/turkcealtyazi.org-API | Largest Turkish sub database |
| **OpenSubtitles** | Multi-language | REST API v3 (key required) | Turkish = `tr` / `tur` |
| **SubDL** | Multi-language | API key from subdl.com/panel/api | Has Turkish subs |
| **SubSource** | Multi-language | API key from subsource.net | Has Turkish subs |
| **Wyzie Subs** | Multi-language | API key from sub.wyzie.io/redeem | Community curated |

### 7. Hosting Infrastructure Available

- **coolify-vps** (root@152.53.51.30) — Coolify self-hosting platform
- **pangolin-vps** (ubuntu@141.147.32.220) — VPS
- Docker available on both
- Can deploy via Coolify or plain Docker

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────┐
│                   SubSync Addon                      │
│                                                      │
│  GET /manifest.json                                  │
│  GET /subtitles/{type}/{id}.json                     │
│  GET /configure (config UI)                          │
│  GET /cached/{hash}.srt (serve synced subtitles)     │
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │            Subtitle Aggregator                 │   │
│  │  ┌─────────┐ ┌───────┐ ┌─────────┐ ┌──────┐  │   │
│  │  │OpenSubs │ │SubDL  │ │SubSource│ │turkce│  │   │
│  │  │  API    │ │ API   │ │  API    │ │altyazi│  │   │
│  │  └────┬────┘ └───┬───┘ └────┬────┘ └──┬───┘  │   │
│  │       └──────────┴──────────┴──────────┘      │   │
│  │                      │                         │   │
│  │              ┌───────▼────────┐                │   │
│  │              │  Score & Rank  │                │   │
│  │              │  (downloads,   │                │   │
│  │              │   rating, fps) │                │   │
│  │              └───────┬────────┘                │   │
│  └──────────────────────┼────────────────────────┘   │
│                         │                            │
│  ┌──────────────────────▼────────────────────────┐   │
│  │              Sync Engine                       │   │
│  │                                                │   │
│  │  1. Find target sub (Turkish)                  │   │
│  │  2. Find reference sub (English, well-synced)  │   │
│  │  3. ffsubsync ref.srt -i tr.srt --gss          │   │
│  │  4. Validate sync quality score                │   │
│  │  5. Cache result                               │   │
│  │                                                │   │
│  │  Fallback: AI translate EN→TR if no TR sub     │   │
│  └──────────────────────┬────────────────────────┘   │
│                         │                            │
│  ┌──────────────────────▼────────────────────────┐   │
│  │           Cache (SQLite / filesystem)          │   │
│  │  key: {imdbId}:{season}:{episode}:{lang}:{src} │   │
│  │  val: synced .srt file + metadata              │   │
│  │  TTL: configurable (default 30 days)           │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Core Features (Priority Order)

**P0 — MVP:**
1. Multi-source subtitle search (OpenSubtitles + SubDL + turkcealtyazi.org)
2. Reference-based sync (English ref → Turkish target) via ffsubsync
3. Golden-section search for framerate correction
4. Serve synced subtitles via URL
5. Basic caching (sync once, serve many)
6. Config page (API keys, preferred languages, sync options)

**P1 — Enhanced:**
7. AI translation fallback (EN→TR via Gemini/DeepL when no TR sub exists)
8. Subtitle quality scoring (downloads, rating, sync confidence)
9. Encoding detection/fix (Windows-1254 for Turkish, UTF-8 output)
10. Hearing-impaired tag removal

**P2 — Advanced:**
11. Community sync cache (shared database, sync once benefits all)
12. Multiple reference candidates (try best English sub, fallback to next)
13. Piecewise sync for director's cuts / extended editions
14. Subtitle offset fine-tuning endpoint (manual ±N seconds)
15. Batch sync for TV series (sync entire season at once)

### Tech Stack

- **Runtime:** Node.js 18+ (Stremio Addon SDK)
- **Sync engine:** ffsubsync (Python subprocess) or Docker microservice
  - Alternative: port core algorithm to JS (FFT cross-correlation is portable)
  - npm packages: `fft.js` or `ndarray-fft` for the JS port
- **Database:** SQLite (better-sqlite3) for cache + metadata
- **Config UI:** Express + server-rendered HTML (like other Stremio addons)
- **Deployment:** Docker (multi-stage: Node + Python + ffmpeg)
- **Hosting:** coolify-vps or pangolin-vps

### Key Design Decisions to Make

1. **ffsubsync integration approach:**
   - Option A: Python subprocess (`child_process.spawn`) — simplest, uses battle-tested ffsubsync
   - Option B: Docker sidecar (ffsubsync container) — cleaner isolation
   - Option C: JS port of the algorithm — no Python dependency, but more work
   - **Recommendation:** Option A for MVP, consider C later

2. **Reference subtitle selection:**
   - How to pick the "best" English reference? Most downloads? Highest rated?
   - What if English sub is also out of sync? (Need confidence scoring)
   - Should we try multiple references and pick best sync score?

3. **Turkish subtitle source priority:**
   - turkcealtyazi.org first (dedicated Turkish, likely best coverage)?
   - Or OpenSubtitles first (better API, more metadata)?

4. **Caching strategy:**
   - Filesystem vs SQLite for synced .srt files?
   - Cache invalidation: when source sub is updated?
   - Shared community cache: how to handle trust/quality?

5. **Sync quality threshold:**
   - ffsubsync returns a score — what's "good enough"?
   - `--skip-sync-on-low-quality` flag exists — use it
   - Should we serve unsynced original as fallback if sync quality is low?

---

## Reference Links

- Stremio Addon SDK: https://github.com/stremio/stremio-addon-sdk
- Stremio Protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Subtitle Response: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/subtitles.md
- ffsubsync: https://github.com/smacke/ffsubsync
- ffsubsync browser: https://smacke.github.io/ffsubsync
- StremioSubMaker: https://github.com/xtremexq/StremioSubMaker
- turkcealtyazi API: https://github.com/febalci/turkcealtyazi.org-API
- Bazarr: https://github.com/morpheus65535/bazarr
- Bazarr sync CLI: https://github.com/ajmandourah/bazarr-sync
- AIOStreams docs: https://docs.aiostreams.viren070.me/
- AIOStreams setup: https://guides.viren070.me/stremio/addons/aiostreams/setup
- alass (Rust sync): https://github.com/kaegi/alass
- SubDL: https://subdl.com
- SubSource: https://subsource.net
- OpenSubtitles API: https://opensubtitles.org
- Nuvio addon guide: https://nuviosync.com/blog/best-nuvio-addons-2026
- Stremio subtitle sync feature request: https://github.com/Stremio/stremio-features/issues/386
