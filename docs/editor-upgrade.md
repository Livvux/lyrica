# Local editor upgrade

## Delivered slices and decisions

The implementation builds on the existing Next.js/Remotion editor, visualizers, adaptive preview quality, hardware encoder fallback and memory-aware render concurrency. No dependencies, cloud services or production configuration were added.

Priority order was: (1) responsive formats and source-time clip export, (2) waveform/timing editor and unified history, (3) reusable local audio analysis, (4) restoration, accessibility and regression coverage. Batch export, English localization and notarized desktop release remain separate follow-ups. Existing visualizer presets are reused instead of introducing another template system.

### Composition and timeline

- Landscape1920×1080, vertical1080×1920, square1080×1080 and portrait1080×1350.
- Fast uses the same aspect ratios at1280×720,720×1280,720×720 and720×900,24fps. Balanced/Quality use native size at30fps.
- All edits use the30fps source clock. Clip end is exclusive. Render maps endpoints to the profile fps and passes an inclusive Remotion `frameRange`; audio, line fades, karaoke words and effects therefore retain source time. A24fps export necessarily quantizes to24fps.
- The same source interval is passed as Player in/out frames. Single-frame selections use a Thumbnail because the installed Player rejects equal in/out frames.
- Timeline has bounded waveform and beat geometry, horizontal scroll, zoom, seek, snap to playhead/beats/neighbours, pointer move/resize and numeric timing fields. Alt bypasses snapping. Escape/pointer cancellation discards the draft. A completed drag is one undo action.
- Selected line arrows move one frame, Shift+arrows ten. Timeline ruler arrows seek one frame, Shift one second. Space outside controls toggles playback. Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo/redo outside native text editing.
- Moving/resizing preserves order and neighbour boundaries; karaoke word times move/stretch with the line. Editing text clears obsolete word alignment. Existing transcription timestamps/fade padding remain unchanged until explicitly edited.
- Undo includes lyrics, styles, presets, format, clip selection, lyric visibility, sensitivity and manual beats. Loading a different song starts fresh lyric history.

### Analysis

One22.05kHz decode per cached audio URL, then a worker computes1024-point FFT envelopes at25Hz, eight frequency bands, waveform peaks, onset candidates, tempo and confidence. Preview and export reuse that small deterministic data rather than re-decoding and running FFTs in every render tab. Two successful analyses are cached in memory; reload recomputes analysis. Audio and PCM never go to an analysis API.

Motion combines transient attacks with exponential release and frequency-band body. Sensitivity is adjustable. Beat markers can be added at the playhead or removed within100ms, and corrections participate in history. Uncertain/quiet material may have no BPM. The detector is heuristic with40ms envelope resolution; editing and manual beats remain frame accurate. No semantic kick/snare/drop classification is claimed. Failed analysis falls back to the previous Remotion analysis path, so the editor remains usable.

### Persistence

The existing `lyrica-session-v1` key remains compatible through additive defaults and validated loading. Invalid saved data is preserved and autosaving blocked until a new song is explicitly loaded. Writes debounce300ms and flush on pagehide. Quota/storage failures are visible.

Audio, uploaded backgrounds and logos are also backed up as IndexedDB blobs on this device. On restoration, uncached HEAD requests check server availability;404s are re-uploaded from the device backup. Each asset recovers independently. Missing audio can be relinked without discarding edits when its duration matches. Browser state/media are device-local, not a portable project archive; eviction, private mode and full storage can prevent restoration. Keep original media. Media backups are retained, with no destructive automatic pruning in this change.

### Boundaries and PR4

PR4 (`codex/lambda-r2-private-exports`) was inspected and remains unchanged/unmerged. This upgrade adds no authentication, account model, cloud rendering or competing project database. Web self-hosting still needs a trusted network or external authentication; random filenames do not provide owner isolation.

Future integration must preserve PR4's project-bound persistence keys and requests, add these optional clip/analysis fields to its independent schema, and check its fixed720p/24fps/30s cloud limits. Do not assume local format support implies cloud compatibility.

The render API validates dimensions, intervals, finite bounded analysis arrays and ordered beats. Request bodies have a streamed32MiB limit before JSON parsing. Cancellation/failure removes partial MP4 output and unregisters its abort listener. Bundling/preparation are not immediately interruptible; cancellation is checked at preparation boundaries. One render per process remains the resource guard.

## Verification and benchmarks

Run `pnpm type-check`, `pnpm lint`, `pnpm test`, and `pnpm build`. CI now runs those commands on PRs and main; it does not deploy.

For reproducible real exports, start a disposable **local** production server:

```sh
pnpm build
RENDER_CONCURRENCY=2 pnpm start --hostname 127.0.0.1 --port 47833
# In another terminal:
LYRICA_TEST_QUALITY=balanced node scripts/test-editor-export.mjs
LYRICA_TEST_QUALITY=fast node scripts/test-editor-export.mjs
```

`LYRICA_TEST_ORIGIN` can override the loopback origin. The script synthesizes its own source, analyzes it, uploads it, renders every aspect ratio, probes dimensions/fps/codecs/duration and verifies880Hz then1320Hz in the selected1–3s audio interval. It respects the3/minute limiter, so a full run may wait between jobs. Outputs and machine-readable reports are under ignored `tmp/editor-qa`.

Verified local run on Apple Silicon with two workers,2s clips, Balanced:16:9 wall time6.22s;9:16 5.37s;1:1 4.71s;4:5 5.49s. The4s synthetic analysis took12.65ms. These include request/setup costs and are smoke measurements, not long-track throughput or a controlled before/after benchmark. No speedup percentage is claimed. The old per-frame analysis remains available as a fallback.

The existing macOS wrapper and packaging pipeline were audited but no new signed/notarized package was released. Developer ID signing, notarization, packaged worker acceptance and target-OS GUI verification remain release gates. Existing production dependency audit advisories require a separately verified dependency update; this change does not claim a clean dependency audit.

Fast-profile smoke exports also passed all four formats (4.27s,4.05s,4.35s,3.96s request wall time in the same format order). Browser checks passed at1600×1000 and390×844 with no horizontal page overflow. Playback advanced29frames in approximately1s; pointer drag moved a line from0–90 to8–98frames, and one Cmd+Z restored it. Format undo, numeric clip input, single-frame preview, reload restoration and actual IndexedDB re-upload after removal of the server's test audio passed. Final desktop/mobile axe runs reported zero violations (one manual-review item remains); this is not a complete WCAG certification. The expected404 during recovery and existing missingfavicon were separated from functional network failures. HTTP render cancellation after rendering began left the MP4 count unchanged (9 before/after).
