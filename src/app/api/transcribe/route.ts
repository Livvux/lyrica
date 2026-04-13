import { NextResponse } from "next/server";
import { writeFile, mkdir, readFile, stat } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { getProvider } from "@/lib/transcription";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { startServerPerf } from "@/lib/perf";
import type { TranscriptionResult } from "@/types/lyrics";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const CACHE_DIR = path.join(process.cwd(), "tmp", "lyrica", "cache");
const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;

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

async function hashFilePath(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => resolve(hash.digest("hex").slice(0, 16)));
  });
}

async function transcribeWithCache(
  hash: string,
  createFile: () => Promise<File>
): Promise<{ result: TranscriptionResult; cacheHit: boolean }> {
  const cached = await getCachedResult(hash);
  if (cached) {
    return { result: cached, cacheHit: true };
  }

  const file = await createFile();
  const provider = getProvider();
  const result = await provider.transcribe(file);
  await setCachedResult(hash, result);
  return { result, cacheHit: false };
}

export async function POST(request: Request) {
  const perf = startServerPerf("api.transcribe");
  const clientIp = getClientIp(request);
  const limited = rateLimit("transcribe", { windowMs: 60_000, max: 5, clientKey: clientIp });
  if (limited) {
    perf({ status: 429, clientIp });
    return limited;
  }

  try {
    const formData = await request.formData();

    // Mode 1: Transcribe an already-uploaded file by filename
    const existingFilename = formData.get("audioFilename") as string | null;
    if (existingFilename) {
      const safeName = path.basename(existingFilename);
      const filePath = path.join(TMP_DIR, safeName);
      const fileStat = await stat(filePath);
      const hash = await hashFilePath(filePath);
      const ext = path.extname(safeName).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".webm": "audio/webm",
        ".mp4": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
      };

      const { result, cacheHit } = await transcribeWithCache(hash, async () => {
        const buffer = await readFile(filePath);
        return new File([buffer], safeName, {
          type: mimeMap[ext] || "audio/mpeg",
        });
      });

      if (!result.words || result.words.length === 0) {
        perf({
          status: 400,
          reason: "no-words",
          clientIp,
          cacheHit,
          fileSizeMb: (fileStat.size / (1024 * 1024)).toFixed(1),
        });
        return NextResponse.json(
          { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." },
          { status: 400 }
        );
      }

      perf({
        status: 200,
        mode: "filename",
        clientIp,
        cacheHit,
        fileSizeMb: (fileStat.size / (1024 * 1024)).toFixed(1),
        wordCount: result.words.length,
      });
      return NextResponse.json({ result });
    }

    // Mode 2: Upload + transcribe in one step (original flow)
    const file = formData.get("audio") as File | null;

    if (!file) {
      perf({ status: 400, reason: "missing-file", clientIp });
      return NextResponse.json(
        { error: "Keine Audiodatei ausgewählt." },
        { status: 400 }
      );
    }

    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      perf({ status: 400, reason: "file-too-large", clientIp });
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 100 MB erlaubt." },
        { status: 400 }
      );
    }

    await mkdir(TMP_DIR, { recursive: true });
    const ext = path.extname(file.name) || ".mp3";
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    const hash = hashBuffer(fileBuffer);
    const { result, cacheHit } = await transcribeWithCache(hash, async () => {
      return new File([new Uint8Array(fileBuffer)], file.name, {
        type: file.type || "audio/mpeg",
      });
    });

    if (!result.words || result.words.length === 0) {
      perf({
        status: 400,
        reason: "no-words",
        mode: "upload",
        clientIp,
        cacheHit,
        fileSizeMb: (file.size / (1024 * 1024)).toFixed(1),
      });
      return NextResponse.json(
        { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." },
        { status: 400 }
      );
    }

    perf({
      status: 200,
      mode: "upload",
      clientIp,
      cacheHit,
      fileSizeMb: (file.size / (1024 * 1024)).toFixed(1),
      wordCount: result.words.length,
    });
    return NextResponse.json({ result, audioFilename: filename });
  } catch (e) {
    console.error("Transcription error:", e);
    perf({ status: 500, clientIp });
    return NextResponse.json(
      { error: "Fehler bei der Transkription. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
