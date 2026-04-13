import { useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import type { EffectIntensity } from "@/types/lyrics";

interface BeatPulse {
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

export function useBeatPulse(
  audioUrl: string,
  intensity: EffectIntensity,
  enabled: boolean
): BeatPulse {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(audioUrl);

  if (!enabled || intensity === "off" || !audioData) {
    return { scale: 1, glowOpacity: 0, bgBrightness: 1, bgScale: 1, bassEnergy: 0, frequencyData: EMPTY_FREQUENCY };
  }

  const visualization = visualizeAudio({
    fps,
    frame,
    audioData,
    numberOfSamples: 64,
  });

  // Average low-frequency bands (bass energy)
  const bassEnergy =
    (visualization[0] + visualization[1] + visualization[2] + visualization[3]) / 4;

  const m = INTENSITY_MULTIPLIER[intensity];

  return {
    scale: 1 + bassEnergy * 0.05 * m,
    glowOpacity: bassEnergy * 0.6 * m,
    bgBrightness: 1 + bassEnergy * 0.08 * m,
    bgScale: 1 + bassEnergy * 0.03 * m,
    bassEnergy: bassEnergy * m,
    frequencyData: visualization,
  };
}
