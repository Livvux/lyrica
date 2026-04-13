import { NextResponse } from "next/server";
import type { ReferenceLyrics, ReferenceLyricLine } from "@/types/lyrics";

export async function POST(req: Request) {
  let body: { artist?: string; title?: string; durationSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { artist, title, durationSec } = body;
  if (!artist || !title) {
    return NextResponse.json({ error: "artist and title required" }, { status: 400 });
  }

  // Try LRCLIB first (free, no auth, has synced lyrics)
  const lrcResult = await fetchFromLrclib(artist, title, durationSec);
  if (lrcResult) {
    return NextResponse.json({ lyrics: lrcResult });
  }

  // Fallback: lyrics.ovh (free, no auth, plain text only)
  const ovhResult = await fetchFromLyricsOvh(artist, title);
  if (ovhResult) {
    return NextResponse.json({ lyrics: ovhResult });
  }

  return NextResponse.json({ lyrics: null });
}

function lrclibDataToLyrics(data: {
  syncedLyrics?: string;
  plainLyrics?: string;
}): ReferenceLyrics | null {
  if (data.syncedLyrics) {
    return {
      source: "lrclib",
      synced: true,
      lines: parseLrc(data.syncedLyrics),
      plainText: data.plainLyrics ?? data.syncedLyrics,
    };
  }
  if (data.plainLyrics) {
    return {
      source: "lrclib",
      synced: false,
      lines: data.plainLyrics
        .split("\n")
        .filter((l: string) => l.trim().length > 0)
        .map((l: string) => ({ text: l.trim() })),
      plainText: data.plainLyrics,
    };
  }
  return null;
}

async function fetchFromLrclib(
  artist: string,
  title: string,
  durationSec?: number
): Promise<ReferenceLyrics | null> {
  try {
    // Try exact lookup first
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (durationSec) params.set("duration", String(Math.round(durationSec)));

    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { "User-Agent": "Lyrica/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = await res.json();
      const result = lrclibDataToLyrics(data);
      if (result) return result;
    }

    // Fallback: fuzzy search (helps with slightly off titles from filename parsing)
    const searchParams = new URLSearchParams({ artist_name: artist, track_name: title });
    const searchRes = await fetch(`https://lrclib.net/api/search?${searchParams}`, {
      headers: { "User-Agent": "Lyrica/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!searchRes.ok) return null;
    const results: Array<{ syncedLyrics?: string; plainLyrics?: string }> =
      await searchRes.json();
    if (!Array.isArray(results) || results.length === 0) return null;

    return lrclibDataToLyrics(results[0]);
  } catch {
    return null;
  }
}

async function fetchFromLyricsOvh(
  artist: string,
  title: string
): Promise<ReferenceLyrics | null> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.lyrics) return null;

    const text = data.lyrics.trim();
    return {
      source: "lyrics.ovh",
      synced: false,
      lines: text
        .split("\n")
        .filter((l: string) => l.trim().length > 0)
        .map((l: string) => ({ text: l.trim() })),
      plainText: text,
    };
  } catch {
    return null;
  }
}

/** Parse LRC format timestamps: [mm:ss.xx] text */
function parseLrc(lrc: string): ReferenceLyricLine[] {
  const lines: ReferenceLyricLine[] = [];

  for (const raw of lrc.split("\n")) {
    const match = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (!match) continue;
    const text = match[4].trim();
    if (text.length === 0) continue;

    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const ms = match[3].length === 2
      ? parseInt(match[3], 10) * 10
      : parseInt(match[3], 10);
    const startSec = min * 60 + sec + ms / 1000;

    lines.push({ text, startSec });
  }

  // Calculate endSec from next line's startSec
  for (let i = 0; i < lines.length - 1; i++) {
    lines[i].endSec = lines[i + 1].startSec;
  }
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    last.endSec = (last.startSec ?? 0) + 5;
  }

  return lines;
}
