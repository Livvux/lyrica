import type { VideoConfig } from "../types/lyrics";

export const ASPECT_RATIOS = {
  "16:9": { width: 1920, height: 1080, label: "YouTube" },
  "9:16": { width: 1080, height: 1920, label: "Reels · TikTok · Shorts" },
  "1:1": { width: 1080, height: 1080, label: "Square" },
  "4:5": { width: 1080, height: 1350, label: "Portrait" },
} as const;

export type AspectRatio = keyof typeof ASPECT_RATIOS;

export function dimensionsForAspectRatio(ratio: AspectRatio) {
  const { width, height } = ASPECT_RATIOS[ratio];
  return { width, height };
}

/** Endpoints stay on the source timeline, so lyrics, audio and effects share one clock. */
export function getRenderPlan(
  config: Pick<VideoConfig, "width" | "height" | "fps" | "durationInFrames" | "clipStartFrame" | "clipEndFrame">,
  renderFps: number,
  requestedScale = 1,
) {
  const start = config.clipStartFrame ?? 0;
  const end = config.clipEndFrame ?? config.durationInFrames;
  if (![config.width, config.height, config.fps, config.durationInFrames, renderFps, start, end].every(Number.isInteger)
    || config.width < 2 || config.height < 2 || config.width % 2 !== 0 || config.height % 2 !== 0
    || !Number.isFinite(requestedScale) || requestedScale <= 0
    || config.fps <= 0 || renderFps <= 0 || config.durationInFrames <= 0 || start < 0 || end <= start || end > config.durationInFrames) {
    throw new Error("Ungültiger Exportbereich.");
  }
  const durationInFrames = Math.ceil(config.durationInFrames * renderFps / config.fps);
  const firstFrame = Math.min(durationInFrames - 1, Math.round(start * renderFps / config.fps));
  const endExclusive = end === config.durationInFrames ? durationInFrames : Math.min(durationInFrames, Math.round(end * renderFps / config.fps));
  const frameRange: [number, number] = [firstFrame, Math.max(firstFrame, endExclusive - 1)];
  // H.264 requires even dimensions. Legacy custom sizes keep native resolution when
  // a draft scale would produce odd pixels; all four standard formats scale exactly.
  const canScale = [config.width * requestedScale, config.height * requestedScale].every((value) => Number.isInteger(value) && value % 2 === 0);
  const scale = canScale ? requestedScale : 1;
  return {
    width: config.width,
    height: config.height,
    outputWidth: config.width * scale,
    outputHeight: config.height * scale,
    scale,
    durationInFrames,
    frameRange,
    exportedFrameCount: frameRange[1] - frameRange[0] + 1,
  };
}
