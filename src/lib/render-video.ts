import path from "path";
import os from "os";
import { existsSync } from "fs";
import { copyFile, stat, mkdir, rm } from "fs/promises";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { bundle } from "@remotion/bundler";
import type { WebpackConfiguration } from "@remotion/bundler";
import { renderMedia, selectComposition, makeCancelSignal } from "@remotion/renderer";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import type { VideoConfig } from "@/types/lyrics";
import { collectMetrics, generateHints, type RenderSummary, type SystemMetrics } from "./system-metrics";

const execFileAsync = promisify(execFile);

/**
 * Kill orphaned headless browser workers from prior renders that may have
 * leaked when PM2 restarted or a request was aborted. These hold ~200 MB-2 GB
 * each and starve subsequent renders of RAM.
 */
async function killOrphanedRenderBrowsers(): Promise<void> {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  try {
    await execFileAsync("pkill", ["-f", "puppeteer_dev_chrome_profile"]);
  } catch {
    // pkill exits non-zero when nothing matched — that's the normal case
  }
}

export type RenderMetrics = {
  fps: number;
  framesRendered: number;
  totalFrames: number;
  elapsedSec: number;
  etaSec: number;
  cpu: SystemMetrics;
};

export type RenderProgress = {
  phase: "bundling" | "rendering" | "done";
  progress: number; // 0-1
};

// Cache the bundle location across renders — only changes when code changes (dev restart)
let cachedBundleLocation: string | null = null;
let bundlePromise: Promise<string> | null = null;

const webpackOverride = (currentConfig: WebpackConfiguration): WebpackConfiguration => ({
  ...currentConfig,
  resolve: {
    ...currentConfig.resolve,
    alias: {
      ...((currentConfig.resolve?.alias && !Array.isArray(currentConfig.resolve.alias))
        ? currentConfig.resolve.alias
        : {}),
      "@": path.join(process.cwd(), "src"),
    },
  },
});

function toSafeAssetName(raw: string): string | null {
  const safe = sanitizeFilename(raw);
  if (!safe || safe === "." || safe === "..") return null;
  if (safe.includes("/") || safe.includes("\\")) return null;
  return safe;
}

async function getOrCreateBundle(
  onProgress?: (p: RenderProgress) => void
): Promise<string> {
  if (cachedBundleLocation) {
    onProgress?.({ phase: "bundling", progress: 1 });
    return cachedBundleLocation;
  }

  // Deduplicate concurrent bundle requests (e.g. pre-bundle + first render race)
  if (bundlePromise) {
    const location = await bundlePromise;
    onProgress?.({ phase: "bundling", progress: 1 });
    return location;
  }

  const entryPoint = path.join(process.cwd(), "src/remotion/index.ts");

  bundlePromise = bundle({
    entryPoint,
    onProgress: (p) => onProgress?.({ phase: "bundling", progress: p / 100 }),
    webpackOverride,
  }).finally(() => {
    bundlePromise = null;
  });

  const location = await bundlePromise;
  cachedBundleLocation = location;
  return location;
}

/**
 * Pre-bundle Remotion at startup so the first render doesn't pay the bundling cost.
 * Called from instrumentation.ts on server start.
 */
