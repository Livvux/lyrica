import { readFileSync } from "fs";
import Groq from "groq-sdk";

const AUDIO_PATH = "/Users/livvux/Downloads/Forever Yours (Latest).mp3";
const FPS = 30;
const MAX_WORDS_PER_LINE = 7;
const PAUSE_THRESHOLD_SEC = 0.5;
const FADE_FRAMES = 10;

interface Word { word: string; start: number; end: number }
interface LyricLine { text: string; startFrame: number; endFrame: number; startSec: number; endSec: number }

function groupWordsIntoLines(words: Word[]): LyricLine[] {
  if (words.length === 0) return [];
  const lines: LyricLine[] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);
    const isLast = i === words.length - 1;
    const next = words[i + 1];
    const hasLongPause = next != null && next.start - word.end > PAUSE_THRESHOLD_SEC;
    const endsWithPunct = /[.!?,;:]$/.test(word.word);
    const lineIsFull = current.length >= MAX_WORDS_PER_LINE;

    if (isLast || hasLongPause || endsWithPunct || lineIsFull) {
      const first = current[0];
      const last = current[current.length - 1];
      lines.push({
        text: current.map(w => w.word).join(" "),
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
  console.log("=== LYRICA E2E TEST ===\n");

  // Step 1: Transcribe
  console.log("1. Transcribing audio...");
  const client = new Groq();
  const audioBuffer = readFileSync(AUDIO_PATH);
  const file = new File([audioBuffer], "test.mp3", { type: "audio/mpeg" });

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

  console.log(`   Duration: ${raw.duration}s`);
  console.log(`   Words: ${raw.words?.length ?? 0}`);

  // Step 2: Group into lines
  console.log("\n2. Grouping words into lyric lines...");
  const lines = groupWordsIntoLines(raw.words ?? []);
  console.log(`   Lines: ${lines.length}`);

  // Step 3: Show first 10 lines
  console.log("\n3. First 10 lyric lines:");
  lines.slice(0, 10).forEach((l, i) => {
    console.log(`   ${i + 1}. "${l.text}" [${l.startSec.toFixed(1)}s - ${l.endSec.toFixed(1)}s] frames ${l.startFrame}-${l.endFrame}`);
  });

  // Step 4: VideoConfig
  const durationInFrames = Math.ceil((raw.duration ?? 0) * FPS);
  console.log(`\n4. VideoConfig:`);
  console.log(`   durationInFrames: ${durationInFrames}`);
  console.log(`   fps: ${FPS}`);
  console.log(`   resolution: 1920x1080`);
  console.log(`   lines: ${lines.length}`);

  // Step 5: Verify page loads
  console.log("\n5. Checking dev server...");
  const res = await fetch("http://localhost:3000");
  console.log(`   HTTP ${res.status} (${res.ok ? "OK" : "FAIL"})`);

  console.log("\n=== TEST COMPLETE ===");
}

main().catch(console.error);
