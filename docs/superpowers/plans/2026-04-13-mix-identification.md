# Mix Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically identify all songs in a multi-song mix upload using AcoustID audio fingerprinting, let the user confirm the tracklist, then run per-song LRCLIB lyrics lookup and validation.

**Architecture:** A new `/api/identify-mix` route samples the audio every 60s, fingerprints each clip via `fpcalc`, queries the AcoustID API, clusters consecutive identical results into song boundaries, and returns `MixTrack[]`. A new `MixTracklistPanel` component shows scanning progress, then an editable track list for confirmation. After confirmation, `runMixValidation` in `page.tsx` runs per-track lyrics lookup and validation, remapping line indices back to global positions for the existing `LyricsValidationPanel`.

**Tech Stack:** AcoustID REST API (free), Chromaprint `fpcalc` binary (brew), ffmpeg (already on Mac Mini), Next.js API routes, React state.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/types/lyrics.ts` | Add `MixTrack` interface |
| Create | `src/app/api/identify-mix/route.ts` | ffmpeg clip extraction → fpcalc fingerprint → AcoustID lookup → cluster |
| Create | `src/components/mix-tracklist-panel.tsx` | Scanning UI + editable track list confirmation |
| Modify | `src/app/page.tsx` | Add mix states, `handleActivateMix`, `handleMixConfirm`, `runMixValidation`, "Mix erkennen" button |
| Modify | `.env.example` | Add `ACOUSTID_API_KEY=` and `FPCALC_PATH=` |

---

## Task 1: Add MixTrack type and env keys

**Files:**
- Modify: `src/types/lyrics.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add MixTrack interface to types**

In `src/types/lyrics.ts`, add after the `SongMatch` interface (after line 180):

```ts
export interface MixTrack {
  startSec: number;
  endSec: number;
  artist: string;
  title: string;
  recordingId?: string;
}
```

- [ ] **Step 2: Add env keys to .env.example**

In `.env.example`, add two new lines:

```
ACOUSTID_API_KEY=
FPCALC_PATH=
```

- [ ] **Step 3: Commit**

```bash
git add src/types/lyrics.ts .env.example
git commit -m "feat(mix): add MixTrack type and env keys"
```

---

## Task 2: /api/identify-mix route

**Files:**
- Create: `src/app/api/identify-mix/route.ts`

- [ ] **Step 1: Create the route file**

Create `src/app/api/identify-mix/route.ts` with the full implementation:

```ts
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { join } from "path";
import { unlink, stat } from "fs/promises";
import { randomUUID } from "crypto";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import type { MixTrack } from "@/types/lyrics";

const TMP_DIR = join(process.cwd(), "tmp", "lyrica");
const ACOUSTID_API = "https://api.acoustid.org/v2/lookup";
const SAMPLE_INTERVAL_SEC = 60;
const SAMPLE_LENGTH_SEC = 20;

// Use FPCALC_PATH env var (set on Mac Mini after brew install chromaprint)
// Falls back to "fpcalc" which works if /opt/homebrew/bin is in PATH
function getFpcalcPath(): string {
  return process.env.FPCALC_PATH ?? "fpcalc";
}

function execCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const out = await execCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    audioPath,
  ]);
  return parseFloat(out.trim());
}

async function extractClip(audioPath: string, offsetSec: number, outPath: string): Promise<void> {
  await execCmd("ffmpeg", [
    "-y", "-ss", String(offsetSec), "-t", String(SAMPLE_LENGTH_SEC),
    "-i", audioPath,
    "-ac", "1", "-ar", "44100",
    outPath,
  ]);
}

async function fingerprintClip(
  clipPath: string
): Promise<{ duration: number; fingerprint: string }> {
  const out = await execCmd(getFpcalcPath(), ["-json", clipPath]);
  return JSON.parse(out) as { duration: number; fingerprint: string };
}

async function queryAcoustid(
  fp: string,
  duration: number,
  apiKey: string
): Promise<{ id: string; title: string; artist: string } | null> {
  const params = new URLSearchParams({
    client: apiKey,
    meta: "recordings",
    fingerprint: fp,
    duration: String(Math.round(duration)),
  });
  const res = await fetch(`${ACOUSTID_API}?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;

  const data = await res.json() as {
    status: string;
    results?: Array<{
      recordings?: Array<{
        id: string;
        title?: string;
        artists?: Array<{ name: string }>;
      }>;
    }>;
  };

  if (data.status !== "ok" || !data.results?.length) return null;
  const rec = data.results[0].recordings?.[0];
  if (!rec) return null;
  return {
    id: rec.id,
    title: rec.title ?? "",
    artist: rec.artists?.[0]?.name ?? "",
  };
}