export async function preBundleRemotionIfNeeded(): Promise<void> {
  if (cachedBundleLocation) return;
  const start = Date.now();
  console.log("[remotion] Pre-bundling started…");
  await getOrCreateBundle();
  console.log(`[remotion] Pre-bundling done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

/**
 * Resize background image to target dimensions if it's significantly larger.
 * Prevents rendering a 4K image every frame when 1920x1080 or 1280x720 suffices.
 */
async function resizeBgIfNeeded(
  srcPath: string,
  destPath: string,
  targetWidth: number,
  targetHeight: number
): Promise<void> {
  const fileStat = await stat(srcPath);

  // Only resize if image is > 500KB (likely larger than target resolution)
  if (fileStat.size <= 500 * 1024) {
    await copyFile(srcPath, destPath);
    return;
  }

  // Resolve ffmpeg: prefer Homebrew arm64 path on macOS, fall back to PATH
  const ffmpegBin =
    process.platform === "darwin" && existsSync("/opt/homebrew/bin/ffmpeg")
      ? "/opt/homebrew/bin/ffmpeg"
      : "ffmpeg";

  try {
    await execFileAsync(ffmpegBin, [
      "-i", srcPath,
      "-vf", `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`,
      "-q:v", "2",
      "-y", destPath,
    ]);
  } catch {
    // Fallback: just copy if ffmpeg fails (e.g., unsupported format)
    await copyFile(srcPath, destPath);
  }
}

export type RenderCallbacks = {
  onProgress?: (p: RenderProgress) => void;
  onLog?: (message: string) => void;
  onMetrics?: (m: RenderMetrics) => void;
  onSummary?: (s: RenderSummary) => void;
  signal?: AbortSignal;
};

export async function renderVideo(
  config: VideoConfig,
  outputPath: string,
  callbacks?: RenderCallbacks
): Promise<string> {
  const { onProgress, onLog, onMetrics, onSummary, signal } = callbacks ?? {};
  const log = (msg: string) => onLog?.(msg);
  const publicDir = path.join(process.cwd(), "public");
  const tmpDir = path.join(process.cwd(), "tmp", "lyrica");
  let bundleAssetDir: string | null = null;

  const isDraft = config.renderQuality === "draft";
  const renderWidth = isDraft ? 1280 : 1920;
  const renderHeight = isDraft ? 720 : 1080;
  const renderFps = isDraft ? 24 : 30;

  const durationSec = config.durationInFrames / config.fps;
  const renderFrameCount = Math.ceil(durationSec * renderFps);

  log(`Qualität: ${isDraft ? "Draft 720p" : "Full 1080p"}`);
  log(`Auflösung: ${renderWidth}x${renderHeight} @ ${renderFps}fps`);
  log(`Dauer: ${durationSec.toFixed(1)}s → ${renderFrameCount} Frames`);
  log(`Lyrics: ${config.lines.length} Zeilen`);

  const audioFilename = toSafeAssetName(config.audioUrl.split("/").pop() ?? "");
  if (!audioFilename) throw new Error("Ungültige audioUrl: Dateiname konnte nicht extrahiert werden");
  let renderConfig: VideoConfig;

  try {
    await killOrphanedRenderBrowsers();

    log("Remotion-Bundle wird geladen…");
    const bundleStart = Date.now();
    const bundleLocation = await getOrCreateBundle(onProgress);
    log(`Bundle bereit (${((Date.now() - bundleStart) / 1000).toFixed(1)}s)`);

    const assetDirName = `.lyrica-assets/${randomUUID()}`;
    bundleAssetDir = path.join(bundleLocation, assetDirName);
    await mkdir(bundleAssetDir, { recursive: true });

    log("Audio wird in den Render-Asset-Ordner kopiert…");
    const audioSrc = path.join(tmpDir, audioFilename);
    const audioDest = path.join(bundleAssetDir, audioFilename);
    await copyFile(audioSrc, audioDest);
    const audioAssetPath = `/${assetDirName}/${audioFilename}`;

    let bgImageForRender = config.style.bgImage;
    const rawBgName = config.style.bgImage
      .replace(/^\/api\/audio\//, "")
      .replace(/^\//, "");
    const bgImageBasename = toSafeAssetName(rawBgName);

    if (!config.style.bgImage.startsWith("http") && rawBgName && !bgImageBasename) {
      throw new Error("Ungültiger Hintergrund-Dateiname.");
    }

    if (bgImageBasename && !config.style.bgImage.startsWith("http")) {
      const bgDest = path.join(bundleAssetDir, bgImageBasename);
      const tmpBgSrc = path.join(tmpDir, bgImageBasename);
      try {
        await stat(tmpBgSrc);
        log(`Hintergrundbild wird auf ${renderWidth}x${renderHeight} skaliert…`);
        await resizeBgIfNeeded(tmpBgSrc, bgDest, renderWidth, renderHeight);
        bgImageForRender = `/${assetDirName}/${bgImageBasename}`;
      } catch {
        const publicBgSrc = path.join(publicDir, bgImageBasename);
        try {
          await copyFile(publicBgSrc, bgDest);
          bgImageForRender = `/${assetDirName}/${bgImageBasename}`;
          log("Hintergrundbild in den Render-Asset-Ordner kopiert");
        } catch {
          log(`Warnung: Hintergrundbild nicht gefunden: ${bgImageBasename}`);
          bgImageForRender = `/${bgImageBasename}`;
        }
      }
    }

    renderConfig = {
      ...config,
      audioUrl: audioAssetPath,
      style: { ...config.style, bgImage: bgImageForRender },
      width: renderWidth,
      height: renderHeight,
      fps: renderFps,
      durationInFrames: renderFrameCount,
    };

    const inputProps = renderConfig as unknown as Record<string, unknown>;
    const browserExecutable = process.env.CHROME_EXECUTABLE ?? null;

    log("Composition wird ermittelt…");
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "LyricsVideo",
      inputProps,
      browserExecutable,
    });
    log(`Composition: ${composition.width}x${composition.height}, ${composition.durationInFrames} Frames`);

    const cpus = os.cpus().length;
    const totalMemMb = os.totalmem() / 1024 / 1024;
    const cpuCap = isDraft ? cpus : Math.max(2, cpus - 2);
    const hardCap = isDraft ? 10 : 6;
    // Full 1080p Chrome workers in practice peak around 2.8 GB each under
    // Remotion; the previous 2 GB estimate yielded concurrency=7 on the 24 GB
    // M4 Pro and the render-metrics hint consistently flagged "RAM 99%".
    const memPerWorkerMb = isDraft ? 800 : 2800;
    const memoryCap = Math.max(2, Math.floor((totalMemMb * 0.6) / memPerWorkerMb));
    const concurrency = Math.max(2, Math.min(cpuCap, hardCap, memoryCap));

    log(`Rendering startet: ${concurrency} parallele Worker, ${cpus} CPUs verfügbar`);
    log(`Codec: H.264, Bitrate: ${isDraft ? "4M" : "8M"}, Preset: ${isDraft ? "ultrafast" : "veryfast"}, HW-Accel: if-possible`);

    const renderStart = Date.now();
    let lastLoggedPercent = 0;
    let peakCpuPercent = 0;
    let peakMemMb = 0;
    let lastMetricsTime = 0;

    // Bridge AbortSignal to Remotion's cancel mechanism
    const { cancelSignal, cancel } = makeCancelSignal();
    if (signal) {
      if (signal.aborted) {
        cancel();
      } else {
        signal.addEventListener("abort", () => cancel(), { once: true });
      }
    }

    // Collect initial CPU sample (first call is always 0)
    await collectMetrics();

    await renderMedia({
      cancelSignal,
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      concurrency,
      browserExecutable,
      hardwareAcceleration: "if-possible",
      timeoutInMilliseconds: 300_000,
      videoBitrate: isDraft ? "4M" : "8M",
      x264Preset: isDraft ? "ultrafast" : "veryfast",
      jpegQuality: isDraft ? 50 : 80,
      imageFormat: "jpeg",
      // Draft: render every 2nd frame (duplicates in between) → ~2x faster
      everyNthFrame: isDraft ? 2 : 1,
      disallowParallelEncoding: false,
      // encodingBufferSize/encodingMaxRate intentionally omitted: they force
      // x264 software encoding and disable VideoToolbox HW acceleration on
      // Apple Silicon, which costs us ~5x render speed on the M4 Pro.
      chromiumOptions: {
        gl: "angle",
      },
      onProgress: ({ progress }) => {
        onProgress?.({ phase: "rendering", progress });
        const now = Date.now();
        const elapsed = (now - renderStart) / 1000;
        const percent = Math.round(progress * 100);
        const framesRendered = Math.round(progress * renderFrameCount);
        const fps = elapsed > 0 ? framesRendered / elapsed : 0;
        const eta = progress > 0 ? (elapsed / progress) * (1 - progress) : 0;

        if (percent >= lastLoggedPercent + 10) {
          log(`Frame-Rendering: ${percent}% (${elapsed.toFixed(0)}s vergangen, ~${eta.toFixed(0)}s verbleibend)`);
          lastLoggedPercent = percent;
        }

        // Send metrics every 2 seconds
        if (now - lastMetricsTime >= 2000) {
          lastMetricsTime = now;
          collectMetrics()
            .then((cpu) => {
              if (cpu.cpuPercent > peakCpuPercent) peakCpuPercent = cpu.cpuPercent;
              if (cpu.memUsedMb > peakMemMb) peakMemMb = cpu.memUsedMb;
              try {
                onMetrics?.({
                  fps: Math.round(fps * 10) / 10,
                  framesRendered,
                  totalFrames: renderFrameCount,
                  elapsedSec: Math.round(elapsed),
                  etaSec: Math.round(eta),
                  cpu,
                });
              } catch {
                // Stream may be closed (client disconnected) — swallow
              }
            })
            .catch(() => {
              // collectMetrics may fail under load — never crash the render
            });
        }
      },
    });

    const totalTimeSec = (Date.now() - renderStart) / 1000;
    const avgFps = renderFrameCount / totalTimeSec;

    log(`Rendering abgeschlossen in ${totalTimeSec.toFixed(1)}s`);
    console.log(`[render] ${renderFrameCount} frames in ${totalTimeSec.toFixed(1)}s (${avgFps.toFixed(1)} fps), concurrency=${concurrency}`);

    const outputStat = await stat(outputPath);
    const fileSizeMb = outputStat.size / 1024 / 1024;
    log(`Video: ${fileSizeMb.toFixed(1)} MB`);

    // Collect final metrics for summary
    const finalMetrics = await collectMetrics();
    if (finalMetrics.memUsedMb > peakMemMb) peakMemMb = finalMetrics.memUsedMb;

    const summary: RenderSummary = {
      totalFrames: renderFrameCount,
      totalTimeSec: Math.round(totalTimeSec),
      avgFps: Math.round(avgFps * 10) / 10,
      concurrency,
      cpuCount: cpus,
      peakCpuPercent,
      peakMemMb,
      memTotalMb: finalMetrics.memTotalMb,
      resolution: `${renderWidth}x${renderHeight}`,
      quality: isDraft ? "Draft" : "Full",
      hints: [],
    };
    summary.hints = generateHints(summary);
    onSummary?.(summary);

    // Log hints to server console
    for (const hint of summary.hints) {
      console.log(`[render:hint] ${hint}`);
    }

    return outputPath;
  } finally {
    if (bundleAssetDir) {
      await rm(bundleAssetDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
