import type { LyricLine } from "../types/lyrics";

export type TimingEdit = "move" | "start" | "end";
export interface ClipRange { startFrame: number; endFrame: number }

export function snapFrame(frame: number, targets: readonly number[], threshold: number): number {
  const rounded = Math.round(frame);
  let nearest = rounded;
  let distance = Math.max(0, threshold);
  for (const target of targets) {
    const gap = Math.abs(target - rounded);
    if (gap <= distance) {
      nearest = Math.round(target);
      distance = gap;
    }
  }
  return nearest;
}

/** One frame is the minimum interval; neighbours keep their existing timing. */
export function editLineTiming(
  lines: LyricLine[], index: number, edit: TimingEdit, frame: number,
  totalFrames: number, fps: number,
): LyricLine[] {
  const line = lines[index];
  if (!line || !Number.isFinite(frame) || fps <= 0 || totalFrames < 1) return lines;
  const lower = Math.max(0, lines[index - 1]?.endFrame ?? 0);
  const upper = Math.min(totalFrames, lines[index + 1]?.startFrame ?? totalFrames);
  if (upper - lower < 1) return lines;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));
  let start = line.startFrame;
  let end = line.endFrame;
  if (edit === "move") {
    const length = Math.max(1, Math.min(end - start, upper - lower));
    start = clamp(frame, lower, upper - length);
    end = start + length;
  } else if (edit === "start") {
    end = clamp(end, lower + 1, upper);
    start = clamp(frame, lower, end - 1);
  } else {
    start = clamp(start, lower, upper - 1);
    end = clamp(frame, start + 1, upper);
  }
  if (start === line.startFrame && end === line.endFrame) return lines;
  const oldStart = line.startFrame / fps;
  const ratio = (end - start) / Math.max(1, line.endFrame - line.startFrame);
  const mapTime = (seconds: number) => Math.max(start / fps, Math.min(end / fps, start / fps + (seconds - oldStart) * ratio));
  const updated = {
    ...line,
    startFrame: start, endFrame: end,
    startSec: start / fps, endSec: end / fps,
    words: line.words?.map((word) => ({ ...word, startSec: mapTime(word.startSec), endSec: mapTime(word.endSec) })),
  };
  return lines.map((item, i) => i === index ? updated : item);
}

export function clampClip(clip: ClipRange, totalFrames: number): ClipRange {
  const total = Math.max(1, Math.round(totalFrames));
  const startFrame = Math.max(0, Math.min(total - 1, Math.round(clip.startFrame) || 0));
  const endFrame = Math.max(startFrame + 1, Math.min(total, Math.round(clip.endFrame) || total));
  return { startFrame, endFrame };
}

/** Peak aggregation retains transients while bounding SVG geometry for long songs. */
export function waveformPeaks(samples: readonly number[], maxBins = 1600): number[] {
  if (maxBins < 1 || samples.length === 0) return [];
  const bins = Math.min(samples.length, Math.floor(maxBins));
  return Array.from({ length: bins }, (_, bin) => {
    const first = Math.floor(bin * samples.length / bins);
    const last = Math.floor((bin + 1) * samples.length / bins);
    let peak = 0;
    for (let i = first; i < last; i++) {
      if (Number.isFinite(samples[i])) peak = Math.max(peak, Math.abs(samples[i]));
    }
    return Math.min(1, peak);
  });
}
