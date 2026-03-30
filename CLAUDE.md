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
```

There are no automated tests. The `test-*.ts` files in the root are manual scripts run with `npx tsx`.

## Environment Variables

- `OPENAI_API_KEY` — OpenAI Whisper transcription
- `GROQ_API_KEY` — Groq Whisper transcription
- `TRANSCRIPTION_PROVIDER` — `"openai"` (default) or `"groq"`

## Architecture

### Data Flow

```
UploadForm → POST /api/transcribe → Groq/OpenAI Whisper → TranscriptionResult
  → groupWordsIntoLines() → LyricLine[]
  → CustomizationPanel (style) + LyricsEditor (edit lines) + PreviewPlayer (Remotion Player)
  → ExportButton → POST /api/render → Remotion Bundler/Renderer → MP4 download
```

### Key Directories

- `src/app/` — Next.js App Router: single page (`page.tsx` is the main client component) + two API routes
- `src/app/api/transcribe/` — Accepts audio FormData, saves to `tmp/lyrica/`, returns word-level transcription
- `src/app/api/fonts/` — Returns available system fonts via `fc-list`
- `src/app/api/render/` — Accepts VideoConfig JSON, bundles Remotion, renders MP4, streams back
- `src/components/` — UI components: UploadForm, PreviewPlayer, CustomizationPanel, LyricsEditor, ExportButton
- `src/remotion/` — Video composition: LyricsVideo (orchestrator), LyricsLineComponent, Background, BeatParticles, Watermark, useBeatPulse hook
- `src/lib/` — Core logic: `transcription.ts` (Groq/OpenAI providers), `timing.ts` (word→line grouping)
- `src/types/` — Shared types: TranscriptionResult, LyricLine, VideoConfig, StyleConfig

### Remotion Pipeline

Remotion components are server-side only. `next.config.ts` externalizes `remotion`, `@remotion/bundler`, and `@remotion/renderer` from the webpack server bundle. The render API route bundles the Remotion entry point (`src/remotion/root.tsx`) at request time and renders to a temp MP4 file.

The `useBeatPulse` hook analyzes audio frequency data from `@remotion/media-utils` to drive beat-reactive scaling, glow, and particle effects. Intensity is controlled by StyleConfig (`off`/`subtle`/`strong`).

### Word Grouping Rules (`src/lib/timing.ts`)

Lines break on: pauses >0.5s, punctuation (.,!?;:), or max 7 words. Each line gets 10 fade frames at 30fps.

### Cross-Origin Headers

`next.config.ts` sets `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Opener-Policy: same-origin` on all routes (required for SharedArrayBuffer / audio worklets).

### Server Actions Body Limit

Set to 30MB in `next.config.ts` to handle audio file uploads.

## Stack

Next.js 15 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Remotion 4 · Groq SDK · OpenAI SDK
