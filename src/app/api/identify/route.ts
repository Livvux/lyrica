import { NextResponse } from "next/server";
import { readFile, unlink, stat } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { sanitizeFilename } from "@/lib/sanitize-filename";

const AUDD_API_URL = "https://api.audd.io/";
const TMP_DIR = join(process.cwd(), "tmp", "lyrica");

export async function POST(req: Request) {
  const apiKey = process.env.AUDD_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ match: null });
  }

  let body: { audioFilename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { audioFilename } = body;
  if (!audioFilename || typeof audioFilename !== "string") {
    return NextResponse.json({ error: "audioFilename required" }, { status: 400 });
  }

  const safe = sanitizeFilename(audioFilename);
  const audioPath = join(TMP_DIR, safe);
  try {
    await stat(audioPath);
  } catch {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  try {
    // Extract a 20s snippet from the middle of the audio for identification
    const snippet = await extractSnippet(audioPath);

    const formData = new FormData();
    formData.append("api_token", apiKey);
    formData.append("file", new Blob([new Uint8Array(snippet)]), "snippet.mp3");
    formData.append("return", "timecode");

    const res = await fetch(AUDD_API_URL, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();

    if (data.status === "success" && data.result) {
      return NextResponse.json({
        match: {
          title: data.result.title,
          artist: data.result.artist,
          album: data.result.album || undefined,
        },
      });
    }

    return NextResponse.json({ match: null });
  } catch {
    // Graceful degradation: if AudD fails, skip identification
    return NextResponse.json({ match: null });
  }
}

/** Extract a 20s MP3 snippet from the middle of the audio file using ffmpeg. */
function extractSnippet(audioPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // First get duration
    execFile(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath],
      (err, stdout) => {
        if (err) {
          // Fallback: send first 500KB of the file
          readFile(audioPath).then((buf) => resolve(buf.subarray(0, 500_000))).catch(reject);
          return;
        }

        const duration = parseFloat(stdout.trim());
        const start = Math.max(0, (duration / 2) - 10);
        const outPath = join(TMP_DIR, `snippet-${randomUUID()}.mp3`);

        execFile(
          "ffmpeg",
          [
            "-y", "-ss", String(start), "-t", "20",
            "-i", audioPath,
            "-ac", "1", "-ar", "16000", "-b:a", "64k",
            outPath,
          ],
          (err2) => {
            if (err2) {
              readFile(audioPath).then((buf) => resolve(buf.subarray(0, 500_000))).catch(reject);
              return;
            }
            readFile(outPath)
              .then((buf) => {
                unlink(outPath).catch(() => {});
                return buf;
              })
              .then(resolve)
              .catch(reject);
          }
        );
      }
    );
  });
}
