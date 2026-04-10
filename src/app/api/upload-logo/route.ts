import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { rateLimit } from "@/lib/rate-limit";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const limited = rateLimit("upload-logo", { windowMs: 60_000, max: 10 });
  if (limited) return limited;
  try {
    const formData = await request.formData();
    const file = formData.get("logo") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Kein Logo" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
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

    await mkdir(TMP_DIR, { recursive: true });
    const ALLOWED_EXTS = new Set([".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif"]);
    const rawExt = path.extname(file.name).toLowerCase();
    const ext = ALLOWED_EXTS.has(rawExt) ? rawExt : ".png";
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    return NextResponse.json({ filename });
  } catch {
    return NextResponse.json({ error: "Upload fehlgeschlagen" }, { status: 500 });
  }
}
