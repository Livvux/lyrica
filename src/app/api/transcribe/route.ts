import { NextResponse } from "next/server";
import { writeFile, mkdir, readFile, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { createHash } from "crypto";
import { transcribeFile } from "@/lib/transcription";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import type { TranscriptionResult } from "@/types/lyrics";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const CACHE_DIR = path.join(TMP_DIR, "cache");

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex").slice(0, 16);
}

/** Transcribe a file previously stored by /api/upload-audio, cached by content hash. */
export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limited = rateLimit("transcribe", { windowMs: 60_000, max: 5, clientKey: clientIp });
  if (limited) return limited;

  try {
    const audioFilename = (await request.formData()).get("audioFilename");
    if (typeof audioFilename !== "string" || !audioFilename) {
      return NextResponse.json({ error: "Keine Audiodatei ausgewählt." }, { status: 400 });
    }

    const filePath = path.join(TMP_DIR, sanitizeFilename(audioFilename));
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      return NextResponse.json({ error: "Audiodatei nicht gefunden." }, { status: 404 });
    }

    const hash = await hashFile(filePath);
    const cachePath = path.join(CACHE_DIR, `${hash}.json`);
    let result: TranscriptionResult | null = await readFile(cachePath, "utf-8")
      .then((data) => JSON.parse(data) as TranscriptionResult)
      .catch(() => null);
    if (!result) {
      result = await transcribeFile(filePath);
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath, JSON.stringify(result));
    }

    if (result.words.length === 0) {
      return NextResponse.json(
        { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." },
        { status: 400 }
      );
    }

    return NextResponse.json({ result });
  } catch (e) {
    console.error("Transcription error:", e);
    return NextResponse.json(
      { error: "Fehler bei der Transkription. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
