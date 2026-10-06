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
  words?: TranscriptionWord[];
}

export type EffectIntensity = "off" | "subtle" | "strong";

export type VisualizerMode = "none" | "rainbow" | "mono" | "wave" | "waves" | "spectrum";

export type AnimationVariant = "fade-drift" | "zoom" | "slide-horizontal" | "typewriter" | "handwritten" | "karaoke";

export type BgType = "image" | "video";

export type PostEffect = "none" | "glitch" | "vhs" | "film-grain" | "chromatic-aberration" | "camera-shake";

export interface WaveConfig {
  colors: [string, string, string, string, string]; // 5 Ringe, außen → innen
  gain: number;       // Amplitude (default 280)
  radius: number;     // Kreisradius (default 140)
  points: number;     // Wellenpunkte / Glätte (default 32)
  spread: number;     // Frequenzverteilung: 0.2=gleichmäßig, 1.0=konzentriert (default 0.55)
}

export const DEFAULT_WAVE_CONFIG: WaveConfig = {
  colors: ["#3a5fcd", "#ff00ff", "#ff0000", "#ffb90f", "#ffffff"],
  gain: 280,
  radius: 140,
  points: 32,
  spread: 0.55,
};

export interface StyleConfig {
  fontSize: number;
  fontFamily: string;
  textColor: string;
  bgImage: string;
  bgType: BgType;
  effectIntensity: EffectIntensity;
  beatReactive: boolean;
  animationVariant: AnimationVariant;
  visualizerMode: VisualizerMode;
  logoScale: number;
  customLogo: string | null;
  postEffect: PostEffect;
  showWatermark: boolean;
  waveConfig: WaveConfig;
}

export const COLOR_PRESETS = ["#ffffff", "#fbbf24", "#22d3ee", "#f472b6"] as const;

export const DEFAULT_STYLE: StyleConfig = {
  fontSize: 76,
  fontFamily: "Inter",
  textColor: "#ffffff",
  bgImage: "/bg-default.jpg",
  bgType: "image",
  effectIntensity: "subtle",
  beatReactive: true,
  animationVariant: "fade-drift",
  visualizerMode: "none",
  logoScale: 100,
  customLogo: null,
  postEffect: "none",
  showWatermark: true,
  waveConfig: DEFAULT_WAVE_CONFIG,
};

export interface StylePreset {
  name: string;
  description: string;
  style: Partial<StyleConfig>;
}

export const VISUALIZER_PRESETS: StylePreset[] = [
  { name: "Ocean", description: "Fließende Wellen in kühlem Blau", style: {
    visualizerMode: "waves", beatReactive: true, effectIntensity: "subtle", postEffect: "none",
    waveConfig: { ...DEFAULT_WAVE_CONFIG, gain: 220, colors: ["#164e63", "#0891b2", "#22d3ee", "#67e8f9", "#ecfeff"] },
  } },
  { name: "Aurora", description: "Leuchtende Wellen in Violett und Mint", style: {
    visualizerMode: "waves", beatReactive: true, effectIntensity: "strong", postEffect: "none",
    waveConfig: { ...DEFAULT_WAVE_CONFIG, gain: 360, colors: ["#4c1d95", "#7c3aed", "#c084fc", "#2dd4bf", "#ccfbf1"] },
  } },
  { name: "Pulse", description: "Mehrfarbige, pulsierende Wellenringe", style: {
    visualizerMode: "wave", beatReactive: true, effectIntensity: "strong", postEffect: "none",
    waveConfig: { ...DEFAULT_WAVE_CONFIG },
  } },
  { name: "Spectrum", description: "Klarer Equalizer mit Cyan-Verlauf", style: {
    visualizerMode: "spectrum", beatReactive: true, effectIntensity: "subtle", postEffect: "none", textColor: "#22d3ee",
  } },
  { name: "Prism", description: "Kreisförmiges Regenbogen-Spektrum", style: {
    visualizerMode: "rainbow", beatReactive: true, effectIntensity: "subtle", postEffect: "none",
  } },
  { name: "Mono", description: "Reduzierter weißer Spektrum-Ring", style: {
    visualizerMode: "mono", beatReactive: true, effectIntensity: "subtle", postEffect: "none", textColor: "#ffffff",
  } },
];

export const STYLE_PRESETS: StylePreset[] = [
  {
    name: "Neon",
    description: "Leuchtende Farben, starke Effekte",
    style: {
      textColor: "#22d3ee",
      animationVariant: "zoom",
      effectIntensity: "strong",
      beatReactive: true,
      fontSize: 80,
    },
  },
  {
    name: "Minimal",
    description: "Schlicht und elegant",
    style: {
      textColor: "#ffffff",
      animationVariant: "fade-drift",
      effectIntensity: "off",
      beatReactive: false,
      fontSize: 72,
    },
  },
  {
    name: "Retro",
    description: "Warme Farben, Typewriter-Effekt",
    style: {
      textColor: "#fbbf24",
      animationVariant: "typewriter",
      effectIntensity: "subtle",
      beatReactive: true,
      fontSize: 76,
    },
  },
  {
    name: "Cinematic",
    description: "Filmisch, dramatisch",
    style: {
      textColor: "#ffffff",
      animationVariant: "slide-horizontal",
      effectIntensity: "subtle",
      beatReactive: true,
      fontSize: 84,
    },
  },
  {
    name: "Handschrift",
    description: "Organisch, persönlich",
    style: {
      textColor: "#f472b6",
      animationVariant: "handwritten",
      effectIntensity: "subtle",
      beatReactive: false,
      fontSize: 76,
    },
  },
  {
    name: "Karaoke",
    description: "Wort-für-Wort Highlighting",
    style: {
      textColor: "#ffffff",
      animationVariant: "karaoke",
      effectIntensity: "subtle",
      beatReactive: true,
      fontSize: 80,
    },
  },
];

export type RenderQuality = "fast" | "balanced" | "quality";

export interface VideoConfig {
  lines: LyricLine[];
  audioUrl: string;
  style: StyleConfig;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  renderQuality?: RenderQuality;
  /** Preview-only detail budget; never used to choose export quality. */
  previewQuality?: "low" | "balanced" | "high";
}

// --- Lyrics Validation ---

export interface SongMatch {
  title: string;
  artist: string;
  album?: string;
}

export interface MixTrack {
  startSec: number;
  endSec: number;
  artist: string;
  title: string;
  recordingId?: string;
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
