import { AbsoluteFill, staticFile } from "remotion";
import type { VisualizerMode } from "@/types/lyrics";

interface AudioVisualizerProps {
  frequencyData: number[];
  bassEnergy: number;
  mode: VisualizerMode;
  monoColor: string;
  logoScale: number;
}

const NUM_BARS = 64;
const CX = 960;
const CY = 540;
const INNER_RADIUS = 140;
const MAX_BAR_LENGTH = 200;
const BAR_WIDTH = 4;
const INNER_BAR_RATIO = 0.3;
const BASE_LOGO_WIDTH = 120;
const BASE_LOGO_HEIGHT = 50;

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  frequencyData,
  bassEnergy,
  mode,
  monoColor,
  logoScale,
}) => {
  if (mode === "none") return null;

  const scale = 1 + bassEnergy * 0.12;
  const ls = logoScale / 100;
  const logoW = BASE_LOGO_WIDTH * ls;
  const logoH = BASE_LOGO_HEIGHT * ls;
  const glowStd = 4 + bassEnergy * 8;

  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080">
        <defs>
          <filter id="bar-glow">
            <feGaussianBlur stdDeviation={glowStd} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="ball-glow">
            <feGaussianBlur stdDeviation={6 + bassEnergy * 12} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="ball-clip">
            <circle cx={CX} cy={CY} r={INNER_RADIUS - 2} />
          </clipPath>
        </defs>

        {/* All outer bars in one group — single blur pass instead of 64 */}
        <g filter="url(#bar-glow)">
          {frequencyData.map((amp, i) => {
            const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2;
            const next = frequencyData[(i + 1) % NUM_BARS];
            const smoothed = (amp + next) / 2;
            const barLen = smoothed * MAX_BAR_LENGTH;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const color =
              mode === "rainbow"
                ? `hsl(${(i / NUM_BARS) * 360}, 80%, 60%)`
                : monoColor;

            return (
              <line
                key={`outer-${i}`}
                x1={CX + INNER_RADIUS * cos}
                y1={CY + INNER_RADIUS * sin}
                x2={CX + (INNER_RADIUS + barLen) * cos}
                y2={CY + (INNER_RADIUS + barLen) * sin}
                stroke={color}
                strokeWidth={BAR_WIDTH}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Inner mirrored bars — no filter needed, just opacity */}
        <g opacity={0.5}>
          {frequencyData.map((amp, i) => {
            const angle = (i / NUM_BARS) * 2 * Math.PI - Math.PI / 2;
            const next = frequencyData[(i + 1) % NUM_BARS];
            const smoothed = (amp + next) / 2;
            const barLen = smoothed * MAX_BAR_LENGTH * INNER_BAR_RATIO;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const color =
              mode === "rainbow"
                ? `hsl(${(i / NUM_BARS) * 360}, 80%, 40%)`
                : monoColor;

            return (
              <line
                key={`inner-${i}`}
                x1={CX + INNER_RADIUS * cos}
                y1={CY + INNER_RADIUS * sin}
                x2={CX + (INNER_RADIUS - barLen) * cos}
                y2={CY + (INNER_RADIUS - barLen) * sin}
                stroke={color}
                strokeWidth={BAR_WIDTH - 1}
                strokeLinecap="round"
              />
            );
          })}
        </g>

        {/* Center ball + logo group (scales together) */}
        <g transform={`translate(${CX * (1 - scale)}, ${CY * (1 - scale)}) scale(${scale})`}>
          <circle
            cx={CX}
            cy={CY}
            r={INNER_RADIUS}
            fill="rgba(0,0,0,0.6)"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={2}
            filter="url(#ball-glow)"
          />
          {/* Logo clipped to ball, centered */}
          <g clipPath="url(#ball-clip)">
            <image
              href={staticFile("logo.svg")}
              x={CX - logoW / 2}
              y={CY - logoH / 2}
              width={logoW}
              height={logoH}
              opacity={0.85}
            />
          </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
};
