import path from "node:path";
import { createMediaResponse } from "../../../../lib/media-response";

export const runtime = "nodejs";
const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  return createMediaResponse(request, {
    directory: TMP_DIR,
    filename,
    contentType: MIME_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
  });
}

export const HEAD = GET;
