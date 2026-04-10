import { AbsoluteFill, staticFile } from "remotion";
import type { VisualizerMode, WaveConfig } from "@/types/lyrics";
import { DEFAULT_WAVE_CONFIG } from "@/types/lyrics";

interface AudioVisualizerProps {
  frequencyData: number[];
  bassEnergy: number;
  mode: VisualizerMode;
  monoColor: string;
  logoScale: number;
  customLogo: string | null;
  isDraft?: boolean;
  waveConfig?: WaveConfig;
}

const NUM_BARS_FULL = 64;
const NUM_BARS_DRAFT = 32;
const CX = 960;
const CY = 540;
const INNER_RADIUS = 140;
const MAX_BAR_LENGTH = 200;
const BAR_WIDTH = 4;
const BASE_LOGO_WIDTH = 120;
const BASE_LOGO_HEIGHT = 50;

// --- Trap Nation wave mode helpers ---

// Catmull-Rom spline through points (closed loop), returns just the curve part (no M, no Z)
function catmullRomCurve(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n < 3) return "";
  const tension = 1 / 6;
  let d = "";
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} `;
  }
  return d;
}

// Sample frequency data with adjustable mapping (spread controls distribution)
// spread < 1 = more even distribution, spread = 1 = linear (concentrated)
function sampleFreqLog(data: number[], index: number, numPoints: number, spread: number): number {
  const t = index / numPoints;
  const logIdx = Math.pow(t, spread) * (data.length - 1);
  const lo = Math.floor(logIdx);
  const hi = Math.min(lo + 1, data.length - 1);
  const frac = logIdx - lo;
  return data[lo] * (1 - frac) + data[hi] * frac;
}

// Build a donut path: outer wave (Catmull-Rom spline) + inner circle (reverse arc)
// Only the ring between inner circle and outer wave gets filled
function buildWaveRingPath(
  data: number[], numPoints: number, cx: number, cy: number,
  innerRadius: number, gain: number, scale: number, spread: number,
): string {
  const total = numPoints * 2;
  const outerPoints: { x: number; y: number }[] = [];
  for (let i = 0; i < total; i++) {
    const mirrorIdx = i < numPoints ? i : total - i;
    const amp = sampleFreqLog(data, mirrorIdx, numPoints, spread);
    const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
    const r = innerRadius + amp * gain * scale;
    outerPoints.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }

  // Outer wave: Catmull-Rom spline clockwise
  const outer = `M ${outerPoints[0].x.toFixed(1)} ${outerPoints[0].y.toFixed(1)} ${catmullRomCurve(outerPoints)}Z`;

  // Inner circle: simple arc counter-clockwise (cuts out the center)
  // SVG arc: move to right of circle, draw two 180° arcs
  const ir = innerRadius;
  const inner = `M ${cx + ir} ${cy} A ${ir} ${ir} 0 1 0 ${cx - ir} ${cy} A ${ir} ${ir} 0 1 0 ${cx + ir} ${cy} Z`;

  // Combine with even-odd fill rule to create donut
  return outer + " " + inner;
}

function smoothData(data: number[]): number[] {
  const n = data.length;
  return data.map((v, i) => {
    const p = data[(i - 1 + n) % n];
    const nx = data[(i + 1) % n];
    return (p + v * 2 + nx) / 4;
  });
}

type WaveColorLayer = { color: string; opacity: number; scale: number };

// Layer scale/opacity presets (outermost → innermost)
const LAYER_SCALES = [1.55, 1.38, 1.22, 1.10, 1.0];
const LAYER_OPACITIES = [0.75, 0.75, 0.80, 0.85, 0.95];

function getWaveLayers(colors: [string, string, string, string, string], bassEnergy: number): WaveColorLayer[] {
  const beat = 1 + bassEnergy * 0.35;
  return colors.map((color, i) => ({
    color,
    opacity: LAYER_OPACITIES[i],
    scale: LAYER_SCALES[i] * beat,
  }));
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  frequencyData,
  bassEnergy,
  mode,
  monoColor,
  logoScale,
  customLogo,
  isDraft,
  waveConfig: wc,
}) => {
  if (mode === "none") return null;

  const waveConfig = wc ?? DEFAULT_WAVE_CONFIG;
  const radius = mode === "wave" ? waveConfig.radius : INNER_RADIUS;
  const scale = 1 + bassEnergy * 0.12;
  const ls = logoScale / 100;
  const logoW = BASE_LOGO_WIDTH * ls;
  const logoH = BASE_LOGO_HEIGHT * ls;

  // Resolve logo URL for Remotion staticFile
  const resolvedLogo = customLogo
    ? customLogo.startsWith("/api/audio/")
      ? staticFile(customLogo.replace("/api/audio/", ""))
      : staticFile(customLogo)
    : staticFile("logo.svg");

  // Shared center ball + logo renderer
  const centerBall = (
    <g transform={`translate(${CX * (1 - scale)}, ${CY * (1 - scale)}) scale(${scale})`}>
      <circle
        cx={CX}
        cy={CY}
        r={radius}
        fill="#000000"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={2}
        filter="url(#ball-glow)"
      />
      <g clipPath="url(#ball-clip)">
        <image
          href={resolvedLogo}
          x={CX - logoW / 2}
          y={CY - logoH / 2}
          width={logoW}
          height={logoH}
          opacity={0.85}
        />
      </g>
    </g>
  );

  // --- Wave mode (Trap Nation) ---
  if (mode === "wave") {
    const numPts = isDraft ? Math.round(waveConfig.points * 0.56) : waveConfig.points;
    const smoothed = smoothData(smoothData(frequencyData));
    const layers = getWaveLayers(waveConfig.colors, bassEnergy);

    // Build donut ring paths for each color layer (outer wave spline + inner circle cutout)
    const ringPaths = layers.map((layer) =>
      buildWaveRingPath(smoothed, numPts, CX, CY, radius, waveConfig.gain, layer.scale, waveConfig.spread)
    );

    return (
      <AbsoluteFill>
        <svg width={1920} height={1080} viewBox="0 0 1920 1080">
          <defs>
            {/* Per-layer glow: outer layers get stronger blur */}
            {layers.map((_, li) => {
              const layerDepth = (layers.length - 1 - li) / (layers.length - 1);
              const std = isDraft
                ? 4 + layerDepth * 8 + bassEnergy * 6
                : 6 + layerDepth * 14 + bassEnergy * 12;
              return (
                <filter id={`wave-glow-${li}`} key={`wg-${li}`}>
                  <feGaussianBlur stdDeviation={std} result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              );
            })}
            <filter id="ball-glow">
              <feGaussianBlur stdDeviation={6 + bassEnergy * 12} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="ball-clip">
              <circle cx={CX} cy={CY} r={radius - 2} />
            </clipPath>
          </defs>

          {/* Wave layers — back (outermost/blue) to front (innermost/white) */}
          {ringPaths.map((d, li) => (
            <path
              key={`wave-${li}`}
              d={d}
              fillRule="evenodd"
              fill={layers[li].color}
              opacity={layers[li].opacity}
              filter={li < layers.length - 1 ? `url(#wave-glow-${li})` : undefined}
            />
          ))}

          {centerBall}
        </svg>
      </AbsoluteFill>
    );
  }

  // --- Bar modes (rainbow / mono) ---
  const numBars = isDraft ? NUM_BARS_DRAFT : NUM_BARS_FULL;
  const bars = isDraft
    ? frequencyData.filter((_, i) => i % 2 === 0)
    : frequencyData;
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

        {/* All outer bars in one group — single blur pass */}
        <g filter="url(#bar-glow)">
          {bars.map((amp, i) => {
            const angle = (i / numBars) * 2 * Math.PI - Math.PI / 2;
            const next = bars[(i + 1) % numBars];
            const smoothed = (amp + next) / 2;
            const barLen = smoothed * MAX_BAR_LENGTH;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const color =
              mode === "rainbow"
                ? `hsl(${(i / numBars) * 360}, 80%, 60%)`
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

        {centerBall}
      </svg>
    </AbsoluteFill>
  );
};
