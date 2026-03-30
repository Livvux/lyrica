import { NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { getProvider } from "@/lib/transcription";
import type { TranscriptionResult } from "@/types/lyrics";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const CACHE_DIR = path.join(process.cwd(), "tmp", "lyrica", "cache");

async function getCachedResult(hash: string): Promise<TranscriptionResult | null> {
  try {
    const data = await readFile(path.join(CACHE_DIR, `${hash}.json`), "utf-8");
    return JSON.parse(data) as TranscriptionResult;
  } catch {
    return null;
  }
}

async function setCachedResult(hash: string, result: TranscriptionResult): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(result));
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

async function transcribeWithCache(buffer: Buffer, fileName: string, mimeType: string): Promise<TranscriptionResult> {
  const hash = hashBuffer(buffer);

  const cached = await getCachedResult(hash);
  if (cached) {
    console.log(`Transcription cache hit: ${hash}`);
    return cached;
  }

  const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType });
  const provider = getProvider();
  const result = await provider.transcribe(file);

  await setCachedResult(hash, result);
  return result;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    // Mode 1: Transcribe an already-uploaded file by filename
    const existingFilename = formData.get("audioFilename") as string | null;
    if (existingFilename) {
      const safeName = path.basename(existingFilename);
      const filePath = path.join(TMP_DIR, safeName);
      const buffer = await readFile(filePath);
      const ext = path.extname(safeName);
      const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".webm": "audio/webm",
        ".mp4": "audio/mp4",
      };

      const result = await transcribeWithCache(
        Buffer.from(new Uint8Array(buffer)),
        safeName,
        mimeMap[ext] || "audio/mpeg"
      );

      if (!result.words || result.words.length === 0) {
        return NextResponse.json(
          { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." },
          { status: 400 }
        );
      }

      return NextResponse.json({ result });
    }

    // Mode 2: Upload + transcribe in one step (original flow)
    const file = formData.get("audio") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Keine Audiodatei ausgewählt." },
        { status: 400 }
      );
    }

    if (file.size > 200 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 200 MB erlaubt." },
        { status: 400 }
      );
    }

    await mkdir(TMP_DIR, { recursive: true });
    const ext = path.extname(file.name) || ".mp3";
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    const result = await transcribeWithCache(fileBuffer, file.name, file.type);

    if (!result.words || result.words.length === 0) {
      return NextResponse.json(
        { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." },
        { status: 400 }
      );
    }

    return NextResponse.json({ result, audioFilename: filename });
  } catch (e) {
    console.error("Transcription error:", e);
    return NextResponse.json(
      { error: "Fehler bei der Transkription. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
