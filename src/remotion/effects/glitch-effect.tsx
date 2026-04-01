import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import type { EffectIntensity } from "@/types/lyrics";

interface GlitchEffectProps {
  intensity: EffectIntensity;
  bassEnergy: number;
}

function deterministicRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const GlitchEffect: React.FC<GlitchEffectProps> = ({ intensity, bassEnergy }) => {
  const frame = useCurrentFrame();
  const maxShift = intensity === "strong" ? 20 : 8;
  const shift = maxShift * (0.3 + bassEnergy * 0.7);

  const flickerOpacity = interpolate(frame % 7, [0, 1, 2, 3], [1, 0.88, 1, 0.92], {
    extrapolateRight: "clamp",
  });

  const slices = [
    { top: 10, bottom: 75, seed: 1 },
    { top: 35, bottom: 50, seed: 2 },
    { top: 60, bottom: 15, seed: 3 },
    { top: 80, bottom: 5, seed: 4 },
  ];

  // Only glitch on some frames for a realistic effect
  const glitchActive = deterministicRandom(frame * 7.1) > 0.6;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: flickerOpacity }}>
      {glitchActive &&
        slices.map((slice, i) => {
          const offsetX = (deterministicRandom(frame * (i + 1) * 3.7) - 0.5) * 2 * shift;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                inset: 0,
                clipPath: `inset(${slice.top}% 0 ${slice.bottom}% 0)`,
                transform: `translateX(${offsetX}px)`,
              }}
            >
              {/* Red channel offset */}
              <AbsoluteFill
                style={{
                  backgroundColor: "rgba(255, 0, 0, 0.08)",
                  mixBlendMode: "screen",
                  transform: `translateX(${offsetX * 0.3}px)`,
                }}
              />
              {/* Cyan channel offset */}
              <AbsoluteFill
                style={{
                  backgroundColor: "rgba(0, 255, 255, 0.05)",
                  mixBlendMode: "screen",
                  transform: `translateX(${-offsetX * 0.3}px)`,
                }}
              />
            </div>
          );
        })}
    </AbsoluteFill>
  );
};
