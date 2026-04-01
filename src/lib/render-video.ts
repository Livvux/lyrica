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

async function getOrCreateBundle(
  onProgress?: (p: RenderProgress) => void
): Promise<string> {
  if (cachedBundleLocation) {
    onProgress?.({ phase: "bundling", progress: 1 });
    return cachedBundleLocation;
  }

  const entryPoint = path.join(process.cwd(), "src/remotion/index.ts");

  const location = await bundle({
    entryPoint,
    onProgress: (p) => onProgress?.({ phase: "bundling", progress: p / 100 }),
    webpackOverride: (currentConfig) => ({
      ...currentConfig,
      resolve: {
        ...currentConfig.resolve,
        alias: {
          ...(currentConfig.resolve?.alias ?? {}),
          "@": path.join(process.cwd(), "src"),
        },
      },
    }),
  });

  cachedBundleLocation = location;
  return location;
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
    audioUrl: audioFilename,
    style: { ...config.style, bgImage: bgImageForRender },
    width: renderWidth,
    height: renderHeight,
    fps: renderFps,
    durationInFrames: renderFrameCount,
  };

  try {
    const bundleLocation = await getOrCreateBundle(onProgress);

    // Dateien ins Bundle-Verzeichnis kopieren, damit Chromium sie während des Renderings laden kann.
    // Die public/-Kopie reicht nicht: der Bundle-Cache wurde vor dem Upload erstellt.
    await copyFile(
      path.join(tmpDir, audioFilename),
      path.join(bundleLocation, audioFilename)
    );
    if (config.style.bgImage.includes("/api/audio/")) {
      const bgFilename = config.style.bgImage.split("/").pop()!;
      const bgDest = path.join(publicDir, bgFilename); // bereits resized
      await copyFile(bgDest, path.join(bundleLocation, bgFilename)).catch(() => {});
    }

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
    const concurrency = isDraft
      ? Math.min(2, cpus)
      : Math.min(Math.max(1, cpus - 1), 4);

    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      concurrency,
      browserExecutable,
      hardwareAcceleration: "disable",
      videoBitrate: isDraft ? "4M" : "8M",
      x264Preset: isDraft ? "ultrafast" : "faster",
      jpegQuality: isDraft ? 60 : 70,
      imageFormat: "jpeg",
      chromiumOptions: {
        gl: "swiftshader",
        enableMultiProcessOnLinux: false,
      },
      onProgress: ({ progress }) =>
        onProgress?.({ phase: "rendering", progress }),
    });

    return outputPath;
  } finally {
    await Promise.all(tmpFilesToClean.map((f) => unlink(f).catch(() => {})));
  }
}
