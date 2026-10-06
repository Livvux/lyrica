# Visualization and adaptive rendering verification

Verified locally on 2026-10-06 with the production Next.js build and the T3 collaborative browser.

## Behavior

- Six selectable presets: Ocean, Aurora, Pulse, Spectrum, Prism, Mono.
- Flowing waves use smooth quadratic paths with bounded amplitude. Spectrum sampling includes low-frequency bins.
- Preview Auto starts conservatively from CPU/memory hints. Three-second frame-delivery windows lower detail after two slow windows and increase it after six healthy windows. Pause, seek, buffering, and visibility transitions reset sampling.
- Low detail removes visualizer blur and particles; geometry and wave layers have smaller budgets. Manual low/balanced/high selection is available. Preview detail is stripped from export input.
- Export workers account for CPU parallelism/quotas, current memory availability, container memory limits, and decoded audio size. Explicit `RENDER_CONCURRENCY` remains an override. A process rejects overlapping exports instead of killing browser processes.
- Fast export is genuinely 720p24; the old every-second-frame option produced 12 fps. Balanced output remains 1080p30. Lyric frame positions are recalculated at the export frame rate.

## Checks

- `pnpm install --frozen-lockfile`: passed without lockfile changes.
- `pnpm lint`: passed.
- `pnpm type-check`: passed.
- `pnpm test`: 74 passed, including adaptation hysteresis, hardware hints, CPU quotas, memory pressure, long audio, overrides, preset scope, deterministic bounded wave geometry, and bass sampling.
- `pnpm build`: passed. Existing warning: Next.js infers the workspace root from the parent directory's lockfile.
- Browser: all six presets selectable; audio plays; SVG attributes are finite. Low mode renders 32 circular bars or three ring paths with no applied SVG filters.
- Browser: sustained normal playback reported 30 fps and upgraded Auto from balanced to full detail.
- Browser: injecting 55 ms of main-thread work every 75 ms for 8.5 seconds reduced delivered frames to about 20 fps. Auto changed from balanced to low while playback continued. This is a deliberate stress test, not a device benchmark.
- Desktop 1280px and mobile 390px layouts: no horizontal overflow; no application console errors. Audio replacement can produce expected aborted media requests.
- Uploaded a six-second generated tone through the editor, selected presets, and exported through the UI. Both render requests and complete MP4 downloads returned HTTP 200. A range download returned HTTP 206 with exactly the requested 1,024 bytes.
- `ffprobe` confirmed Aurora fast export: H.264 1280x720 at 24 fps plus AAC, 6.059 seconds. Spectrum balanced export: H.264 1920x1080 at 30 fps plus AAC, 6.059 seconds. A frame extracted from the fast export was visually inspected for smooth waves and correct full-frame scaling.

## Scope and limitations

This is not an all-device benchmark or a before/after speedup claim. Live export/browser checks ran on macOS. Container quota and low-memory selection have regression coverage but were not run on a live Linux container. Available resource estimates cannot guarantee that arbitrary media will fit in memory. Multiple app processes need a shared queue or resource isolation to coordinate exports.

Local Next.js documentation was absent; existing App Router patterns and installed types were used. Remotion Player events and render options were checked against current Context7 documentation and installed package types. No dependency or lockfile changes were needed.
