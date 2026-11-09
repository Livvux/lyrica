import path from "path";
import { existsSync } from "fs";
import { copyFile, mkdir, rm } from "fs/promises";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { bundle } from "@remotion/bundler";
import type { WebpackConfiguration } from "@remotion/bundler";
import { renderMedia, selectComposition, makeCancelSignal } from "@remotion/renderer";
import { availableRenderCpus, chooseRenderConcurrency, memoryMb } from "./render-resources";
import { getRenderPlan } from "./video-format";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import type { RenderQuality, VideoConfig } from "@/types/lyrics";

const execFileAsync = promisify(execFile);

// One active render per process prevents memory overcommit across requests.
let renderInProgress = false;

export type RenderProgress = {
  phase: "bundling" | "rendering";
  progress: number; // 0-1
};

// Bundle once per process; only changes when code changes (dev restart).
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

function resolveBrowserExecutable(): string | undefined {
  const configured = process.env.CHROME_EXECUTABLE?.trim();
  if (configured) {
    // Brave renders far slower than Chrome; ignore it.
    if (!configured.toLowerCase().includes("brave") && existsSync(configured)) return configured;
    console.warn(`[render] CHROME_EXECUTABLE ignoriert: ${configured}`);
  }
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  // undefined lets Remotion download its own headless shell.
  return candidates.find((candidate) => existsSync(candidate));
}

function toSafeAssetName(raw: string): string | null {
  const safe = sanitizeFilename(raw);
  if (!safe || safe === "." || safe === "..") return null;
  if (safe.includes("/") || safe.includes("\\")) return null;
  return safe;
}

function getOrCreateBundle(onProgress?: (p: RenderProgress) => void): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: path.join(process.cwd(), "src/remotion/index.ts"),
    // Desktop dependencies live in the signed, read-only app bundle.
    enableCaching: !process.env.LYRICA_RESOURCES,
    onProgress: (p) => onProgress?.({ phase: "bundling", progress: p / 100 }),
    webpackOverride,
  }).catch((err) => {
    bundlePromise = null;
    throw err;
  });
  return bundlePromise;
}

/**
 * Normalize background image to exact render resolution once before rendering.
 * This avoids expensive per-frame resizing during composition render.
 */
async function resizeBgIfNeeded(
  srcPath: string,
  destPath: string,
  targetWidth: number,
  targetHeight: number
): Promise<void> {
  // Resolve ffmpeg: prefer Homebrew arm64 path on macOS, fall back to PATH
  const ffmpegBin = process.env.FFMPEG_PATH || (
    process.platform === "darwin" && existsSync("/opt/homebrew/bin/ffmpeg")
      ? "/opt/homebrew/bin/ffmpeg"
      : "ffmpeg");

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
  signal?: AbortSignal;
};

interface ProfileSettings {
  scale: number;
  fps: number;
  videoBitrate: string;
  jpegQuality: number;
  hardCap: number;
  memPerWorkerMb: number;
}

const PROFILES: Record<RenderQuality, ProfileSettings> = {
  fast: {
    scale: 2 / 3,
    fps: 24,
    videoBitrate: "5M",
    jpegQuality: 60,
    hardCap: 14,
    // Observed real usage under concurrency 12 is ~1.5GB/worker, not 800MB —
    // the old budget under-estimated memory and pushed macOS into memory
    // pressure, crashing Chrome renderer processes mid-render.
    memPerWorkerMb: 1500,
  },
  balanced: {
    scale: 1,
    fps: 30,
    videoBitrate: "10M",
    jpegQuality: 80,
    hardCap: 10,
    memPerWorkerMb: 2000,
  },
  quality: {
    scale: 1,
    fps: 30,
    videoBitrate: "18M",
    jpegQuality: 95,
    hardCap: 8,
    memPerWorkerMb: 3000,
  },
};

