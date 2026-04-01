import type { EffectIntensity } from "@/types/lyrics";

interface CameraShakeResult {
  x: number;
  y: number;
}

export function useCameraShake(
  frame: number,
  bassEnergy: number,
  intensity: EffectIntensity,
): CameraShakeResult {
  if (intensity === "off") return { x: 0, y: 0 };

  const amplitude = intensity === "strong" ? 8 : 3;
  const energy = 0.3 + bassEnergy * 0.7;
  const x = Math.sin(frame * 7.3) * amplitude * energy;
  const y = Math.cos(frame * 5.1) * amplitude * energy;

  return { x, y };
}
