import { z } from "zod";
import { DEFAULT_STYLE } from "../types/lyrics";

const STORAGE_KEY = "lyrica-session-v1";
const frame = z.number().int().nonnegative();
const localPath = z.string().regex(/^\/(?![/\\])[^\\\x00-\x1f]*$/);
const word = z.object({ word: z.string(), startSec: z.number().nonnegative(), endSec: z.number().nonnegative(), confidence: z.number().optional() });
const style = z.object({
  fontSize: z.number().positive().max(500).default(DEFAULT_STYLE.fontSize),
  fontFamily: z.string().max(200).default(DEFAULT_STYLE.fontFamily),
  textColor: z.string().max(100).default(DEFAULT_STYLE.textColor),
  bgImage: localPath.default(DEFAULT_STYLE.bgImage),
  bgType: z.enum(["image", "video"]).default("image"),
  effectIntensity: z.enum(["off", "subtle", "strong"]).default("subtle"),
  beatReactive: z.boolean().default(true),
  animationVariant: z.enum(["fade-drift", "zoom", "slide-horizontal", "typewriter", "handwritten", "karaoke"]).default("fade-drift"),
  visualizerMode: z.enum(["none", "rainbow", "mono", "wave", "waves", "spectrum"]).default("none"),
  logoScale: z.number().positive().max(500).default(100),
  customLogo: localPath.nullable().default(null),
  postEffect: z.enum(["none", "glitch", "vhs", "film-grain", "chromatic-aberration", "camera-shake"]).default("none"),
  showWatermark: z.boolean().default(true),
  waveConfig: z.object({
    colors: z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]).default(DEFAULT_STYLE.waveConfig.colors),
    gain: z.number().min(100).max(500).default(280),
    radius: z.number().min(80).max(250).default(140),
    points: z.number().int().min(12).max(64).default(32),
    spread: z.number().min(0.2).max(1).default(0.55),
  }).prefault({}),
}).prefault({});

export const ProjectSchema = z.object({
  lines: z.array(z.object({ text: z.string(), startFrame: frame, endFrame: frame, startSec: z.number().nonnegative(), endSec: z.number().nonnegative(), words: z.array(word).optional() }).refine(l => l.endFrame >= l.startFrame && l.endSec >= l.startSec)),
  audioUrl: localPath.nullable(),
  originalFilename: z.string().nullable().optional(),
  durationSec: z.number().nonnegative().max(7200),
  style,
  lyricsActive: z.boolean(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  clip: z.object({ startFrame: frame, endFrame: frame }).nullable().default(null),
  beatSensitivity: z.number().min(0.25).max(3).default(1),
  manualBeats: z.array(z.number().nonnegative()).max(50000).optional(),
}).refine(p => !p.clip || (p.clip.endFrame > p.clip.startFrame && p.clip.endFrame <= Math.ceil(p.durationSec * 30)));

export type PersistedState = z.infer<typeof ProjectSchema>;

export function savePersistence(state: PersistedState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

export function readPersistence(): { state: PersistedState | null; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: null, error: null };
    const parsed = ProjectSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { state: parsed.data, error: null };
  } catch { /* Preserve unreadable state; the editor must not overwrite it. */ }
  return { state: null, error: "Gespeichertes Projekt nicht lesbar. Es bleibt unverändert, bis du einen neuen Song lädst." };
}

export function loadPersistence(): PersistedState | null { return readPersistence().state; }
