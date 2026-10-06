export function sampleFrequency(data: number[], index: number, count: number, spread: number): number {
  if (data.length === 0) return 0;
  const position = Math.pow(index / count, spread) * (data.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, data.length - 1);
  const fraction = position - low;
  return data[low] * (1 - fraction) + data[high] * fraction;
}

export function flowingWavePath(data: number[], samples: number, time: number, layer: number,
  gain: number, spread: number, bassEnergy: number): string {
  const points = Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const amp = sampleFrequency(data, Math.abs(i - samples / 2) * 2, samples + 1, 1 / spread);
    // Keep loud tracks inside the frame, including the offset of the fifth layer.
    const amplitude = Math.min(360, gain * (0.35 + amp * 2) + bassEnergy * 60);
    return {
      x: t * 1920,
      y: 540 + Math.sin(t * Math.PI * 4 - time * 1.4 + layer * 0.65)
        * amplitude * Math.sin(t * Math.PI) + layer * 18,
    };
  });
  let path = `M${points[0].x},${points[0].y}`;
  // Quadratic segments through midpoints stay smooth even at low preview detail.
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i];
    const next = points[i + 1];
    path += ` Q${point.x.toFixed(1)},${point.y.toFixed(1)} ${((point.x + next.x) / 2).toFixed(1)},${((point.y + next.y) / 2).toFixed(1)}`;
  }
  const last = points[points.length - 1];
  return `${path} L${last.x},${last.y.toFixed(1)}`;
}
