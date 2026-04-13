import { NextResponse } from "next/server";

/**
 * Parse "Artist - Title (feat. X).mp3" → { artist, title } or null.
 */
function parseFilename(filename: string): { artist: string; title: string } | null {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  const match = base.match(/^(.+?)\s+-\s+(.+?)(?:\s+\(feat\..+\))?$/i);
  if (!match) return null;
  const artist = match[1].trim();
  const title = match[2].trim().replace(/\s*\(feat\..+\)/i, "").trim();
  if (!artist || !title) return null;
  return { artist, title };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns true if LRCLIB's result is close enough to what we parsed. */
function isCloseMatch(parsed: string, canonical: string): boolean {
  const a = normalize(parsed);
  const b = normalize(canonical);
  return a === b || a.includes(b) || b.includes(a);
}

/** Look up canonical metadata from LRCLIB to confirm and normalise the filename parse. */
async function searchLrclib(
  artist: string,
  title: string
): Promise<{ artist: string; title: string; album?: string } | null> {
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { "User-Agent": "Lyrica/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const results: Array<{ artistName: string; trackName: string; albumName?: string }> =
      await res.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    const top = results[0];

    // Reject if LRCLIB returned something completely unrelated (e.g. for mixes)
    if (!isCloseMatch(artist, top.artistName) && !isCloseMatch(title, top.trackName)) {
      return null;
    }

    return {
      artist: top.artistName,
      title: top.trackName,
      album: top.albumName ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { originalFilename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { originalFilename } = body;
  const parsed = originalFilename ? parseFilename(originalFilename) : null;

  if (!parsed) {
    return NextResponse.json({ match: null });
  }

  // Try LRCLIB to get canonical metadata; fall back to raw filename parse
  const canonical = await searchLrclib(parsed.artist, parsed.title);
  return NextResponse.json({ match: canonical ?? parsed });
}
