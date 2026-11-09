import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as z from "zod";
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
  width: z.number().int().positive().max(3840),
  height: z.number().int().positive().max(3840),
  renderQuality: z.enum(["fast", "balanced", "quality"]).optional(),
});

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const limited = rateLimit("render", { windowMs: 60_000, max: 3, clientKey: getClientIp(request) });
  if (limited) return limited;

  cleanupTmpFiles();

  const parsed = VideoConfigSchema.safeParse(await request.json().catch(() => null));
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
