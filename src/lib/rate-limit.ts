import { NextResponse } from "next/server";

const hits = new Map<string, number[]>();
const MAX_BUCKETS = 5000;

/**
 * Simple in-memory sliding-window rate limiter.
 * Returns null if allowed, or a 429 Response if limit exceeded.
 */
export function rateLimit(
  key: string,
  { windowMs, max, clientKey = "global" }: { windowMs: number; max: number; clientKey?: string }
): NextResponse | null {
  const now = Date.now();
  const bucketKey = `${key}:${clientKey}`;
  const timestamps = hits.get(bucketKey) ?? [];

  // Remove expired entries
  const valid = timestamps.filter((t) => now - t < windowMs);

  if (valid.length >= max) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429 }
    );
  }

  valid.push(now);
  hits.set(bucketKey, valid);

  // Prevent memory leak: purge stale keys periodically
  if (hits.size > MAX_BUCKETS) {
    for (const [k, v] of hits) {
      if (v.length === 0 || v.every((t) => now - t >= windowMs * 2)) {
        hits.delete(k);
      }
    }
  }

  return null;
}
