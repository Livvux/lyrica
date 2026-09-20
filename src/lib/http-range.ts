export type ByteRange = { start: number; end: number };

/**
 * Parse a single HTTP byte range. null means ignore the header and send 200;
 * "unsatisfiable" means send 416. Multipart responses are deliberately unsupported.
 */
export function parseByteRange(
  header: string | null,
  size: number
): ByteRange | "unsatisfiable" | null {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError("File size must be a non-negative safe integer");
  }
  if (header === null) return null;

  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  // Ignore malformed, unknown-unit and multi-range headers rather than serving
  // an arbitrary substring as a valid single range (RFC 9110, section 14).
  if (!match || (!match[1] && !match[2])) return null;
  if (size === 0) return "unsatisfiable";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (suffixLength === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  // Huge decimal values may become Infinity. Oversized starts are unsatisfiable;
  // oversized ends/suffixes are clamped above, without unsafe file offsets.
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
