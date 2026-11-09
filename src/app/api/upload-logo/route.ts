import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { saveUpload } from "@/lib/save-upload";

const MAX_LOGO_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"]);

export async function POST(request: Request) {
  const clientIp = getClientIp(request);
  const limited = rateLimit("upload-logo", { windowMs: 60_000, max: 10, clientKey: clientIp });
  if (limited) return limited;
  try {
    const formData = await request.formData();
    const file = formData.get("logo");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Kein Logo" }, { status: 400 });
    }

    if (file.size > MAX_LOGO_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 5 MB." },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Nur Bilddateien erlaubt (PNG, SVG, JPG, WebP)." },
        { status: 400 }
      );
    }

    const filename = await saveUpload(file, ALLOWED_EXTS, ".png");

    return NextResponse.json({ filename });
  } catch (e) {
    console.error("Logo upload error:", e);
    return NextResponse.json({ error: "Upload fehlgeschlagen" }, { status: 500 });
  }
}
