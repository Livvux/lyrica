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

export async function renderVideo(
  config: VideoConfig,
  outputPath: string,
  onProgress?: (p: RenderProgress) => void
): Promise<string> {
  const publicDir = path.join(process.cwd(), "public");
  const tmpDir = path.join(process.cwd(), "tmp", "lyrica");

  const isDraft = config.renderQuality === "draft";
  const renderWidth = isDraft ? 1280 : 1920;
  const renderHeight = isDraft ? 720 : 1080;
  const renderFps = isDraft ? 24 : 30;

  // Recalculate frame count for the target fps
  const durationSec = config.durationInFrames / config.fps;
  const renderFrameCount = Math.ceil(durationSec * renderFps);

  // Copy tmp assets into public/ so Remotion can serve them alongside other static assets
  const tmpFilesToClean: string[] = [];

  const audioFilename = config.audioUrl.split("/").pop()!;
  await copyFile(path.join(tmpDir, audioFilename), path.join(publicDir, audioFilename));
  tmpFilesToClean.push(path.join(publicDir, audioFilename));

  // Handle background image: resize to render dimensions if needed
  let bgImageForRender = config.style.bgImage;
  if (config.style.bgImage.includes("/api/audio/")) {
    const bgFilename = config.style.bgImage.split("/").pop()!;
    const bgSrc = path.join(tmpDir, bgFilename);
    const bgDest = path.join(publicDir, bgFilename);
    await resizeBgIfNeeded(bgSrc, bgDest, renderWidth, renderHeight);
    tmpFilesToClean.push(bgDest);
    bgImageForRender = `/${bgFilename}`;
  }

  const renderConfig: VideoConfig = {
    ...config,
    // Absolute URL → Chrome kann die Datei sicher vom laufenden Next.js-Server laden
    audioUrl: `http://localhost:3000/api/audio/${audioFilename}`,
    style: { ...config.style, bgImage: bgImageForRender },
    width: renderWidth,
    height: renderHeight,
    fps: renderFps,
    durationInFrames: renderFrameCount,
  };

  try {
    const bundleLocation = await getOrCreateBundle(onProgress);

    const inputProps = renderConfig as unknown as Record<string, unknown>;

    // Auf Linux (Docker) Chrome-Wrapper mit --no-sandbox verwenden
    const browserExecutable = process.env.CHROME_EXECUTABLE ?? null;

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "LyricsVideo",
      inputProps,
      browserExecutable,
    });

    const cpus = os.cpus().length;
    // Use more available cores: server has 10 CPUs allocated
    const concurrency = isDraft
      ? Math.min(4, cpus)
      : Math.min(Math.max(2, cpus - 2), 8);

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      concurrency,
      browserExecutable,
      hardwareAcceleration: "disable",
      // 5 Minuten Timeout pro Frame — nötig für große Audiodateien (getAudioData)
      timeoutInMilliseconds: 300_000,
      videoBitrate: isDraft ? "4M" : "8M",
      x264Preset: isDraft ? "ultrafast" : "veryfast",
      jpegQuality: isDraft ? 60 : 80,
      imageFormat: "jpeg",
      chromiumOptions: {
        gl: "swiftshader",
        enableMultiProcessOnLinux: true,
      },
      onProgress: ({ progress }) =>
        onProgress?.({ phase: "rendering", progress }),
    });

    return outputPath;
  } finally {
    await Promise.all(tmpFilesToClean.map((f) => unlink(f).catch(() => {})));
  }
}
