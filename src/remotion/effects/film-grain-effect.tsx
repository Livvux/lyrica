import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { EffectIntensity } from "@/types/lyrics";

interface FilmGrainEffectProps {
  intensity: EffectIntensity;
}

export const FilmGrainEffect: React.FC<FilmGrainEffectProps> = ({ intensity }) => {
  const frame = useCurrentFrame();
  const opacity = intensity === "strong" ? 0.18 : 0.09;
  const filterId = `film-grain-${frame}`;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width="0" height="0">
        <defs>
          <filter id={filterId}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.65"
              numOctaves={3}
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
          opacity,
          mixBlendMode: "overlay",
        }}
      />
    </AbsoluteFill>
  );
};
