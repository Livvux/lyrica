import { AbsoluteFill } from "remotion";
import type { EffectIntensity } from "@/types/lyrics";

interface ChromaticAberrationEffectProps {
  intensity: EffectIntensity;
  bassEnergy: number;
}

export const ChromaticAberrationEffect: React.FC<ChromaticAberrationEffectProps> = ({
  intensity,
  bassEnergy,
}) => {
  const baseOffset = intensity === "strong" ? 4 : 2;
  const offset = baseOffset + bassEnergy * 3;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          backgroundColor: "rgba(255, 0, 0, 0.06)",
          mixBlendMode: "screen",
          transform: `translateX(${offset}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundColor: "rgba(0, 0, 255, 0.06)",
          mixBlendMode: "screen",
          transform: `translateX(${-offset}px)`,
        }}
      />
    </AbsoluteFill>
  );
};
