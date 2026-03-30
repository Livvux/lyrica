# Remotion Rendering Performance Optimization for Long Videos

Research for Lyrica: 30+ minute videos at 1080p 30fps.

**Context**: A 30-min video at 30fps = 54,000 frames. Current `renderMedia` call in
`src/lib/render-video.ts` uses only `codec: "h264"` with zero performance tuning.

---

## 1. renderMedia Options That Affect Speed

### 1.1 concurrency

Controls how many browser tabs render frames in parallel. Default is `50%` of CPU cores.

```ts
await renderMedia({
  // ...
  concurrency: 8, // number of parallel browser tabs
});
```

**How to find optimal value**: Use `npx remotion benchmark --concurrency=2,4,6,8,12,16` on a
short segment. More concurrency = more RAM. For 1080p with SVG visualizer, start with
`Math.floor(os.cpus().length * 0.75)` and benchmark from there.

**Recommendation**: Set explicitly to `Math.min(os.cpus().length, 8)` as a starting point.
For a machine with 10 cores, 8 is typically optimal because the remaining cores handle
encoding and OS overhead.

### 1.2 imageFormat + jpegQuality

```ts
await renderMedia({
  // ...
  imageFormat: "jpeg", // DEFAULT and fastest. "png" is 2-5x slower.
  jpegQuality: 80,     // default is 80. Lower = faster encoding + smaller temp files
});
```

- `jpeg` is already the default and fastest option (no alpha channel processing).
- Reducing `jpegQuality` to 60-70 reduces temp frame file sizes (faster disk I/O) with
  negligible visual difference after H.264 re-encoding.
