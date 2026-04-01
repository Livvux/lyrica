import path from "path";
import os from "os";
import { copyFile, unlink, stat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { VideoConfig } from "@/types/lyrics";

const execFileAsync = promisify(execFile);

export type RenderProgress = {
  phase: "bundling" | "rendering" | "done";
  progress: number; // 0-1
};

// Cache the bundle location across renders — only changes when code changes (dev restart)
let cachedBundleLocation: string | null = null;
let bundlePromise: Promise<string> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const webpackOverride = (currentConfig: any) => ({
  ...currentConfig,
  resolve: {
    ...currentConfig.resolve,
    alias: {
      ...(currentConfig.resolve?.alias ?? {}),
      "@": path.join(process.cwd(), "src"),
    },
  },
});

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
  });

  const location = await bundlePromise;
  cachedBundleLocation = location;
  bundlePromise = null;
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

  try {
    await execFileAsync("ffmpeg", [
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
};

export async function renderVideo(
  config: VideoConfig,
  outputPath: string,
  callbacks?: RenderCallbacks
): Promise<string> {
  const { onProgress, onLog } = callbacks ?? {};
  const log = (msg: string) => onLog?.(msg);
  const publicDir = path.join(process.cwd(), "public");
  const tmpDir = path.join(process.cwd(), "tmp", "lyrica");

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

  const tmpFilesToClean: string[] = [];
  const audioFilename = config.audioUrl.split("/").pop()!;

  // Handle background image: resize to render dimensions if needed
  let bgImageForRender = config.style.bgImage;
  if (config.style.bgImage.includes("/api/audio/")) {
    const bgFilename = config.style.bgImage.split("/").pop()!;
    const bgSrc = path.join(tmpDir, bgFilename);
    const bgDest = path.join(publicDir, bgFilename);
    log(`Hintergrundbild wird auf ${renderWidth}x${renderHeight} skaliert…`);
    await resizeBgIfNeeded(bgSrc, bgDest, renderWidth, renderHeight);
    tmpFilesToClean.push(bgDest);
    bgImageForRender = `/${bgFilename}`;
  }

  const renderConfig: VideoConfig = {
    ...config,
    audioUrl: audioFilename,
    style: { ...config.style, bgImage: bgImageForRender },
    width: renderWidth,
    height: renderHeight,
    fps: renderFps,
    durationInFrames: renderFrameCount,
  };

  try {
    log("Remotion-Bundle wird geladen…");
    const bundleStart = Date.now();
    const bundleLocation = await getOrCreateBundle(onProgress);
    log(`Bundle bereit (${((Date.now() - bundleStart) / 1000).toFixed(1)}s)`);

    // Copy audio + bg into bundle dir so Remotion serves them same-origin (no CORS)
    log("Audio wird ins Bundle kopiert…");
    const audioSrc = path.join(tmpDir, audioFilename);
    const audioDest = path.join(bundleLocation, audioFilename);
    await copyFile(audioSrc, audioDest);
    tmpFilesToClean.push(audioDest);

    if (bgImageForRender.startsWith("/")) {
      const bgFilename = bgImageForRender.slice(1);
      const bgSrc = path.join(publicDir, bgFilename);
      const bgDest = path.join(bundleLocation, bgFilename);
      await copyFile(bgSrc, bgDest);
      tmpFilesToClean.push(bgDest);
      log("Hintergrundbild ins Bundle kopiert");
    }

    renderConfig.audioUrl = `/${audioFilename}`;

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
    // Thread model at 720p uses ~250MB/tab, 1080p ~500MB/tab.
    // Container: 32GB RAM, 10 CPU cores → concurrency limited by CPU, not RAM.
    const concurrency = isDraft
      ? Math.min(cpus, 10)
      : Math.min(Math.max(2, cpus - 1), 10);

    log(`Rendering startet: ${concurrency} parallele Worker, ${cpus} CPUs verfügbar`);
    log(`Codec: H.264, Bitrate: ${isDraft ? "4M" : "8M"}, Preset: ${isDraft ? "ultrafast" : "veryfast"}`);

    const renderStart = Date.now();
    let lastLoggedPercent = 0;

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      concurrency,
      browserExecutable,
      hardwareAcceleration: "disable",
      timeoutInMilliseconds: 300_000,
      videoBitrate: isDraft ? "4M" : "8M",
      x264Preset: isDraft ? "ultrafast" : "veryfast",
      jpegQuality: isDraft ? 60 : 80,
      imageFormat: "jpeg",
      chromiumOptions: {
        gl: "swangle",
        enableMultiProcessOnLinux: true,
      },
      onProgress: ({ progress }) => {
        onProgress?.({ phase: "rendering", progress });
        const percent = Math.round(progress * 100);
        if (percent >= lastLoggedPercent + 10) {
          const elapsed = (Date.now() - renderStart) / 1000;
          const eta = progress > 0 ? (elapsed / progress) * (1 - progress) : 0;
          log(`Frame-Rendering: ${percent}% (${elapsed.toFixed(0)}s vergangen, ~${eta.toFixed(0)}s verbleibend)`);
          lastLoggedPercent = percent;
        }
      },
    });

    const totalTime = ((Date.now() - renderStart) / 1000).toFixed(1);
    log(`Rendering abgeschlossen in ${totalTime}s`);
    console.log(`[render] ${renderFrameCount} frames in ${totalTime}s (${(renderFrameCount / parseFloat(totalTime)).toFixed(1)} fps), concurrency=${concurrency}`);

    const outputStat = await stat(outputPath);
    log(`Video: ${(outputStat.size / 1024 / 1024).toFixed(1)} MB`);

    return outputPath;
  } finally {
    await Promise.all(tmpFilesToClean.map((f) => unlink(f).catch(() => {})));
  }
}
