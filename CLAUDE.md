# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Lyrica?

Lyrica is a web app that generates synchronized lyrics videos from audio files. Users upload audio, it gets transcribed with word-level timing (via Groq or OpenAI Whisper), words are grouped into lyric lines, and Remotion renders an MP4 video with animated text, beat-reactive effects, and background visuals. Users can choose any system-installed font for the lyrics text. The UI is in German.

## Commands

```bash
pnpm dev              # Start dev server (Next.js + Turbopack)
pnpm build            # Production build
pnpm lint             # ESLint (next/core-web-vitals)
pnpm type-check       # TypeScript strict check (tsc --noEmit)
pnpm test             # Regression tests in tests/ (node:test, compiled via tsconfig.test.json)
```

## Production Deployment (Mac Mini)

Production runs on **Mac Mini M4 Pro** via PM2. URL (tailnet only, via `tailscale serve`): `https://mini.tail9026f0.ts.net:13002`

```bash
./deploy.sh           # Sync → install → build → restart (einziger Deploy-Befehl; läuft lokal, wenn man auf dem Mini ist, sonst per ssh $DEPLOY_HOST)
```

**Auto-Deploy:** Jeder neue Commit auf `origin/main` geht automatisch live. Der LaunchAgent `com.lyrica.autodeploy` (`~/Library/LaunchAgents/`) ruft alle 5 Minuten `scripts/auto-deploy.sh` im eigenen Klon `~/dev/lyrica-deploy-src` auf und führt bei neuem SHA `deploy.sh` aus. Log: `~/.pm2/lyrica-autodeploy.log`, zuletzt deployter SHA: `~/.lyrica-deployed-sha`. Ein fehlgeschlagener Commit wird nicht erneut gebaut; der nächste Commit oder Löschen der SHA-Datei löst einen neuen Versuch aus.

**Wichtig — nie manuell ändern:**
- `.env.local` auf dem Mac Mini (`~/dev/lyrica/.env.local`) enthält die Production-API-Keys. Wird durch `.rsyncignore` und `.gitignore` geschützt und nie vom MacBook überschrieben.
- `ecosystem.config.js` auf dem Mac Mini enthält PORT=3002, CHROME_EXECUTABLE und den ffmpeg-PATH. Ebenfalls nicht in git und nicht durch Rsync überschreibbar.
- **Nie** `rsync` ohne `--exclude-from=.rsyncignore` ausführen — sonst werden die Keys überschrieben.

**Mac Mini Setup:**
- PM2 verwaltet den Prozess, startet automatisch beim Reboot (LaunchAgent)
- Port 3002 (Port 3000 = AdGuard Home)
- rsync löscht nichts: Dateien, die im Repo entfernt wurden, vor dem Build auf dem Ziel manuell sichern und entfernen (sonst bricht der Type-Check)
- ffmpeg unter `/opt/homebrew/bin/ffmpeg` (arm64-nativ, für Background-Resize)
- Chrome unter `/Applications/Google Chrome.app` (Universal Binary, läuft als arm64)
- Rendering: 12 Worker Draft-Mode, 10 Worker Full-Mode (M4 Pro: 8 P-Kerne + 4 E-Kerne)

## Environment Variables

- `OPENAI_API_KEY` — OpenAI Whisper transcription
- `GROQ_API_KEY` — Groq Whisper transcription
- `TRANSCRIPTION_PROVIDER` — `"groq"` (default) or `"openai"`
- `CHROME_EXECUTABLE` — Pfad zu Chrome/Chromium (auf Mac Mini: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)

## Architecture

### Data Flow

```
UploadForm → POST /api/upload-audio → audioFilename
  → POST /api/transcribe { audioFilename } → Groq/OpenAI Whisper → TranscriptionResult
  → groupWordsIntoLines() → LyricLine[]
  → CustomizationPanel (style) + LyricsEditor (edit lines) + PreviewPlayer (Remotion Player)
  → ExportButton → POST /api/render → Remotion Bundler/Renderer → MP4 download
```

### Key Directories

- `src/app/` — Next.js App Router: single page (`page.tsx` is the main client component) + API routes
- `src/app/api/upload-audio|upload-bg|upload-logo/` — Stream uploads to `tmp/lyrica/` via `src/lib/save-upload.ts` (extension allowlist, random names)
- `src/app/api/transcribe/` — Takes an uploaded `audioFilename`, returns word-level transcription
- `src/app/api/audio/[filename]/`, `src/app/api/render/[filename]/` — Serve uploads/renders with range support (`src/lib/media-response.ts`)
- `src/app/api/identify/`, `lyrics/`, `identify-mix/` — Optional reference-lyrics (LRCLIB) and mix recognition (AcoustID)
- `src/app/api/fonts/` — Returns available system fonts via `fc-list`
- `src/app/api/render/` — Accepts VideoConfig JSON (asset URLs must be same-origin paths), renders MP4, streams progress
- `src/app/api/dev-audio/` — Dev-only sample audio (404 in production)
- `src/components/` — UI components: UploadForm, PreviewPlayer, CustomizationPanel (Text/Visualizer/Szene/Logo tabs), LyricsEditor, ExportButton, validation and mix panels. Shared UI primitives (buttons, inputs, panels, tabs) live as classes in `src/app/globals.css`
- `src/remotion/` — Video composition: LyricsVideo (orchestrator), LyricsLineComponent, Background, BeatParticles, Watermark, useBeatPulse hook
- `src/lib/` — Core logic: `transcription.ts` (Groq/OpenAI providers), `timing.ts` (word→line grouping)
- `src/types/` — Shared types: TranscriptionResult, LyricLine, VideoConfig, StyleConfig

### Remotion Pipeline

Remotion components are server-side only. `next.config.ts` externalizes `remotion`, `@remotion/bundler`, and `@remotion/renderer` from the webpack server bundle. The render API route bundles the Remotion entry point (`src/remotion/root.tsx`) on the first export (cached afterwards) and renders to a temp MP4 file, streaming SSE events (`bundling`/`rendering` progress, then `done` or `error`); the client derives the remaining time. Worker count comes from `src/lib/render-resources.ts` (CPU quota + free memory). The composition always lays out at 1920×1080; the fast profile uses `scale: 2/3` for 720p output. Line frames are authored at 30fps and rescaled to the export fps. Keep every animation deterministic per frame (no `Math.random`/`Date.now`, no CSS transitions).

The `useBeatPulse` hook analyzes audio frequency data from `@remotion/media-utils` to drive beat-reactive scaling, glow, and particle effects. Intensity is controlled by StyleConfig (`off`/`subtle`/`strong`).

### Word Grouping Rules (`src/lib/timing.ts`)

Lines break on: pauses >0.5s, punctuation (.,!?;:), or max 7 words. Each line gets 10 fade frames at 30fps.

### Cross-Origin Headers

`next.config.ts` sets `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin` on all routes (required for SharedArrayBuffer / audio worklets).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Remotion 4 · Groq SDK · OpenAI SDK

## Fonts API

`src/app/api/fonts/` ruft `fc-list` auf (Linux) bzw. fällt auf macOS auf eine Fallback-Liste zurück, da `fc-list` dort nicht verfügbar ist. System-Fonts auf dem Mac Mini sind daher auf die Fallback-Liste beschränkt.
