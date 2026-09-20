import { open, type FileHandle } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { parseByteRange } from "./http-range";

const BUFFER_BYTES = 64 * 1024;

/** Set an explicit byte-sized queue budget, independent of runtime defaults. */
export function toByteWebStream(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream, {
    strategy: {
      highWaterMark: BUFFER_BYTES,
      size: (chunk: Uint8Array) => chunk.byteLength,
    },
  }) as ReadableStream<Uint8Array>;
}

interface MediaResponseOptions {
  directory: string;
  filename: string;
  contentType: string;
  download?: boolean;
}

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Serve GET/HEAD from one opened descriptor, with bounded buffering and cancellation. */
export async function createMediaResponse(
  request: Request,
  { directory, filename, contentType, download = false }: MediaResponseOptions
): Promise<Response> {
  // Route params are already URL-decoded. Reject directory aliases on both OSes,
  // instead of silently mapping traversal-like input to an existing basename.
  if (!filename || filename === "." || filename === ".." || /[/\\\0]/.test(filename)) {
    return errorResponse("Invalid filename", 400);
  }
  if (request.signal.aborted) {
    return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
  }

  let file: FileHandle | undefined;
  let nodeStream: ReadStream | undefined;
  try {
    // Open before stat: metadata and streamed bytes must refer to the same file.
    file = await open(path.join(directory, filename), "r");
    const stats = await file.stat();
    if (!stats.isFile()) return errorResponse("Datei nicht gefunden", 404);

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Length": String(stats.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": download ? "private, no-store" : "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    if (download) {
      headers.set("Content-Disposition", 'attachment; filename="lyrica-video.mp4"');
    }

    // Range only applies to GET. A failed/unknown If-Range validator requires
    // the complete representation; these temporary files don't expose validators.
    const range = request.method === "GET" && !request.headers.has("if-range")
      ? parseByteRange(request.headers.get("range"), stats.size)
      : null;
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${stats.size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${stats.size}`);
      headers.set("Content-Length", String(range.end - range.start + 1));
    }
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "HEAD" || stats.size === 0) {
      return new Response(null, { headers });
    }

    nodeStream = file.createReadStream({
      autoClose: true,
      highWaterMark: BUFFER_BYTES,
      // Bound full responses to the size advertised, even if the file grows.
      start: range?.start ?? 0,
      end: range?.end ?? stats.size - 1,
      signal: request.signal,
    });
    const response = new Response(toByteWebStream(nodeStream), {
      status: range ? 206 : 200,
      headers,
    });
    // The stream now owns the descriptor: autoClose handles EOF, errors and
    // cancellation. Never unlink here; interrupted downloads must be retryable.
    file = undefined;
    return response;
  } catch (error) {
    nodeStream?.destroy();
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      return errorResponse("Datei nicht gefunden", 404);
    }
    console.error("[media] Failed to open media file:", error);
    return errorResponse("Datei konnte nicht gelesen werden", 500);
  } finally {
    // HEAD, empty files, invalid ranges and errors never transfer ownership.
    await file?.close();
  }
}
