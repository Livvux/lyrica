import path from "node:path";
import { createMediaResponse } from "../../../../lib/media-response";

export const runtime = "nodejs";
const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!filename.endsWith(".mp4")) {
    return Response.json(
      { error: "Invalid filename" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Keep exports for retries/resume. Existing cleanupTmpFiles() reclaims old
  // temporary files on subsequent upload/render requests (one-hour age limit).
  return createMediaResponse(request, {
    directory: TMP_DIR,
    filename,
    contentType: "video/mp4",
    download: true,
  });
}

export const HEAD = GET;