interface SampleResult {
  timestamp: number;
  recordingId: string | null;
  artist: string;
  title: string;
}

function clusterSamples(samples: SampleResult[], audioDuration: number): MixTrack[] {
  const tracks: MixTrack[] = [];
  let i = 0;

  while (i < samples.length) {
    const current = samples[i];
    if (!current.recordingId) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < samples.length && samples[j].recordingId === current.recordingId) {
      j++;
    }
    tracks.push({
      startSec: current.timestamp,
      endSec: j < samples.length ? samples[j].timestamp : audioDuration,
      artist: current.artist,
      title: current.title,
      recordingId: current.recordingId,
    });
    i = j;
  }

  return tracks;
}

export async function POST(req: Request) {
  const apiKey = process.env.ACOUSTID_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ACOUSTID_API_KEY not configured" },
      { status: 503 }
    );
  }

  let body: { audioFilename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { audioFilename } = body;
  if (!audioFilename || typeof audioFilename !== "string") {
    return NextResponse.json({ error: "audioFilename required" }, { status: 400 });
  }

  const safe = sanitizeFilename(audioFilename);
  const audioPath = join(TMP_DIR, safe);
  try {
    await stat(audioPath);
  } catch {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  let duration: number;
  try {
    duration = await getAudioDuration(audioPath);
  } catch {
    return NextResponse.json({ error: "Could not read audio duration" }, { status: 500 });
  }

  // Build sample offsets: every SAMPLE_INTERVAL_SEC seconds, skip last SAMPLE_LENGTH_SEC
  const offsets: number[] = [];
  for (let t = 0; t + SAMPLE_LENGTH_SEC <= duration; t += SAMPLE_INTERVAL_SEC) {
    offsets.push(t);
  }
  if (offsets.length === 0) offsets.push(0);

  const samples: SampleResult[] = [];

  for (const offset of offsets) {
    const clipPath = join(TMP_DIR, `mix-${randomUUID()}.wav`);
    try {
      await extractClip(audioPath, offset, clipPath);
      const fp = await fingerprintClip(clipPath);
      const recording = await queryAcoustid(fp.fingerprint, fp.duration, apiKey);
      samples.push({
        timestamp: offset,
        recordingId: recording?.id ?? null,
        artist: recording?.artist ?? "",
        title: recording?.title ?? "",
      });
    } catch {
      samples.push({ timestamp: offset, recordingId: null, artist: "", title: "" });
    } finally {
      unlink(clipPath).catch(() => {});
    }
    // AcoustID rate limit: ≤3 req/s
    await new Promise<void>((r) => setTimeout(r, 350));
  }

  const tracks = clusterSamples(samples, duration);
  return NextResponse.json({ tracks });
}
```

- [ ] **Step 2: Type-check the new file**

```bash
pnpm type-check 2>&1
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/identify-mix/route.ts
git commit -m "feat(mix): add /api/identify-mix route with AcoustID fingerprinting"
```

---

## Task 3: MixTracklistPanel component

**Files:**
- Create: `src/components/mix-tracklist-panel.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/mix-tracklist-panel.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import type { MixTrack } from "@/types/lyrics";

interface MixTracklistPanelProps {
  audioFilename: string;
  onConfirm: (tracks: MixTrack[]) => void;
  onSkip: () => void;
}

export function MixTracklistPanel({
  audioFilename,
  onConfirm,
  onSkip,
}: MixTracklistPanelProps) {
  const [scanning, setScanning] = useState(true);
  const [tracks, setTracks] = useState<MixTrack[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      try {
        const res = await fetch("/api/identify-mix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioFilename }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (data.error) {
          setScanError(data.error);
        } else {
          setTracks(data.tracks ?? []);
        }
      } catch {
        if (!cancelled) setScanError("Scan fehlgeschlagen.");
      } finally {
        if (!cancelled) setScanning(false);
      }
    }

    scan();
    return () => {
      cancelled = true;
    };
  }, [audioFilename]);

  function updateTrack(index: number, field: "artist" | "title", value: string) {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function removeTrack(index: number) {
    setTracks((prev) => prev.filter((_, i) => i !== index));
  }

  if (scanning) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm text-white/60">Mix wird analysiert...</span>
        </div>
        <button
          onClick={onSkip}
          className="mt-3 text-xs text-white/30 transition hover:text-white/50"
        >
          Überspringen
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      <h3 className="mb-4 text-sm font-medium text-white">
        {tracks.length > 0
          ? `${tracks.length} Song${tracks.length !== 1 ? "s" : ""} erkannt`
          : "Keine Songs erkannt"}
      </h3>

      {scanError && (
        <p className="mb-4 text-xs text-amber-400/80">{scanError}</p>
      )}

      {tracks.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {tracks.map((track, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
            >
              <span className="w-12 shrink-0 text-xs text-white/40">
                {formatTime(track.startSec)}
              </span>
              <input
                value={track.artist}
                onChange={(e) => updateTrack(i, "artist", e.target.value)}
                placeholder="Artist"
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
              />
              <span className="text-white/30 text-xs">—</span>
              <input
                value={track.title}
                onChange={(e) => updateTrack(i, "title", e.target.value)}
                placeholder="Titel"
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => removeTrack(i)}
                className="shrink-0 text-white/30 transition hover:text-white/60 text-base leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tracks.length > 0 && (
          <button
            onClick={() => onConfirm(tracks.filter((t) => t.artist && t.title))}
            className="rounded-lg bg-white/15 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/25"
          >
            Bestätigen & Lyrics laden
          </button>
        )}
        <button
          onClick={onSkip}
          className="px-3 py-2 text-xs text-white/30 transition hover:text-white/50"
        >
          Überspringen
        </button>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm type-check 2>&1
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/mix-tracklist-panel.tsx
git commit -m "feat(mix): add MixTracklistPanel component"
```

---

## Task 4: Integrate mix flow into page.tsx

**Files:**
- Modify: `src/app/page.tsx`

The changes are in four places: imports, state declarations, functions, and the JSX return.

- [ ] **Step 1: Update imports at top of page.tsx**

Replace the existing type import line:
```ts
import type { LyricLine, VideoConfig, StyleConfig, ValidationResult, SongMatch, ReferenceLyrics } from "@/types/lyrics";
```
With:
```ts
import type { LyricLine, VideoConfig, StyleConfig, ValidationResult, SongMatch, ReferenceLyrics, MixTrack, LineValidation } from "@/types/lyrics";
```

Add the new component import after the existing component imports:
```ts
import { MixTracklistPanel } from "@/components/mix-tracklist-panel";
```

- [ ] **Step 2: Add mix state variables**

After the `const [pendingLines, setPendingLines] = useState<LyricLine[]>([]);` line, add:

```ts
const [showMixPanel, setShowMixPanel] = useState(false);
```

- [ ] **Step 3: Add mix handler functions**

Add these three functions after the existing `runValidation` function:

```ts
async function handleActivateMix() {
  if (!audioUrl) return;
  const audioFilename = audioUrl.split("/").pop();
  if (!audioFilename) return;

  setIsTranscribing(true);
  setTranscribeError(null);
  try {
    const formData = new FormData();
    formData.append("audioFilename", audioFilename);
    const res = await fetch("/api/transcribe", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok || data.error) {
      setTranscribeError(data.error ?? "Fehler bei der Transkription.");
      return;
    }
    const grouped = groupWordsIntoLines(data.result.words);
    setPendingLines(grouped);
    setShowMixPanel(true);
  } catch {
    setTranscribeError("Fehler bei der Transkription.");
  } finally {
    setIsTranscribing(false);
  }
}

async function runMixValidation(confirmedTracks: MixTrack[], grouped: LyricLine[]) {
  setValidationPhase("fetching");
  setValidationResult(null);

  const allLineValidations: LineValidation[] = [];
  let weightedScore = 0;
  let totalLines = 0;
  let mergedSongMatch: SongMatch | null =
    confirmedTracks[0]
      ? { artist: confirmedTracks[0].artist, title: confirmedTracks[0].title }
      : null;
  let mergedReference: ReferenceLyrics | null = null;

  for (const track of confirmedTracks) {
    // Find global indices of lines in this track's time range
    const trackIndices: number[] = [];
    const trackLines: LyricLine[] = [];
    grouped.forEach((line, i) => {
      if (line.startSec >= track.startSec && line.startSec < track.endSec) {
        trackIndices.push(i);
        trackLines.push(line);
      }
    });
    if (trackLines.length === 0) continue;

    // Fetch reference lyrics for this track
    let reference: ReferenceLyrics | null = null;
    try {
      const lyricsRes = await fetch("/api/lyrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist: track.artist,
          title: track.title,
          durationSec: track.endSec - track.startSec,
        }),
      });
      const lyricsData = await lyricsRes.json();
      reference = lyricsData.lyrics ?? null;
      if (reference && !mergedReference) mergedReference = reference;
    } catch {
      // graceful — validate without reference
    }

    setValidationPhase("validating");
    const songMatch: SongMatch = { artist: track.artist, title: track.title };
    const segResult = validateLines(trackLines, songMatch, reference);

    // Remap lineIndex from segment-local to global
    segResult.lineValidations.forEach((v) => {
      allLineValidations.push({
        ...v,
        lineIndex: trackIndices[v.lineIndex] ?? v.lineIndex,
      });
    });

    weightedScore += segResult.overallScore * trackLines.length;
    totalLines += trackLines.length;
  }

  const overallScore = totalLines > 0 ? Math.round(weightedScore / totalLines) : 100;
  setValidationResult({
    songMatch: mergedSongMatch,
    reference: mergedReference,
    overallScore,
    lineValidations: allLineValidations,
  });
  setValidationPhase("done");
}

