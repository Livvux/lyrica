import { NextResponse } from "next/server";

const hits = new Map<string, number[]>();

/**
 * Simple in-memory sliding-window rate limiter.
 * Returns null if allowed, or a 429 Response if limit exceeded.
 */
export function rateLimit(
  key: string,
  { windowMs, max }: { windowMs: number; max: number }
): NextResponse | null {
  const now = Date.now();
  const timestamps = hits.get(key) ?? [];

  // Remove expired entries
  const valid = timestamps.filter((t) => now - t < windowMs);

  if (valid.length >= max) {
    return NextResponse.json(
      { error: "Zu viele Anfragen. Bitte kurz warten." },
      { status: 429 }
    );
  }

  valid.push(now);
  hits.set(key, valid);

  // Prevent memory leak: purge stale keys periodically
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }

  return null;
}
