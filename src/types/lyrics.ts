export interface TranscriptionWord {
  word: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptionWord[];
  durationSec: number;
  provider: "openai" | "groq";
}

export interface LyricLine {
  text: string;
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
}

export type EffectIntensity = "off" | "subtle" | "strong";

export type VisualizerMode = "none" | "rainbow" | "mono";

export type AnimationVariant = "fade-drift" | "zoom" | "slide-horizontal" | "typewriter" | "handwritten";

export interface StyleConfig {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  bgImage: string;
  effectIntensity: EffectIntensity;
  beatReactive: boolean;
  animationVariant: AnimationVariant;
  visualizerMode: VisualizerMode;
  logoScale: number;
}

export const COLOR_PRESETS = ["#ffffff", "#fbbf24", "#22d3ee", "#f472b6"] as const;

export const DEFAULT_STYLE: StyleConfig = {
  fontSize: 76,
  fontFamily: "Inter",
  textColor: "#ffffff",
  bgImage: "/bg-default.jpg",
  effectIntensity: "subtle",
  beatReactive: true,
  animationVariant: "fade-drift",
  visualizerMode: "none",
  logoScale: 100,
};

export type RenderQuality = "draft" | "full";

export interface VideoConfig {
  lines: LyricLine[];
  audioUrl: string;
  style: StyleConfig;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  renderQuality?: RenderQuality;
}

// --- Lyrics Validation ---

export interface SongMatch {
  title: string;
  artist: string;
  album?: string;
}

export interface ReferenceLyricLine {
  text: string;
  startSec?: number;
  endSec?: number;
}

export interface ReferenceLyrics {
  source: "lrclib" | "lyrics.ovh";
  synced: boolean;
  lines: ReferenceLyricLine[];
  plainText: string;
}

export interface LineValidation {
  lineIndex: number;
  similarity: number;
  referenceLine?: string;
  issue?: "hallucination" | "empty" | "repeated" | "short";
}

export interface ValidationResult {
  songMatch: SongMatch | null;
  reference: ReferenceLyrics | null;
  overallScore: number;
  lineValidations: LineValidation[];
}
