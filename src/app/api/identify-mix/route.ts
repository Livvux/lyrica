import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { join } from "path";
import { unlink, stat } from "fs/promises";
import { randomUUID } from "crypto";
import { sanitizeFilename } from "@/lib/sanitize-filename";
import type { MixTrack } from "@/types/lyrics";

const TMP_DIR = join(process.cwd(), "tmp", "lyrica");
const ACOUSTID_API = "https://api.acoustid.org/v2/lookup";
const SAMPLE_INTERVAL_SEC = 60;
const SAMPLE_LENGTH_SEC = 20;

function getFpcalcPath(): string {
  return process.env.FPCALC_PATH ?? "fpcalc";
}

function execCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const out = await execCmd("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    audioPath,
  ]);
  return parseFloat(out.trim());
}

async function extractClip(
  audioPath: string,
  offsetSec: number,
  outPath: string
): Promise<void> {
  await execCmd("ffmpeg", [
    "-y", "-ss", String(offsetSec), "-t", String(SAMPLE_LENGTH_SEC),
    "-i", audioPath,
    "-ac", "1", "-ar", "44100",
    outPath,
  ]);
}

async function fingerprintClip(
  clipPath: string
): Promise<{ duration: number; fingerprint: string }> {
  const out = await execCmd(getFpcalcPath(), ["-json", clipPath]);
  return JSON.parse(out) as { duration: number; fingerprint: string };
}

async function queryAcoustid(
  fp: string,
  duration: number,
  apiKey: string
): Promise<{ id: string; title: string; artist: string } | null> {
  const params = new URLSearchParams({
    client: apiKey,
    meta: "recordings",
    fingerprint: fp,
    duration: String(Math.round(duration)),
  });
  const res = await fetch(`${ACOUSTID_API}?${params}`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;

  const data = await res.json() as {
    status: string;
    results?: Array<{
      recordings?: Array<{
        id: string;
        title?: string;
        artists?: Array<{ name: string }>;
      }>;
    }>;
  };

  if (data.status !== "ok" || !data.results?.length) return null;
  const rec = data.results[0].recordings?.[0];
  if (!rec) return null;
  return {
    id: rec.id,
    title: rec.title ?? "",
    artist: rec.artists?.[0]?.name ?? "",
  };
}

interface SampleResult {
  timestamp: number;
  recordingId: string | null;
  artist: string;
  title: string;
}

function clusterSamples(samples: SampleResult[], audioDuration: number): MixTrack[] {
  const tracks: MixTrack[] = [];
  let i = 0;

  while (i < samples.length) {
    const current = samples[i];
    if (!current.recordingId) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < samples.length && samples[j].recordingId === current.recordingId) {
      j++;
    }
    tracks.push({
      startSec: current.timestamp,
      endSec: j < samples.length ? samples[j].timestamp : audioDuration,
      artist: current.artist,
      title: current.title,
      recordingId: current.recordingId,
    });
    i = j;
  }

  return tracks;
}

export async function POST(req: Request) {
  const apiKey = process.env.ACOUSTID_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ACOUSTID_API_KEY not configured" },
      { status: 503 }
    );
  }

  let body: { audioFilename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { audioFilename } = body;
  if (!audioFilename || typeof audioFilename !== "string") {
    return NextResponse.json({ error: "audioFilename required" }, { status: 400 });
  }

  const safe = sanitizeFilename(audioFilename);
  const audioPath = join(TMP_DIR, safe);
  try {
    await stat(audioPath);
  } catch {
    return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
  }

  let duration: number;
  try {
    duration = await getAudioDuration(audioPath);
  } catch {
    return NextResponse.json({ error: "Could not read audio duration" }, { status: 500 });
  }

  const offsets: number[] = [];
  for (let t = 0; t + SAMPLE_LENGTH_SEC <= duration; t += SAMPLE_INTERVAL_SEC) {
    offsets.push(t);
  }
  if (offsets.length === 0) offsets.push(0);

  const samples: SampleResult[] = [];

  for (const offset of offsets) {
    const clipPath = join(TMP_DIR, `mix-${randomUUID()}.wav`);
    try {
      await extractClip(audioPath, offset, clipPath);
      const fp = await fingerprintClip(clipPath);
      const recording = await queryAcoustid(fp.fingerprint, fp.duration, apiKey);
      samples.push({
        timestamp: offset,
        recordingId: recording?.id ?? null,
        artist: recording?.artist ?? "",
        title: recording?.title ?? "",
      });
    } catch {
      samples.push({ timestamp: offset, recordingId: null, artist: "", title: "" });
    } finally {
      unlink(clipPath).catch(() => {});
    }
    // AcoustID rate limit: ≤3 req/s
    await new Promise<void>((r) => setTimeout(r, 350));
  }

  const tracks = clusterSamples(samples, duration);
  return NextResponse.json({ tracks });
}
