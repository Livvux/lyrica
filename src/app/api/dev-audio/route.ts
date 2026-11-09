import path from "node:path";
import { NextResponse } from "next/server";
import { createMediaResponse } from "@/lib/media-response";

/** Dev-only shortcut for the bundled example track; 404 in production. */
export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  return createMediaResponse(req, {
    directory: path.join(process.cwd(), "example"),
    filename: new URL(req.url).searchParams.get("name") ?? "",
    contentType: "audio/mpeg",
  });
}
