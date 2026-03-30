import { NextResponse } from "next/server";
import { stat, unlink } from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  if (!filename.endsWith(".mp4") || filename.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filePath = path.join(TMP_DIR, filename);

  try {
    const fileStat = await stat(filePath);

    const nodeStream = createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    // Clean up after stream is fully consumed
    nodeStream.on("close", () => {
      unlink(filePath).catch(() => {});
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": `attachment; filename="lyrica-video.mp4"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });
  }
}