async function handleMixConfirm(tracks: MixTrack[]) {
  setShowMixPanel(false);
  await runMixValidation(tracks, pendingLines);
}

function handleMixSkip() {
  setShowMixPanel(false);
  if (pendingLines.length > 0) {
    setLines(pendingLines);
    setLyricsActive(true);
    setPendingLines([]);
  }
}
```

- [ ] **Step 4: Add "Mix erkennen" button and MixTracklistPanel to the JSX**

Find the existing button section in the JSX (the `!lyricsActive` branch that shows "Lyrics aktivieren"). It currently reads:

```tsx
) : !lyricsActive ? (
  <div className="flex flex-col gap-2">
    <button
      onClick={handleActivateLyrics}
      disabled={isTranscribing}
      className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isTranscribing
        ? "Lyrics werden generiert..."
        : "Lyrics aktivieren"}
    </button>
    {transcribeError && (
      <p className="text-sm text-red-400 text-center">
        {transcribeError}
      </p>
    )}
  </div>
```

Replace with:

```tsx
) : showMixPanel && !lyricsActive ? (
  <MixTracklistPanel
    audioFilename={audioUrl!.split("/").pop()!}
    onConfirm={handleMixConfirm}
    onSkip={handleMixSkip}
  />
) : !lyricsActive ? (
  <div className="flex flex-col gap-2">
    <button
      onClick={handleActivateLyrics}
      disabled={isTranscribing}
      className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isTranscribing
        ? "Lyrics werden generiert..."
        : "Lyrics aktivieren"}
    </button>
    <button
      onClick={handleActivateMix}
      disabled={isTranscribing}
      className="rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isTranscribing ? "Lyrics werden generiert..." : "Mix erkennen"}
    </button>
    {transcribeError && (
      <p className="text-sm text-red-400 text-center">
        {transcribeError}
      </p>
    )}
  </div>
