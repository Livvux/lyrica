import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { saveUpload } from "@/lib/save-upload";

const MAX_BG_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".mp4", ".webm"]);

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limited = rateLimit("upload-bg", { windowMs: 60_000, max: 10, clientKey: clientIp });
  if (limited) return limited;
  try {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Kein Bild" }, { status: 400 });
    }

    if (file.size > MAX_BG_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 50 MB für Videos erlaubt." },
        { status: 400 }
      );
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      return NextResponse.json(
        { error: "Nur Bild- oder Videodateien erlaubt." },
        { status: 400 }
      );
    }

    const filename = await saveUpload(file, ALLOWED_EXTS, isVideo ? ".mp4" : ".jpg");

    return NextResponse.json({ filename });
  } catch (e) {
    console.error("Background upload error:", e);
    return NextResponse.json({ error: "Upload fehlgeschlagen" }, { status: 500 });
  }
}
