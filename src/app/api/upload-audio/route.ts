import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  // Clean up old tmp files (non-blocking)
  cleanupTmpFiles();

  try {
    const formData = await request.formData();
    const file = formData.get("audio") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Keine Audiodatei ausgewählt." },
        { status: 400 }
      );
    }

    if (file.size > 500 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 500 MB erlaubt." },
        { status: 400 }
      );
    }

    const ALLOWED_AUDIO_TYPES = new Set([
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
      "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm",
      "audio/ogg", "audio/flac", "video/mp4",
    ]);
    if (file.type && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Nur Audiodateien erlaubt (MP3, WAV, M4A, WebM)." },
        { status: 400 }
      );
    }

    await mkdir(TMP_DIR, { recursive: true });
    const ALLOWED_EXTS = new Set([".mp3", ".wav", ".m4a", ".webm", ".mp4", ".ogg", ".flac"]);
    const rawExt = path.extname(file.name).toLowerCase() || ".mp3";
    const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : ".mp3";
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return NextResponse.json({ audioFilename: filename });
  } catch (e) {
    console.error("Upload error:", e);
    return NextResponse.json(
      { error: "Fehler beim Hochladen. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