```

- [ ] **Step 5: Type-check**

```bash
pnpm type-check 2>&1
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(mix): integrate mix identification and validation into page"
```

---

## Task 5: Build verification

- [ ] **Step 1: Run full build**

```bash
pnpm build 2>&1 | tail -30
```

Expected: build completes, no errors, `/api/identify-mix` listed as a dynamic route.

- [ ] **Step 2: Commit if any fixes were needed**

```bash
git add -p && git commit -m "fix(mix): build fixes"
```

---

## Task 6: Mac Mini deployment

- [ ] **Step 1: Install Chromaprint on Mac Mini**

```bash
ssh macmini "brew install chromaprint"
```

Expected output includes: `fpcalc` installed to `/opt/homebrew/bin/fpcalc`.

Verify:
```bash
ssh macmini "fpcalc --version"
```

Expected: `fpcalc version 1.x.x`

- [ ] **Step 2: Register AcoustID app key**

Open https://acoustid.org/login in a browser, create a free account, then go to https://acoustid.org/new-application to register the app "Lyrica". Copy the API key.

- [ ] **Step 3: Add env vars to Mac Mini**

```bash
ssh macmini "echo 'ACOUSTID_API_KEY=<paste-key-here>' >> ~/dev/lyrica/.env.local"
ssh macmini "echo 'FPCALC_PATH=/opt/homebrew/bin/fpcalc' >> ~/dev/lyrica/.env.local"
```

Verify:
```bash
ssh macmini "grep ACOUSTID ~/dev/lyrica/.env.local"
```

- [ ] **Step 4: Deploy**

```bash
./deploy.sh 2>&1 | tail -20
```

Expected: PM2 restarts, `online` status shown.

- [ ] **Step 5: Smoke test**

```bash
agent-browser --session-name lyrica open https://lyrica.ts.lkmedia.xyz
agent-browser screenshot --annotate
```

Upload a multi-song MP3, click "Mix erkennen", wait for scan, verify tracklist appears.
