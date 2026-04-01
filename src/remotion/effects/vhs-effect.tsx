import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { EffectIntensity } from "@/types/lyrics";

interface VhsEffectProps {
  intensity: EffectIntensity;
}

export const VhsEffect: React.FC<VhsEffectProps> = ({ intensity }) => {
  const frame = useCurrentFrame();
  const noiseOpacity = intensity === "strong" ? 0.12 : 0.06;
  const scanlineOpacity = intensity === "strong" ? 0.2 : 0.1;
  const trackingY = (frame * 3) % 1080;
  const filterId = `vhs-noise-${frame}`;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* SVG noise */}
      <svg width="0" height="0">
        <defs>
          <filter id={filterId}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves={4}
              seed={frame}
              result="noise"
            />
            <feColorMatrix type="saturate" values="0" in="noise" result="mono" />
          </filter>
        </defs>
      </svg>
      <AbsoluteFill
        style={{
          filter: `url(#${filterId})`,
          opacity: noiseOpacity,
          mixBlendMode: "overlay",
        }}
      />

      {/* Scanlines */}
      <AbsoluteFill
        style={{
          background: `repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(0,0,0,${scanlineOpacity}) 2px, rgba(0,0,0,${scanlineOpacity}) 4px)`,
        }}
      />

      {/* Tracking line */}
      <div
        style={{
          position: "absolute",
          top: trackingY,
          left: 0,
          right: 0,
          height: 4,
          background: "rgba(255,255,255,0.06)",
        }}
      />

      {/* Color bleed */}
      <AbsoluteFill
        style={{
          backgroundColor: "rgba(255, 0, 0, 0.03)",
          mixBlendMode: "screen",
          transform: "translateX(2px)",
        }}
      />
    </AbsoluteFill>
  );
};
