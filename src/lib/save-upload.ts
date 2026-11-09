import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import type { ReadableStream as NodeReadableStream } from "stream/web";
import { randomUUID } from "crypto";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

/**
 * Store an uploaded file under a random name in tmp/lyrica and return that name.
 * The extension is taken from the client name only if allowlisted. Streams to disk
 * instead of copying the whole upload into a second buffer.
 */
export async function saveUpload(file: File, allowedExts: ReadonlySet<string>, fallbackExt: string): Promise<string> {
  const rawExt = path.extname(file.name).toLowerCase();
  const filename = `${randomUUID()}${allowedExts.has(rawExt) ? rawExt : fallbackExt}`;
  await mkdir(TMP_DIR, { recursive: true });
  await writeFile(path.join(TMP_DIR, filename), Readable.fromWeb(file.stream() as NodeReadableStream<Uint8Array>));
  return filename;
}
