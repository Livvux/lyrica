export type PreviewQuality = "low" | "balanced" | "high";
export type PreviewQualityMode = "auto" | PreviewQuality;

export function initialPreviewQuality(cores: number, memoryGb?: number): PreviewQuality {
  if (cores <= 4 || (memoryGb !== undefined && memoryGb <= 4)) return "low";
  return "balanced";
}

export interface QualitySample {
  quality: PreviewQuality;
  slowWindows: number;
  healthyWindows: number;
}

// Two slow 3s windows reduce detail; six healthy windows allow a cautious upgrade.
export function adaptPreviewQuality(state: QualitySample, deliveredRatio: number): QualitySample {
  const slowWindows = deliveredRatio < 0.8 ? state.slowWindows + 1 : 0;
  const healthyWindows = deliveredRatio >= 0.97 ? state.healthyWindows + 1 : 0;
  const levels: PreviewQuality[] = ["low", "balanced", "high"];
  const index = levels.indexOf(state.quality);
  if (slowWindows >= 2 && index > 0) {
    return { quality: levels[index - 1], slowWindows: 0, healthyWindows: 0 };
  }
  if (healthyWindows >= 6 && index < 2) {
    return { quality: levels[index + 1], slowWindows: 0, healthyWindows: 0 };
  }
  return { ...state, slowWindows, healthyWindows };
}
