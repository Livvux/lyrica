import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { startServerPerf } from "@/lib/perf";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function POST(request: Request) {
  const perf = startServerPerf("api.upload-logo");
  const clientIp = getClientIp(request);
  const limited = rateLimit("upload-logo", { windowMs: 60_000, max: 10, clientKey: clientIp });
  if (limited) {
    perf({ status: 429, clientIp });
    return limited;
  }
  try {
    const formData = await request.formData();
    const file = formData.get("logo") as File | null;

    if (!file) {
      perf({ status: 400, reason: "missing-file", clientIp });
      return NextResponse.json({ error: "Kein Logo" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      perf({ status: 400, reason: "file-too-large", clientIp });
      return NextResponse.json(
        { error: "Datei zu groß. Maximal 5 MB." },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      perf({ status: 400, reason: "invalid-type", clientIp, fileType: file.type });
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

    perf({
      status: 200,
      clientIp,
      fileType: file.type || "unknown",
      fileSizeMb: (file.size / (1024 * 1024)).toFixed(2),
    });
    return NextResponse.json({ filename });
  } catch {
    perf({ status: 500, clientIp });
    return NextResponse.json({ error: "Upload fehlgeschlagen" }, { status: 500 });
  }
}
