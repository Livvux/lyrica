import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

// Mulberry32 — produces well-distributed floats in [0, 1)
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const PARTICLE_COUNT = 80;
const GRID_COLS = 10;
const GRID_ROWS = 8;

export const BeatParticles: React.FC<{ bassEnergy: number; isDraft?: boolean }> = ({
  bassEnergy,
  isDraft,
}) => {
  const frame = useCurrentFrame();
  const { height, fps } = useVideoConfig();
  const time = frame / fps;

  if (bassEnergy <= 0) return null;

  const count = isDraft ? 30 : PARTICLE_COUNT;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const r = (s: number) => seededRandom(i * 7 + s);

        // Distribute across grid cells with jitter for even coverage
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS) % GRID_ROWS;
        const cellW = 100 / GRID_COLS;
        const cellH = 100 / GRID_ROWS;
        const baseX = col * cellW + r(0) * cellW;
        const baseY = row * cellH + r(8) * cellH;
        const size = 1 + r(1) * 2.5; // 1-3.5px — small dots
        const driftSpeed = 0.15 + r(2) * 0.4; // slow upward drift
        const layer = r(3); // 0-1 depth layer for parallax
        const swayAmount = 8 + r(4) * 20; // horizontal sway amplitude
        const swaySpeed = 0.3 + r(5) * 0.6; // sway frequency
        const phaseOffset = r(6) * Math.PI * 2; // desync particles
        const twinkleSpeed = 1.5 + r(7) * 3; // twinkle frequency

        // Per-frame position — stagger start using grid row offset
        const cycleHeight = height + 40;
        const yOffset = baseY / 100;
        const yProgress = ((time * driftSpeed * 60 + yOffset * cycleHeight) % cycleHeight) / cycleHeight;
        const y = height * (1 - yProgress) - 20;

        // Horizontal sway — sin wave with per-particle phase
        const sway = Math.sin(time * swaySpeed + phaseOffset) * swayAmount;
        const x = baseX + sway / 10; // keep sway subtle in %

        // Twinkle — oscillating opacity
        const twinkle =
          0.3 + 0.7 * Math.abs(Math.sin(time * twinkleSpeed + phaseOffset));

        // Bass reactivity — deeper layers react more
        const bassBoost = 1 + bassEnergy * (0.5 + layer * 1.5);
        const baseOpacity = (0.15 + layer * 0.25) * twinkle;
        const opacity = Math.min(baseOpacity * bassBoost, 1);
        const scale = bassBoost;

        // Parallax — far particles are dimmer and slower (already via layer)
        const finalSize = size * (0.6 + layer * 0.4);

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: y,
              width: finalSize,
              height: finalSize,
              borderRadius: "50%",
              backgroundColor: "#fff",
              opacity,
              transform: `scale(${scale})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
