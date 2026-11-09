import { NextResponse } from "next/server";
import { cleanupTmpFiles } from "@/lib/cleanup-tmp";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { saveUpload } from "@/lib/save-upload";

const MAX_AUDIO_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav",
  "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/webm",
  "audio/ogg", "audio/flac", "video/mp4",
]);
const ALLOWED_EXTS = new Set([".mp3", ".wav", ".m4a", ".webm", ".mp4", ".ogg", ".flac"]);

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limited = rateLimit("upload-audio", { windowMs: 60_000, max: 10, clientKey: clientIp });
  if (limited) return limited;

  // Clean up old tmp files (non-blocking)
  cleanupTmpFiles();

  try {
    const formData = await request.formData();
    const file = formData.get("audio");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Keine Audiodatei ausgewählt." },
        { status: 400 }
      );
    }

    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 100 MB erlaubt." },
        { status: 400 }
      );
    }

    if (file.type && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Nur Audiodateien erlaubt (MP3, WAV, M4A, WebM)." },
        { status: 400 }
      );
    }

    const filename = await saveUpload(file, ALLOWED_EXTS, ".mp3");

    return NextResponse.json({ audioFilename: filename });
  } catch (e) {
    console.error("Upload error:", e);
    return NextResponse.json(
      { error: "Fehler beim Hochladen. Bitte erneut versuchen." },
      { status: 500 }
    );
  }
}
