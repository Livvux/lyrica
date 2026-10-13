import path from "node:path";
import { createMediaResponse } from "../../../../lib/media-response";
import {requireActor,privateFailure} from "../../../../lib/private-render/server";
import {resolveOwnedMedia} from "../../../../lib/private-render/owned-media";

export const runtime = "nodejs";
const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  try {
  const actor=requireActor(request);
  if (!filename.endsWith(".mp4")) {
    return Response.json(
      { error: "Invalid filename" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  await resolveOwnedMedia(actor,filename);

  // Keep exports for retries/resume. Existing cleanupTmpFiles() reclaims old
  // temporary files on subsequent upload/render requests (one-hour age limit).
  return createMediaResponse(request, {
    directory: TMP_DIR,
    filename,
    contentType: "video/mp4",
    download: true,
  });
  }catch(error){return privateFailure(error);}
}

export const HEAD = GET;
