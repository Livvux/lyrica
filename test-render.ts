import { readFileSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import Groq from "groq-sdk";

const AUDIO_PATH = "/Users/livvux/Downloads/Blussi (1).mp3";
const OUTPUT_DIR = path.join(process.cwd(), "tmp", "lyrica");
const FPS = 30;
const MAX_WORDS_PER_LINE = 7;
const PAUSE_THRESHOLD_SEC = 0.5;
const FADE_FRAMES = 10;

interface Word {
  word: string;
  start: number;
  end: number;
}
interface LyricLine {
  text: string;
  startFrame: number;
  endFrame: number;
  startSec: number;
  endSec: number;
}

function groupWordsIntoLines(words: Word[]): LyricLine[] {
  if (words.length === 0) return [];
  const lines: LyricLine[] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);
    const isLast = i === words.length - 1;
    const next = words[i + 1];
    const hasLongPause =
      next != null && next.start - word.end > PAUSE_THRESHOLD_SEC;
    const endsWithPunct = /[.!?,;:]$/.test(word.word);
    const lineIsFull = current.length >= MAX_WORDS_PER_LINE;

    if (isLast || hasLongPause || endsWithPunct || lineIsFull) {
      const first = current[0];
      const last = current[current.length - 1];
      lines.push({
        text: current.map((w) => w.word).join(" "),
        startSec: first.start,
        endSec: last.end,
        startFrame: Math.max(0, Math.round(first.start * FPS) - FADE_FRAMES),
        endFrame: Math.round(last.end * FPS) + FADE_FRAMES,
      });
      current = [];
    }
  }
  return lines;
}

async function main() {
  console.log("=== LYRICA RENDER TEST ===\n");

  // 1. Transcribe
  console.log("1. Transcribing...");
  const client = new Groq();
  const audioBuffer = readFileSync(AUDIO_PATH);
  const file = new File([audioBuffer], "blussi.mp3", { type: "audio/mpeg" });

  const response = await client.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const raw = response as unknown as {
    text: string;
    words?: Word[];
    duration?: number;
  };

  console.log(`   ${raw.words?.length} words, ${raw.duration}s`);

  // 2. Group into lines
  const lines = groupWordsIntoLines(raw.words ?? []);
  console.log(`\n2. ${lines.length} lyric lines created`);
  lines.slice(0, 5).forEach((l, i) =>
    console.log(`   ${i + 1}. "${l.text}" [${l.startSec.toFixed(1)}s-${l.endSec.toFixed(1)}s]`)
  );

  // 3. Save audio + config for render
  await mkdir(OUTPUT_DIR, { recursive: true });
  const audioPath = path.join(OUTPUT_DIR, "test-audio.mp3");
  await writeFile(audioPath, audioBuffer);

  const durationInFrames = Math.ceil((raw.duration ?? 0) * FPS);
  const config = {
    lines,
    audioUrl: "/test-audio.mp3",
    bgImage: "/bg-default.jpg",
    durationInFrames,
    fps: 30 as const,
    width: 1920 as const,
    height: 1080 as const,
  };

  // Save config for debugging
  await writeFile(
    path.join(OUTPUT_DIR, "test-config.json"),
    JSON.stringify(config, null, 2)
  );

  console.log(`\n3. Config saved to ${OUTPUT_DIR}/test-config.json`);
  console.log(`   Duration: ${durationInFrames} frames (${(durationInFrames / 30).toFixed(1)}s)`);

  // 4. Render MP4
  console.log("\n4. Rendering MP4...");
  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  const entryPoint = path.join(process.cwd(), "src/remotion/index.ts");
  console.log("   Bundling...");
  const bundleLocation = await bundle({
    entryPoint,
    webpackOverride: (c) => ({
      ...c,
      resolve: {
        ...c.resolve,
        alias: {
          ...(c.resolve?.alias ?? {}),
          "@": path.join(process.cwd(), "src"),
        },
      },
    }),
  });

  console.log("   Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "LyricsVideo",
    inputProps: config as unknown as Record<string, unknown>,
  });

  const outputPath = path.join(OUTPUT_DIR, "lyrica-test-output.mp4");
  console.log("   Rendering...");
  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: config as unknown as Record<string, unknown>,
  });

  console.log(`\n=== DONE ===`);
  console.log(`MP4 saved to: ${outputPath}`);
}

main().catch(console.error);
