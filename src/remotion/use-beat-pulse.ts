import { useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import type { EffectIntensity } from "@/types/lyrics";
import { envelopeAt, transientPulse, SPECTRUM_BANDS } from "../lib/audio-analysis";
import type { AudioAnalysis } from "../lib/audio-analysis";

export interface BeatPulse {
  scale: number;
  glowOpacity: number;
  bgBrightness: number;
  bgScale: number;
  bassEnergy: number;
  frequencyData: number[];
}

const INTENSITY_MULTIPLIER: Record<EffectIntensity, number> = {
  off: 0,
  subtle: 0.5,
  strong: 2,
};

const EMPTY_FREQUENCY: number[] = Array.from({ length: 64 }, () => 0);

export const IDLE_BEAT: BeatPulse = { scale: 1, glowOpacity: 0, bgBrightness: 1, bgScale: 1, bassEnergy: 0, frequencyData: EMPTY_FREQUENCY };

/** Source time is shared with lyric/word timing, including frameRange clip exports. */
export function analyzedBeat(
  analysis: AudioAnalysis,
  time: number,
  intensity: EffectIntensity,
  enabled: boolean,
  visualize = false,
  sensitivity = 1,
  manualBeats?: number[],
): BeatPulse {
  if (!visualize && (!enabled || intensity === "off")) return IDLE_BEAT;
  const gain = Math.max(0.25, Math.min(3, sensitivity));
  const low = envelopeAt(analysis.low, time, analysis.envelopeRate);
  const mid = envelopeAt(analysis.mid, time, analysis.envelopeRate);
  const high = envelopeAt(analysis.high, time, analysis.envelopeRate);
  const pulse = transientPulse(manualBeats ?? (analysis.beats.length ? analysis.beats : analysis.onsets), time);
  // A transient attack with natural release drives motion; sustained volume only adds body.
  const energy = Math.min(1, (pulse * 0.7 + low * 0.2 + mid * 0.07 + high * 0.03) * gain);
  const multiplier = enabled ? INTENSITY_MULTIPLIER[intensity] : 0;
  const position = Math.max(0, time * analysis.envelopeRate);
  const frame = Math.floor(position);
  const fraction = position - frame;
  const frequencyData = visualize ? Array.from({ length: 64 }, (_, bin) => {
    const bandPosition = bin / 63 * (SPECTRUM_BANDS - 1);
    const a = Math.floor(bandPosition);
    const b = Math.min(SPECTRUM_BANDS - 1, a + 1);
    const blend = bandPosition - a;
    const at = (index: number, band: number) => analysis.spectrum[index * SPECTRUM_BANDS + band] ?? 0;
    const first = at(frame, a) * (1 - blend) + at(frame, b) * blend;
    const second = at(frame + 1, a) * (1 - blend) + at(frame + 1, b) * blend;
    return Math.min(1, (first * (1 - fraction) + second * fraction) * gain);
  }) : EMPTY_FREQUENCY;
  return {
    scale: 1 + energy * 0.05 * multiplier,
    glowOpacity: Math.min(1, energy * 0.6 * multiplier),
    bgBrightness: 1 + energy * 0.08 * multiplier,
    bgScale: 1 + energy * 0.03 * multiplier,
    bassEnergy: energy * multiplier,
    frequencyData,
  };
}

export function useBeatPulse(
  audioUrl: string,
  intensity: EffectIntensity,
  enabled: boolean,
  visualize = false,
): BeatPulse {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(audioUrl);

  if (!audioData || (!visualize && (!enabled || intensity === "off"))) {
    return IDLE_BEAT;
  }

  const visualization = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: 64,
    // Smoothing runs three FFTs per frame; the fast FFT keeps that cheap in preview and every render tab.
    optimizeFor: "speed",
  });

  // Average low-frequency bands (bass energy)
  const bassEnergy =
    (visualization[0] + visualization[1] + visualization[2] + visualization[3]) / 4;

  const m = enabled ? INTENSITY_MULTIPLIER[intensity] : 0;

  return {
    scale: 1 + bassEnergy * 0.05 * m,
    glowOpacity: bassEnergy * 0.6 * m,
    bgBrightness: 1 + bassEnergy * 0.08 * m,
    bgScale: 1 + bassEnergy * 0.03 * m,
    bassEnergy: bassEnergy * m,
    frequencyData: visualization,
  };
}
