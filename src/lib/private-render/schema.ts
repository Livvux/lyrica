import * as z from "zod";
const MAX_DURATION_FRAMES = 30 * 60 * 120; // 120 Minuten @ 30fps

const TranscriptionWordSchema = z.object({
  word: z.string().max(1000),
  startSec: z.number(),
  endSec: z.number(),
  confidence: z.number().optional(),
});

const LyricLineSchema = z.object({
  text: z.string().max(1000),
  startFrame: z.number().int(),
  endFrame: z.number().int(),
  startSec: z.number(),
  endSec: z.number(),
  words: z.array(TranscriptionWordSchema).optional(),
});

const WaveConfigSchema = z.object({
  colors: z.tuple([z.string().max(1000), z.string().max(1000), z.string().max(1000), z.string().max(1000), z.string().max(1000)]),
  gain: z.number().min(100).max(500),
  radius: z.number().min(80).max(250),
  points: z.number().int().min(12).max(64),
  spread: z.number().min(0.2).max(1),
});

const StyleConfigSchema = z.object({
  fontSize: z.number().min(8).max(300),
  fontFamily: z.string().max(1000),
  textColor: z.string().max(1000),
  bgImage: z.string().max(1000),
  bgType: z.enum(["image", "video"]),
  effectIntensity: z.enum(["off", "subtle", "strong"]),
  beatReactive: z.boolean(),
  animationVariant: z.enum(["fade-drift", "zoom", "slide-horizontal", "typewriter", "handwritten", "karaoke"]),
  visualizerMode: z.enum(["none", "rainbow", "mono", "wave", "waves", "spectrum"]),
  logoScale: z.number().min(1).max(300),
  customLogo: z.string().max(1000).nullable(),
  postEffect: z.enum(["none", "glitch", "vhs", "film-grain", "chromatic-aberration", "camera-shake"]),
  showWatermark: z.boolean(),
  waveConfig: WaveConfigSchema,
});

export const VideoConfigSchema = z.object({
  lines: z.array(LyricLineSchema).max(10000),
  audioUrl: z.string().max(1000),
  style: StyleConfigSchema,
  durationInFrames: z.number().int().positive().max(MAX_DURATION_FRAMES),
  fps: z.number().int().min(1).max(60),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  renderQuality: z.enum(["fast", "balanced", "quality"]).optional(),
});

