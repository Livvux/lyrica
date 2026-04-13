function normalizeIp(candidate: string | null): string | null {
  if (!candidate) return null;
  const value = candidate.trim().replace(/^\[|\]$/g, "");
  if (!value) return null;
  // Accept common IPv4/IPv6 text forms only.
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return null;
  return value.slice(0, 64);
}

export function getClientIp(request: Request): string {
  const directHeaders = [
    "x-real-ip",
    "cf-connecting-ip",
    "x-vercel-forwarded-for",
  ] as const;
  for (const header of directHeaders) {
    const fromHeader = normalizeIp(request.headers.get(header));
    if (fromHeader) return fromHeader;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((part) => part.trim()).filter(Boolean);
    // Use the first valid client hop when no trusted platform header is present.
    for (const part of parts) {
      const clientHop = normalizeIp(part);
      if (clientHop) return clientHop;
    }
  }

  return "local";
}
