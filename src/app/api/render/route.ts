import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as z from "zod";
import { renderVideo } from "@/lib/render-video";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import type { VideoConfig } from "@/types/lyrics";

const MAX_DURATION_FRAMES = 30 * 60 * 15; // 15 Minuten @ 30fps

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
  gain: z.number(),
  radius: z.number(),
  points: z.number().int(),
  spread: z.number(),
});

const StyleConfigSchema = z.object({
  fontSize: z.number().positive(),
  fontFamily: z.string(),
  textColor: z.string(),
  bgImage: z.string(),
  bgType: z.enum(["image", "video"]),
  effectIntensity: z.enum(["off", "subtle", "strong"]),
  beatReactive: z.boolean(),
  animationVariant: z.enum(["fade-drift", "zoom", "slide-horizontal", "typewriter", "handwritten", "karaoke"]),
  visualizerMode: z.enum(["none", "rainbow", "mono", "wave"]),
  logoScale: z.number(),
  customLogo: z.string().nullable(),
  postEffect: z.enum(["none", "glitch", "vhs", "film-grain", "chromatic-aberration", "camera-shake"]),
  showWatermark: z.boolean(),
  waveConfig: WaveConfigSchema,
});

const VideoConfigSchema = z.object({
  lines: z.array(LyricLineSchema),
  audioUrl: z.string(),
  style: StyleConfigSchema,
  durationInFrames: z.number().int().positive().max(MAX_DURATION_FRAMES),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  renderQuality: z.enum(["draft", "full"]).optional(),
});

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const limited = rateLimit("render", { windowMs: 60_000, max: 3 });
  if (limited) return limited;

  // Clean up old tmp files (non-blocking)
  cleanupTmpFiles();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const parsed = VideoConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ungültige Video-Konfiguration.", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const config: VideoConfig = parsed.data;

  await mkdir(TMP_DIR, { recursive: true });
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(TMP_DIR, outputFilename);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Detect client disconnect
      request.signal.addEventListener("abort", () => {
        closed = true;
      });

      try {
        await renderVideo(config, outputPath, {
          signal: request.signal,
          onProgress: (p) => {
            send({ phase: p.phase, progress: p.progress });
          },
          onLog: (message) => {
            send({ phase: "log", message });
          },
          onMetrics: (m) => {
            send({ phase: "metrics", metrics: m });
          },
          onSummary: (s) => {
            send({ phase: "summary", summary: s });
          },
        });

        send({ phase: "done", filename: outputFilename });
      } catch (e) {
        console.error("Render error:", e);
        const errorMsg = e instanceof Error ? e.message : "Unbekannter Fehler";
        send({ phase: "log", message: `FEHLER: ${errorMsg}` });
        send({ phase: "error", error: "Fehler beim Rendern des Videos." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
