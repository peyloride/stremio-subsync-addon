> **Notice:** This project was written with AI coding agents (pi + subagents). The code works, tests pass, but it was not hand-written. Read it before you trust it in production.

![CI](https://github.com/peyloride/stremio-subsync-addon/actions/workflows/ci.yml/badge.svg)

# stremio-subsync-addon

A Stremio addon that pulls subtitles from multiple providers and syncs them with [ffsubsync](https://github.com/smacke/ffsubsync) before serving them to your player.

The problem: subtitle addons hand you whatever file the provider has, and half the time the timing is off. This addon picks the best-matching subtitle as a reference, runs ffsubsync against it, and gives you the corrected file. SRT-to-SRT sync, no ffmpeg needed.

## What it does

Searches OpenSubtitles.com, SubDL, and Subsource in parallel when their application API keys are configured. If one of the results matches your video hash (meaning someone uploaded a subtitle for your exact file), that becomes the sync reference. Otherwise it falls back to release-name matching, then download count. Everything that isn't the reference gets synced against it. Results are cached on disk so the second request is instant.

No Bazarr, no Sonarr, no Radarr. Just a single HTTP server.

## Quick start

### Docker

```bash
docker build -t stremio-subsync-addon .
docker run -p 3100:3100 -v ./data:/data/cache stremio-subsync-addon
```

### Bare metal

You need Node.js 20+ and Python 3.8+ with ffsubsync installed.

```bash
pip install ffsubsync
npm install
npm start
```

### Add to Stremio

Open this URL in Stremio (replace the host if it's not running locally):

```
stremio://localhost:3100/manifest.json
```

## Configuration

All settings are in Stremio's addon config UI after you install it.

| Setting | Default | What it does |
|---|---|---|
| Languages | `en` | Subtitle languages to fetch (ISO 639-1 codes) |
| OpenSubtitles.com API Key | *(empty)* | Application key for the modern OpenSubtitles.com API |
| SubDL API Key | *(empty)* | Required for SubDL |
| Subsource API Key | *(empty)* | Required for Subsource |
| Sync Enabled | `true` | Turn off to skip ffsubsync and serve provider results as-is |
| Max Offset (seconds) | `120` | If ffsubsync reports a bigger offset than this, the sync result is discarded |
| Cache TTL (days) | `30` | How long synced files stick around on disk |

The deprecated OpenSubtitles.org fallback is not used. If no API key is configured, no providers are searched. Provider requests, HTTP statuses, durations, zero-result responses, and errors are emitted as structured JSON logs with credentials redacted.

## Development

```bash
npm run lint              # ESLint
npm run test:unit         # Unit tests, no Python needed
npm run test:integration  # Needs ffsubsync on PATH
npm run test              # Both
```

216 tests across 19 files. Coverage thresholds enforced: providers at 80%, sync/cache/utils at 90%.

## Limitations

Sync is SRT-to-SRT only. The addon doesn't have access to the video stream, so it can't do audio-based VAD sync. If no reference subtitle exists (only one candidate, or all providers return nothing), you get the unsynced file.

## License

MIT
