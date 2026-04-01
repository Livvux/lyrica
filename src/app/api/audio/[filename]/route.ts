import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
  ".mp4": "audio/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  if (filename.includes("..") || filename.includes("/")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(TMP_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  try {
    const fileStats = await stat(filePath);
    const totalSize = fileStats.size;
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }

      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start > end || start >= totalSize) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }

      const clampedEnd = Math.min(end, totalSize - 1);
      const chunkSize = clampedEnd - start + 1;
      const buffer = await readFile(filePath);
      const chunk = buffer.subarray(start, clampedEnd + 1);

      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${clampedEnd}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(totalSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });
  }
}
