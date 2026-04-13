# Mix Identification — Design Spec
**Date:** 2026-04-13
**Status:** Approved

---

## Problem

A user uploads an MP3 that contains multiple songs (a mix). The existing flow only identifies one song (from the filename) and fetches one set of reference lyrics. For mixes, identification fails and validation runs without any reference — no corrections possible.

## Goal

Automatically identify all songs in a mix, show a confirmation step so the user can correct mistakes, then run per-song lyrics lookup and validation.

---

## Approach: AcoustID + Chromaprint

- **Completely free**, no monthly limits, open source
- Requires `fpcalc` (Chromaprint) on the server: `brew install chromaprint`
- Requires a free AcoustID App API key (register at https://acoustid.org/login)
- ffmpeg is already installed on Mac Mini

---

## Architecture

### New: `/api/identify-mix` (POST)

**Input:** `{ audioFilename: string }`

**Process:**
1. Determine audio duration via `ffprobe`
2. Sample at intervals: every 60s, extract a 20s clip with ffmpeg into a temp file
3. For each clip: run `fpcalc` → get fingerprint + duration
4. POST to AcoustID API (`https://api.acoustid.org/v2/lookup`) with fingerprint → get MusicBrainz Recording IDs
5. For each Recording ID: query MusicBrainz API (`https://musicbrainz.org/ws/2/recording/<id>`) → get artist name + track title
6. Cluster adjacent samples that resolve to the same MusicBrainz Recording ID → determine song boundaries
7. Set `endSec` of each track = `startSec` of next track (last track ends at audio duration)

**Output:** `{ tracks: MixTrack[] }` where:
```ts
interface MixTrack {
  startSec: number;
  endSec: number;
  artist: string;
  title: string;
  recordingId?: string; // MusicBrainz ID for deduplication
}
```

**Error handling:**
- If a sample can't be identified: mark as `{ artist: "", title: "", unidentified: true }`
- If AcoustID/MusicBrainz is unreachable: return `{ tracks: [], error: "service_unavailable" }`
- Graceful: unidentified segments are shown in the UI so the user can fill them in manually

**Environment variable:** `ACOUSTID_API_KEY` — added to `.env.example` and Mac Mini `.env.local`

---

### New component: `MixTracklistPanel`

Shown **after transcription**, triggered by a "Mix erkennen" button in the existing validation area.

**States:**
1. **Idle** — "Mix erkennen" button visible
2. **Scanning** — progress indicator ("Scanning mix... 3/8 samples")
3. **Review** — editable list of identified tracks, confirm button
4. **Done** — panel closes, normal validation continues per track

**Track list row:** timestamp (read-only) | Artist field (editable) | Title field (editable) | Delete button

**Confirm button** triggers per-track lyrics fetch + validation.

---

### Modified: Validation flow in `page.tsx`

**Single song (existing):** unchanged — `runValidation(audioFilename, grouped)` as before.

**Mix (new path):**
1. User clicks "Mix erkennen" → call `/api/identify-mix`
2. Show `MixTracklistPanel` with results
3. User confirms → for each `MixTrack`:
   - Filter `grouped` (LyricLine[]) to lines within `[startSec, endSec]`
   - POST to `/api/lyrics` with `{ artist, title, durationSec: endSec - startSec }`
   - Run `validateLines(segmentLines, songMatch, reference)`
4. Merge all segment ValidationResults into one combined result
5. Hand off to existing `LyricsValidationPanel`

No changes to `/api/lyrics`, render pipeline, or `LyricsValidationPanel`.

---

### New type additions (`src/types/lyrics.ts`)

```ts
interface MixTrack {
  startSec: number;
  endSec: number;
  artist: string;
  title: string;
  recordingId?: string;
}
```

---

## Deployment Steps

1. `ssh macmini "brew install chromaprint"` — install fpcalc
2. Register free AcoustID app at https://acoustid.org/login → get API key
3. Add `ACOUSTID_API_KEY=<key>` to Mac Mini `~/.env.local`
4. Add `ACOUSTID_API_KEY=` to `.env.example`
5. `./deploy.sh`

---

## What is NOT changing

- `/api/identify` — single-song flow unchanged
- `/api/lyrics` — works per artist/title, no changes needed
- `LyricsValidationPanel` — receives merged result, no changes needed
- Remotion render pipeline — LyricLines already carry timestamps, no changes needed

---

## Open Questions (resolved)

- **Identification method:** AcoustID (free, no limits) ✓
- **UX confirmation step:** yes, user reviews before proceeding ✓
- **Output:** one continuous video with all songs' lyrics in sequence ✓