export async function renderVideo(
  config: VideoConfig,
  outputPath: string,
  callbacks?: RenderCallbacks
): Promise<string> {
  const { onProgress, signal } = callbacks ?? {};
  const publicDir = path.join(process.cwd(), "public");
  const tmpDir = path.join(process.cwd(), "tmp", "lyrica");
  let bundleAssetDir: string | null = null;
  let completed = false;
  let cancelRender: (() => void) | undefined;

  const profile = PROFILES[config.renderQuality ?? "balanced"];
  const renderFps = profile.fps;
  const plan = getRenderPlan(config, renderFps, profile.scale);

  const durationSec = config.durationInFrames / config.fps;
  const renderFrameCount = plan.durationInFrames;


  const audioFilename = toSafeAssetName(config.audioUrl.split("/").pop() ?? "");
  if (!audioFilename) throw new Error("Ungültige audioUrl: Dateiname konnte nicht extrahiert werden");

  if (renderInProgress) throw new Error("Ein Export läuft bereits. Bitte warte, bis er abgeschlossen ist.");
  renderInProgress = true;
  try {
    if (signal?.aborted) throw new Error("Render abgebrochen.");

    const bundleLocation = await getOrCreateBundle(onProgress);
    signal?.throwIfAborted();
    onProgress?.({ phase: "bundling", progress: 1 });

    // Assets must live under public/ — the render page resolves asset URLs
    // relative to the bundle's public dir (/public/...). Dot-dirs at bundle
    // root 404 and Remotion's <Img>/<Audio> retry forever => render hangs.
    const assetDirName = `public/lyrica-assets/${randomUUID()}`;
    bundleAssetDir = path.join(bundleLocation, assetDirName);
    await mkdir(bundleAssetDir, { recursive: true });

    const audioSrc = path.join(tmpDir, audioFilename);
    const audioDest = path.join(bundleAssetDir, audioFilename);
    await copyFile(audioSrc, audioDest);
    const audioAssetPath = `/${assetDirName}/${audioFilename}`;

    let bgImageForRender = config.style.bgImage;
    const rawBgName = config.style.bgImage
      .replace(/^\/api\/audio\//, "")
      .replace(/^\//, "");
    const bgImageBasename = toSafeAssetName(rawBgName);

    if (rawBgName && !bgImageBasename) {
      throw new Error("Ungültiger Hintergrund-Dateiname.");
    }

    if (bgImageBasename) {
      const bgSrc = [path.join(tmpDir, bgImageBasename), path.join(publicDir, bgImageBasename)].find((p) => existsSync(p));
      if (bgSrc) {
        const bgDest = path.join(bundleAssetDir, bgImageBasename);
        if (config.style.bgType === "video") await copyFile(bgSrc, bgDest);
        else await resizeBgIfNeeded(bgSrc, bgDest, plan.outputWidth, plan.outputHeight);
        bgImageForRender = `/${assetDirName}/${bgImageBasename}`;
      } else {
        console.warn(`[render] Hintergrund nicht gefunden: ${bgImageBasename}`);
        bgImageForRender = `/${bgImageBasename}`;
      }
    }

    // Custom logo: lokal in den Bundle-Asset-Ordner kopieren
    let logoForRender = config.style.customLogo;
    if (logoForRender?.startsWith("/api/audio/")) {
      const logoFilename = toSafeAssetName(logoForRender.replace("/api/audio/", ""));
      const logoSrc = logoFilename && path.join(tmpDir, logoFilename);
      if (logoSrc && existsSync(logoSrc)) {
        await copyFile(logoSrc, path.join(bundleAssetDir, logoFilename));
        logoForRender = `/${assetDirName}/${logoFilename}`;
      } else {
        console.warn(`[render] Logo nicht gefunden: ${logoFilename}`);
      }
    }

    const renderConfig: VideoConfig = {
      ...config,
      previewQuality: undefined,
      // Rescale preview frames (not seconds) so fade padding and overlap clamping survive.
      lines: config.lines.map((line) => ({
        ...line,
        startFrame: Math.round((line.startFrame * renderFps) / config.fps),
        endFrame: Math.round((line.endFrame * renderFps) / config.fps),
      })),
      audioUrl: audioAssetPath,
      style: { ...config.style, bgImage: bgImageForRender, customLogo: logoForRender },
      width: plan.width,
      height: plan.height,
      clipStartFrame: undefined,
      clipEndFrame: undefined,
      fps: renderFps,
      durationInFrames: renderFrameCount,
    };

    const inputProps = renderConfig as unknown as Record<string, unknown>;
    const browserExecutable = resolveBrowserExecutable();

    signal?.throwIfAborted();
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: "LyricsVideo",
      inputProps,
      browserExecutable,
    });

    const cpus = await availableRenderCpus();
    const { totalMb, usedMb } = await memoryMb();
    const { concurrency } = chooseRenderConcurrency({
      cpus, totalMb, availableMb: Math.max(0, totalMb - usedMb),
      workerMb: profile.memPerWorkerMb, durationSec, hardCap: profile.hardCap,
      override: process.env.RENDER_CONCURRENCY,
    });
    const renderStart = Date.now();

    // Bridge AbortSignal to Remotion's cancel mechanism
    const { cancelSignal, cancel } = makeCancelSignal();
    cancelRender = cancel;
    if (signal) {
      if (signal.aborted) {
        cancel();
      } else {
        signal.addEventListener("abort", cancel, { once: true });
      }
    }

    await renderMedia({
      cancelSignal,
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
      concurrency,
      scale: plan.scale,
      frameRange: plan.frameRange,
      browserExecutable,
      hardwareAcceleration: "if-possible",
      timeoutInMilliseconds: 300_000,
      videoBitrate: profile.videoBitrate,
      x264Preset: "ultrafast",
      jpegQuality: profile.jpegQuality,
      imageFormat: "jpeg",
      // encodingBufferSize/encodingMaxRate intentionally omitted: they force
      // x264 software encoding and disable VideoToolbox HW acceleration on
      // Apple Silicon, which costs us ~5x render speed on the M4 Pro.
      chromiumOptions: {
        gl: process.platform === "darwin" ? "angle" : undefined,
      },
      onProgress: ({ progress }) => onProgress?.({ phase: "rendering", progress }),
    });

    const totalTimeSec = (Date.now() - renderStart) / 1000;
    console.log(`[render] ${plan.exportedFrameCount} frames in ${totalTimeSec.toFixed(1)}s (${(plan.exportedFrameCount / totalTimeSec).toFixed(1)} fps), concurrency=${concurrency}`);
    completed = true;

    return outputPath;
  } finally {
    if (cancelRender) signal?.removeEventListener("abort", cancelRender);
    if (!completed) await rm(outputPath, { force: true }).catch(() => {});
    renderInProgress = false;
    if (bundleAssetDir) {
      await rm(bundleAssetDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
