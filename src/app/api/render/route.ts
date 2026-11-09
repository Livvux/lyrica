import { readBoundedJson, BodyTooLargeError } from "@/lib/bounded-json";
import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as z from "zod";
import { AudioAnalysisSchema } from "@/lib/audio-analysis-schema";
import { renderVideo } from "@/lib/render-video";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { installRenderSafetyNet } from "@/lib/render-safety-net";
import type { VideoConfig } from "@/types/lyrics";

export const runtime = "nodejs";

installRenderSafetyNet();

const MAX_DURATION_FRAMES = 30 * 60 * 120; // 120 Minuten @ 30fps
// Assets must be same-origin paths ("/bg-default.jpg", "/api/audio/<file>"): the render
// browser must never be pointed at arbitrary remote URLs.
// Browsers treat "\" and strip tabs/newlines, so "/\host" would resolve cross-origin.
const LocalAssetPath = z.string().max(512).regex(/^\/(?![/\\])[^\\\x00-\x1f]*$/);

const TranscriptionWordSchema = z.object({
  word: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  confidence: z.number().optional(),
});

const LyricLineSchema = z.object({
  text: z.string(),
  startFrame: z.number().int(),
  endFrame: z.number().int(),
  startSec: z.number(),
  endSec: z.number(),
  words: z.array(TranscriptionWordSchema).optional(),
});

const WaveConfigSchema = z.object({
  colors: z.tuple([z.string(), z.string(), z.string(), z.string(), z.string()]),
  gain: z.number().min(100).max(500),
  radius: z.number().min(80).max(250),
  points: z.number().int().min(12).max(64),
  spread: z.number().min(0.2).max(1),
});

const StyleConfigSchema = z.object({
  fontSize: z.number().positive(),
  fontFamily: z.string(),
  textColor: z.string(),
  bgImage: LocalAssetPath,
  bgType: z.enum(["image", "video"]),
  effectIntensity: z.enum(["off", "subtle", "strong"]),
  beatReactive: z.boolean(),
  animationVariant: z.enum(["fade-drift", "zoom", "slide-horizontal", "typewriter", "handwritten", "karaoke"]),
  visualizerMode: z.enum(["none", "rainbow", "mono", "wave", "waves", "spectrum"]),
  logoScale: z.number(),
  customLogo: LocalAssetPath.nullable(),
  postEffect: z.enum(["none", "glitch", "vhs", "film-grain", "chromatic-aberration", "camera-shake"]),
  showWatermark: z.boolean(),
  waveConfig: WaveConfigSchema,
});

const VideoConfigSchema = z.object({
  lines: z.array(LyricLineSchema),
  audioUrl: LocalAssetPath,
  style: StyleConfigSchema,
  durationInFrames: z.number().int().positive().max(MAX_DURATION_FRAMES),
  fps: z.number().int().positive().max(60),
  width: z.number().int().min(2).max(3840).multipleOf(2),
  height: z.number().int().min(2).max(3840).multipleOf(2),
  renderQuality: z.enum(["fast", "balanced", "quality"]).optional(),
  audioAnalysis: AudioAnalysisSchema.optional(),
  beatSensitivity: z.number().min(0.25).max(3).optional(),
  manualBeats: z.array(z.number().min(0).max(7200)).max(60000).optional(),
  clipStartFrame: z.number().int().nonnegative().optional(),
  clipEndFrame: z.number().int().positive().optional(),
}).refine((config) => {
  const start = config.clipStartFrame ?? 0;
  const end = config.clipEndFrame ?? config.durationInFrames;
  const duration = config.durationInFrames / config.fps;
  return start < end && end <= config.durationInFrames && duration <= 7200
    && (!config.audioAnalysis || Math.abs(config.audioAnalysis.durationSec - duration) <= 0.1)
    && (!config.manualBeats || config.manualBeats.every((beat, index, beats) => beat < duration && (index === 0 || beat > beats[index - 1])));
}, { message: "Exportbereich muss innerhalb des Songs liegen." });

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const limited = rateLimit("render", { windowMs: 60_000, max: 3, clientKey: getClientIp(request) });
  if (limited) return limited;

  cleanupTmpFiles();

  let body: unknown;
  try { body = await readBoundedJson(request, 32 * 1024 * 1024); }
  catch (error) {
    return NextResponse.json({ error: error instanceof BodyTooLargeError ? "Exportdaten zu groß (maximal 32 MB)." : "Exportdaten nicht lesbar." }, { status: error instanceof BodyTooLargeError ? 413 : 400 });
  }
  const parsed = VideoConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Video-Konfiguration.", details: parsed.error.issues }, { status: 400 });
  }
  const config: VideoConfig = parsed.data;

  await mkdir(TMP_DIR, { recursive: true });
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(TMP_DIR, outputFilename);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Next.js closes the controller the same tick the client aborts; never enqueue after that.
      const send = (data: Record<string, unknown>) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client gone
        }
      };

      try {
        await renderVideo(config, outputPath, { signal: request.signal, onProgress: send });
        send({ phase: "done", filename: outputFilename });
      } catch (e) {
        if (!request.signal.aborted) {
          console.error("Render error:", e);
          const busy = e instanceof Error && e.message.startsWith("Ein Export läuft bereits");
          send({ phase: "error", error: busy ? e.message : "Fehler beim Rendern des Videos." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client disconnect path
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
