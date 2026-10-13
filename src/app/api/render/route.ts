import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {VideoConfigSchema} from "@/lib/private-render/schema";
import {requireActor,privateFailure} from "@/lib/private-render/server";
import {registerOwnedMedia,validateOwnedSources} from "@/lib/private-render/owned-media";
import {readBoundedBody} from "@/lib/private-render/body";
import { renderVideo } from "@/lib/render-video";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { startServerPerf } from "@/lib/perf";
import { installRenderSafetyNet } from "@/lib/render-safety-net";
import type { VideoConfig } from "@/types/lyrics";

export const runtime = "nodejs";

installRenderSafetyNet();

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  let actor;try{actor=requireActor(request,true);}catch(error){return privateFailure(error);}
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
    raw = JSON.parse((await readBoundedBody(request,2*1024*1024)).toString("utf8"));
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
  try{await validateOwnedSources(actor,config);}catch(error){return privateFailure(error);}

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
            send({ phase: "log", message:message.replace(/https?:\/\/\S+/g,"[privater Renderpfad]") });
          },
          onMetrics: (m) => {
            send({ phase: "metrics", metrics: m });
          },
          onSummary: (s) => {
            send({ phase: "summary", summary: s });
          },
        });

        await registerOwnedMedia(actor,outputFilename,"video/mp4",512*1024*1024,"exports");
        send({ phase: "done", filename: outputFilename });
        renderPerf({ status: 200 });
      } catch (e) {
        if (request.signal.aborted) {
          renderPerf({ status: 499, reason: "client-aborted" });
        } else {
          void e;
          send({ phase: "log", message: "FEHLER: Privater Export fehlgeschlagen." });
          send({ phase: "error", error: "Fehler beim Rendern des Videos." });
          renderPerf({ status: 500, reason:"render-failed" });
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
      "Cache-Control": "private, no-store",
      Connection: "keep-alive",
    },
  });
}
