import { mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { renderVideo } from "@/lib/render-video";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import type { VideoConfig } from "@/types/lyrics";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const limited = rateLimit("render", { windowMs: 60_000, max: 3 });
  if (limited) return limited;

  // Clean up old tmp files (non-blocking)
  cleanupTmpFiles();

  const config: VideoConfig = await request.json();

  await mkdir(TMP_DIR, { recursive: true });
  const outputFilename = `${randomUUID()}.mp4`;
  const outputPath = path.join(TMP_DIR, outputFilename);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await renderVideo(config, outputPath, {
          onProgress: (p) => {
            send({ phase: p.phase, progress: p.progress });
          },
          onLog: (message) => {
            send({ phase: "log", message });
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
