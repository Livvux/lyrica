import path from "path";

/**
 * Strips directory components from a filename to prevent path traversal.
 * Returns only the base filename (e.g., "../../etc/passwd" → "passwd").
 */
export function sanitizeFilename(input: string): string {
  return path.basename(input);
}