- Only use `png` if you need transparency (you don't for lyrics videos).

**Recommendation**: Keep `jpeg`, lower to `jpegQuality: 70`.

### 1.3 scale

Renders at a lower resolution, then the codec encodes at that size.

```ts
await renderMedia({
  // ...
  scale: 0.5, // renders at 960x540, final output is 960x540
});
```

**Warning**: This changes the OUTPUT resolution, not just the render resolution.
There is no "render small, upscale to 1080p" option in renderMedia.
Use only for draft/preview renders.

**Recommendation**: Use `scale: 0.5` for a "fast preview" mode, keep `scale: 1` for final.

### 1.4 codec + crf + x264Preset

```ts
await renderMedia({
  // ...
  codec: "h264",
  crf: 23,               // default ~18 for h264. Higher = smaller file, slightly faster
  x264Preset: "faster",  // HUGE impact. Default is probably "medium"
});
```

**x264Preset values (fastest to slowest)**:
`ultrafast` > `superfast` > `veryfast` > `faster` > `fast` > `medium` > `slow` > `slower` > `veryslow`

Each step roughly doubles encoding time. For a 30-min video:
- `ultrafast`: ~3x faster encoding than `medium`, but ~40% larger file
- `veryfast`: ~2x faster than `medium`, ~20% larger file
- `faster`: good balance of speed and file size

**Recommendation**: Use `x264Preset: "faster"` for production, `"ultrafast"` for previews.
Set `crf: 23` (visually transparent for lyrics content, faster than default 18).

### 1.5 hardwareAcceleration

Offloads H.264 encoding to GPU/hardware encoder (VideoToolbox on macOS, NVENC on Linux).

```ts
await renderMedia({
  // ...
  hardwareAcceleration: "if-possible", // falls back to software if unavailable
});
```

**Important**: Cannot be used with `crf`. Use `videoBitrate` instead when hardware accelerated.

```ts
// Hardware-accelerated alternative
await renderMedia({
  // ...
  hardwareAcceleration: "if-possible",
  videoBitrate: "8M", // replaces crf
});
```

On macOS, this uses `h264_videotoolbox` which is 3-5x faster for encoding.
On Linux with NVIDIA GPU, uses `h264_nvenc`.

**Recommendation**: Use `hardwareAcceleration: "if-possible"` with `videoBitrate: "8M"`.
This is the single biggest encoding speed improvement available.

### 1.6 disallowParallelEncoding

```ts
await renderMedia({
  // ...
  disallowParallelEncoding: false, // default: false (parallel IS enabled)
});
```

When `false` (default), frames are encoded to video while new frames are still being
rendered. This is faster but uses more RAM. For 30-min videos, RAM may be a concern.

**Recommendation**: Keep default (`false`) unless OOM errors occur. If memory is tight,
set to `true` and accept ~20% speed loss.

### 1.7 chromiumOptions / GL renderer

```ts
await renderMedia({
  // ...
  chromiumOptions: {
    gl: "angle",           // Use ANGLE for GPU-accelerated rendering
    disableWebSecurity: true, // May help with audio loading
  },
});
```

`gl` options: `"angle"` (GPU via ANGLE), `"egl"` (Linux EGL), `"swiftshader"` (software),
`"swangle"` (software ANGLE), `"vulkan"` (Vulkan backend).

- `"angle"` on macOS uses Metal backend - best for SVG/CSS rendering performance.
- Default `"swangle"` is software-only and slower for GPU-dependent effects.

**Recommendation**: Use `gl: "angle"` on macOS for the SVG visualizer.

### 1.8 offthreadVideoDuration / OffthreadVideo

Not relevant here (used for embedding videos within compositions). Lyrica only uses audio.

---

## 2. Architecture-Level Optimizations (Local Rendering)

### 2.1 renderFrames + stitchFramesToVideo (NOT recommended)

Remotion docs explicitly state: "Prefer `renderMedia()` if you can." Since v3.0,
`renderMedia` combines both steps and is faster because it can encode in parallel
with frame rendering. The separate pipeline is only useful if you need to post-process
individual frames.

### 2.2 Bundle Caching (ALREADY DONE)

`src/lib/render-video.ts` already caches the bundle location. Good.

### 2.3 Browser Instance Reuse

```ts
import { openBrowser } from "@remotion/renderer";

// Create once, reuse across renders
const browser = await openBrowser("chrome", {
  chromiumOptions: { gl: "angle" },
});

await renderMedia({
  // ...
  puppeteerInstance: browser,
});

// Close when done
await browser.close();
```

Saves ~2-3 seconds of browser startup per render. For a long video, negligible but
still worth it for repeated renders.

### 2.4 Lambda / Cloud Run (Out of Scope)

`@remotion/lambda` can distribute rendering across multiple Lambda functions, rendering
a 30-min video in parallel chunks. Each chunk renders independently and results are
stitched. This can reduce a 30-min render from hours to minutes.

NOT implementing now (requires AWS setup), but worth noting for future scaling.

---

## 3. SVG Performance Analysis (AudioVisualizer)

### Current State (`src/remotion/audio-visualizer.tsx`)

Per frame, the visualizer renders:
- 2 SVG `<filter>` elements with `feGaussianBlur` (bar-glow, ball-glow)
- 64 outer `<line>` elements, each with `filter="url(#bar-glow)"`
- 64 inner `<line>` elements (no filter)
- 1 `<circle>` with `filter="url(#ball-glow)"`
- 1 `<image>` (logo)

**Total: 128 lines + 2 blur filters applied to 65 elements = SIGNIFICANT bottleneck.**

### Why This Is Slow

`feGaussianBlur` is one of the most expensive SVG operations. It's applied per-element
(not once to a group). Each of the 64 outer bars has its own blur pass. Chromium must:
1. Rasterize each line
2. Apply Gaussian blur (O(pixels * kernel_size))
3. Composite with feMerge

At 1080p with `stdDeviation` up to 12 (4 + 8), that's a massive kernel per bar.

### Optimization Options

**Option A: Remove filter from individual bars, apply to group (QUICK WIN)**
```tsx
// Instead of filter on each <line>, wrap all bars in <g filter="url(#bar-glow)">
<g filter="url(#bar-glow)">
  {frequencyData.map((amp, i) => (
    <line key={`outer-${i}`} /* ... no filter prop */ />
  ))}
</g>
```
This applies ONE blur pass to all 64 bars instead of 64 separate blur passes.
**Expected speedup: 5-20x for the visualizer component.**

**Option B: Reduce bar count**
```ts
const NUM_BARS = 32; // halve from 64
```
Halving bars = halving SVG elements. Visually still looks good.

**Option C: Replace SVG blur with CSS filter**
SVG filters inside Remotion are CPU-rendered. CSS `filter: blur()` may be GPU-accelerated
depending on the `gl` setting.

**Option D: Pre-render the glow as a radial gradient**
Replace `feGaussianBlur` with a static radial gradient overlay that scales with bass.
No per-frame blur computation.

**Option E: Use Canvas 2D instead of SVG**
Canvas is faster for many dynamic elements. However, this requires a larger rewrite.

**Recommendation**: Apply Option A first (group filter), then Option B (32 bars).
This alone could speed up frame rendering by 50%+ when the visualizer is active.

---

## 4. BeatParticles Performance

### Current State (`src/remotion/beat-particles.tsx`)

80 `<div>` elements per frame with `position: absolute` and `transform: scale()`.
Uses `willChange: "transform, opacity"` which hints GPU compositing.

**Verdict**: This is fine. 80 absolutely-positioned divs is lightweight compared to
the SVG visualizer. The `seededRandom` function is pure math, negligible cost.
No optimization needed here.

---

## 5. Audio Analysis Caching

### Current State (`src/remotion/use-beat-pulse.ts`)

```ts
const audioData = useAudioData(audioUrl); // fetches + decodes audio ONCE
const visualization = visualizeAudio({ fps, frame, audioData, numberOfSamples: 64 });
```

**Good news**: `useAudioData` is a Remotion hook that caches the decoded audio data.
It fetches and decodes once, then returns the same `AudioData` object on every frame.

`visualizeAudio` does an FFT computation per frame, but with only 64 samples this is
extremely fast (microseconds). **No optimization needed.**

The only concern is memory: for a 30-min audio file, the decoded PCM data stays in
memory for the entire render. At 44.1kHz stereo 32-bit float, that's ~30 * 60 * 44100
* 2 * 4 = ~634 MB. This is significant but unavoidable if beat reactivity is needed.

**Recommendation**: If memory becomes an issue, allow users to disable beat effects
for long videos (intensity: "off" already skips audio loading via early return).

---

## 6. Optimized renderMedia Configuration

Here is the recommended configuration for `src/lib/render-video.ts`:

```ts
import { cpus } from "os";

// For production renders (quality priority)
await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: "h264",
  outputLocation: outputPath,
  inputProps,
  // -- Performance options --
  imageFormat: "jpeg",
  jpegQuality: 70,
  concurrency: Math.min(cpus().length, 8),
  x264Preset: "faster",
  crf: 23,
  chromiumOptions: {
    gl: "angle",
  },
  onProgress: ({ progress }) =>
    onProgress?.({ phase: "rendering", progress }),
});

// For fast preview renders (speed priority)
await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: "h264",
  outputLocation: outputPath,
  inputProps,
  // -- Speed-optimized --
  imageFormat: "jpeg",
  jpegQuality: 50,
  concurrency: Math.min(cpus().length, 12),
  hardwareAcceleration: "if-possible",
  videoBitrate: "5M",
  x264Preset: "ultrafast",
  scale: 0.5,
  chromiumOptions: {
    gl: "angle",
  },
  onProgress: ({ progress }) =>
    onProgress?.({ phase: "rendering", progress }),
});
```

---

## 7. Expected Impact Summary

| Optimization | Estimated Speedup | Effort |
|---|---|---|
| `concurrency: 8` (explicit) | 20-50% | 1 line |
| `x264Preset: "faster"` | 30-60% encoding | 1 line |
| `crf: 23` (vs default 18) | 10-20% encoding | 1 line |
| `jpegQuality: 70` | 5-10% frame I/O | 1 line |
| `gl: "angle"` | 10-30% frame render | 3 lines |
| `hardwareAcceleration` | 3-5x encoding | 2 lines |
| SVG group filter (Option A) | 50%+ visualizer frames | 10 lines |
| Reduce bars to 32 | 20-30% visualizer | 1 line |
| **Combined (conservative)** | **3-6x total** | **~20 lines** |

For a 30-min video that currently takes ~2 hours, these changes could bring it down
to 20-40 minutes. Hardware acceleration alone can cut encoding time by 3-5x.

---

## 8. Benchmarking Workflow

Always benchmark before and after changes:

```bash
# Remotion built-in benchmark tool
npx remotion benchmark --concurrency=2,4,6,8 src/remotion/index.ts LyricsVideo \
  --props='{"lines":[],"audioUrl":"test.mp3","style":{},"durationInFrames":900,"fps":30,"width":1920,"height":1080}'

# Render with verbose logging to identify slowest frames
npx remotion render --log=verbose src/remotion/index.ts LyricsVideo out/test.mp4
```

Use `console.time("visualizer")` inside components to identify per-frame bottlenecks.
