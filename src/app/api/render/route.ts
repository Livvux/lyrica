import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import * as z from "zod";
import { renderVideo } from "@/lib/render-video";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { startServerPerf } from "@/lib/perf";
import { installRenderSafetyNet } from "@/lib/render-safety-net";
import type { VideoConfig } from "@/types/lyrics";

export const runtime = "nodejs";

installRenderSafetyNet();

const MAX_DURATION_FRAMES = 30 * 60 * 120; // 120 Minuten @ 30fps

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
  renderQuality: z.enum(["fast", "balanced", "quality"]).optional(),
});

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const parsePerf = startServerPerf("api.render.parse");
  const clientIp = getClientIp(request);
  const limited = rateLimit("render", { windowMs: 60_000, max: 3, clientKey: clientIp });
  if (limited) {
    parsePerf({ status: 429, clientIp });
    return limited;
  }

  // Clean up old tmp files (non-blocking)
  cleanupTmpFiles();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    parsePerf({ status: 400, reason: "invalid-json", clientIp });
    return NextResponse.json({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const parsed = VideoConfigSchema.safeParse(raw);
  if (!parsed.success) {
    parsePerf({ status: 400, reason: "invalid-config", clientIp });
    return NextResponse.json(
      { error: "Ungültige Video-Konfiguration.", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const config: VideoConfig = parsed.data;

  await mkdir(TMP_DIR, { recursive: true });
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(TMP_DIR, outputFilename);
  parsePerf({
    status: 200,
    clientIp,
    quality: config.renderQuality ?? "balanced",
    durationFrames: config.durationInFrames,
  });
  const renderPerf = startServerPerf("api.render.stream", {
    clientIp,
    quality: config.renderQuality ?? "balanced",
    durationFrames: config.durationInFrames,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (data: Record<string, unknown>) => {
        // Double gate: our own flag plus the request signal. Next.js flips
        // the underlying controller to a closed state the same tick the
        // abort fires, so checking `request.signal.aborted` prevents a race
        // where our flag hasn't been set yet by the abort listener below.
        if (closed || request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const onAbort = () => {
        closed = true;
      };
      request.signal.addEventListener("abort", onAbort, { once: true });

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
        renderPerf({ status: 200 });
      } catch (e) {
        if (request.signal.aborted) {
          renderPerf({ status: 499, reason: "client-aborted" });
        } else {
          console.error("Render error:", e);
          const errorMsg = e instanceof Error ? e.message : "Unbekannter Fehler";
          send({ phase: "log", message: "FEHLER: Render fehlgeschlagen (Details im Server-Log)." });
          send({ phase: "error", error: "Fehler beim Rendern des Videos." });
          renderPerf({ status: 500, error: errorMsg });
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the client disconnect path — safe to ignore.
          }
        }
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
