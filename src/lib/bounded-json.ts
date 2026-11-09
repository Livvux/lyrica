export class BodyTooLargeError extends Error {}

/** Count streamed bytes before parsing; Content-Length alone is client-controlled. */
export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError("Request too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { return null; }
  } finally { reader.releaseLock(); }
}
