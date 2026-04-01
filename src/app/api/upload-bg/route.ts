import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Kein Bild" }, { status: 400 });
    }

    if (file.size > 50 * 1024 * 1024) {
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

    await mkdir(TMP_DIR, { recursive: true });
    const ALLOWED_EXTS = new Set([
      ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif",
      ".mp4", ".webm",
    ]);
    const rawExt = path.extname(file.name).toLowerCase() || (isVideo ? ".mp4" : ".jpg");
    const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : (isVideo ? ".mp4" : ".jpg");
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return NextResponse.json({ filename });
  } catch {
    return NextResponse.json({ error: "Upload fehlgeschlagen" }, { status: 500 });
  }
}
