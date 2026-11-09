import OpenAI from "openai";
import Groq from "groq-sdk";
import { execFile } from "child_process";
import { createReadStream } from "fs";
import { stat, rm } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import type { TranscriptionResult, TranscriptionWord } from "@/types/lyrics";

const execFileAsync = promisify(execFile);

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25MB Groq/OpenAI limit
const CHUNK_DURATION_SEC = 600; // 10 minutes per chunk

/**
 * Known Whisper hallucination phrases that appear during silent/instrumental sections.
 * Matched case-insensitively after stripping punctuation.
 */
const HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thanks",
  "thanks for watching",
  "thanks for listening",
  "thank you for watching",
  "thank you for listening",
  "please subscribe",
  "subscribe",
  "like and subscribe",
  "see you next time",
  "see you in the next video",
  "bye",
  "goodbye",
  "subtitles by",
  "subtitles made by",
  "untertitel von",
  "untertitel der",
  "untertitelung",
  "copyright",
  "music",
  "musik",
  "applause",
  "laughter",
  "silence",
  "you",
  "the end",
]);

/** Patterns that indicate hallucinated content. */
const HALLUCINATION_PATTERNS = [
  /^\.+$/, // Just dots/periods
  /^\s*$/, // Empty/whitespace
  /^\[.*\]$/, // Bracketed annotations like [Music], [Applause]
  /^\(.*\)$/, // Parenthesized annotations
  /^♪+$/, // Music notes
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-zäöüß\s]/g, "").trim();
}

/** Check if a full transcription result is likely a hallucination. */
function isHallucinatedResult(result: TranscriptionResult): boolean {
  const norm = normalize(result.text);

  // Exact match against known phrases
  if (HALLUCINATION_PHRASES.has(norm)) return true;

  // Pattern match
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(result.text.trim())) return true;
  }

  // Very few words for a long chunk = likely hallucination
  // (e.g., 2 words for a 10-minute instrumental chunk)
  if (result.words.length <= 3 && result.durationSec > 30) return true;

  // Repeated single word/phrase (Whisper sometimes loops "Thank you. Thank you. Thank you.")
  if (result.words.length >= 2) {
    const uniqueWords = new Set(result.words.map((w) => normalize(w.word)));
    if (uniqueWords.size === 1 && result.words.length >= 2) return true;
  }

  return false;
}

/** Filter individual hallucinated words from a word array. */
function filterHallucinatedWords(words: TranscriptionWord[]): TranscriptionWord[] {
  return words.filter((w) => {
    const norm = normalize(w.word);
    // Remove empty words
    if (norm.length === 0) return false;
    // Remove bracketed/parenthesized annotations
    if (/^\[.*\]$/.test(w.word.trim()) || /^\(.*\)$/.test(w.word.trim())) return false;
    // Remove music note symbols
    if (/^♪+$/.test(w.word.trim())) return false;
    return true;
  });
}

/**
 * Compress audio to mono 64kbps MP3 for smaller upload size.
 * Whisper handles low-bitrate audio well — no quality loss for transcription.
 */
async function compressAudio(inputPath: string): Promise<string> {
  const outPath = path.join(TMP_DIR, `compressed-${randomUUID()}.mp3`);
  await execFileAsync("ffmpeg", [
    "-i", inputPath,
    "-ac", "1",
    "-b:a", "64k",
    "-f", "mp3",
    "-y", outPath,
  ]);
  return outPath;
}

/**
 * Split audio into time-based chunks for files that exceed the API limit even after compression.
 */
async function splitAudio(inputPath: string, durationSec: number): Promise<Segment[]> {
  const chunks: Segment[] = [];
  for (let offset = 0; offset < durationSec; offset += CHUNK_DURATION_SEC) {
    const chunkPath = path.join(TMP_DIR, `chunk-${randomUUID()}.mp3`);
    await execFileAsync("ffmpeg", [
      "-i", inputPath,
      "-ss", String(offset),
      "-t", String(CHUNK_DURATION_SEC),
      "-ac", "1",
      "-b:a", "64k",
      "-f", "mp3",
      "-y", chunkPath,
    ]);
    chunks.push({ path: chunkPath, offsetSec: offset, temporary: true });
  }
  return chunks;
}

/** Get audio duration in seconds via ffprobe. */
async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

/** Silently remove a temp file or directory tree. */
async function cleanup(target: string) {
  await rm(target, { recursive: true, force: true }).catch(() => {});
}

/**
 * Separate vocals from background using Demucs (htdemucs_ft model).
 * Returns { vocalsPath, outDir } on success, or null if Demucs is not installed or fails.
 * Falls back gracefully — the rest of the pipeline uses the original audio.
 */
async function separateVocals(inputPath: string): Promise<{ vocalsPath: string; outDir: string } | null> {
  const outDir = path.join(TMP_DIR, `demucs-${randomUUID()}`);
  const inputName = path.basename(inputPath, path.extname(inputPath));

  try {
    // Use absolute python path to avoid picking up a Homebrew python that doesn't have demucs.
    // Include /opt/homebrew/bin so Demucs can find ffmpeg on macOS Apple Silicon.
    const python = process.env.DEMUCS_PYTHON ?? "python3";
    const device = process.env.DEMUCS_DEVICE; // e.g. "mps" or "cuda" — omit for auto-detect
    const envPath = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}`;
    const args = [
      "-m", "demucs",
      "--two-stems=vocals",
      "-n", "htdemucs_ft",
      ...(device ? ["--device", device] : []),
      "-o", outDir,
      inputPath,
    ];
    await execFileAsync(python, args, { timeout: 600_000, env: { ...process.env, PATH: envPath } });

    const vocalsPath = path.join(outDir, "htdemucs_ft", inputName, "vocals.wav");
    await stat(vocalsPath); // verify output exists
    return { vocalsPath, outDir };
  } catch {
    await cleanup(outDir); // remove partial output on failure
    return null;
  }
}

interface Segment {
  path: string;
  offsetSec: number;
  temporary: boolean;
}

/**
 * Prepare audio for transcription API:
 * 1. If file <= 25MB, use as-is
 * 2. If > 25MB, compress to mono 64kbps
 * 3. If still > 25MB after compression, split into chunks
 */
async function prepareAudio(audioPath: string): Promise<Segment[]> {
  if ((await stat(audioPath)).size <= MAX_UPLOAD_SIZE) {
    return [{ path: audioPath, offsetSec: 0, temporary: false }];
  }

  const compressedPath = await compressAudio(audioPath);
  if ((await stat(compressedPath)).size <= MAX_UPLOAD_SIZE) {
    return [{ path: compressedPath, offsetSec: 0, temporary: true }];
  }

  // Compression wasn't enough — split into chunks
  try {
    return await splitAudio(compressedPath, await getAudioDuration(compressedPath));
  } finally {
    await cleanup(compressedPath);
  }
}

type RawTranscription = {
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
  duration?: number;
};

const transcribers: Record<TranscriptionResult["provider"], (audioPath: string) => Promise<RawTranscription>> = {
  openai: (audioPath) =>
    new OpenAI().audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    }),
  groq: async (audioPath) =>
    (await new Groq().audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    })) as unknown as RawTranscription,
};

/** Transcribe all segments, filter hallucinations, and merge with corrected timestamps. */
async function transcribeSegments(
  segments: Segment[],
  provider: TranscriptionResult["provider"]
): Promise<TranscriptionResult> {
  const allWords: TranscriptionWord[] = [];
  let totalDuration = 0;

  for (const segment of segments) {
    const raw = await transcribers[provider](segment.path);
    const result: TranscriptionResult = {
      text: raw.text,
      words: (raw.words ?? []).map((w) => ({ word: w.word, startSec: w.start, endSec: w.end })),
      durationSec: raw.duration ?? 0,
      provider,
    };
    totalDuration = Math.max(totalDuration, segment.offsetSec + result.durationSec);

    // Skip entire chunk if it's a hallucination (silent/instrumental section)
    if (segments.length > 1 && isHallucinatedResult(result)) continue;

    for (const word of filterHallucinatedWords(result.words)) {
      allWords.push({
        word: word.word,
        startSec: word.startSec + segment.offsetSec,
        endSec: word.endSec + segment.offsetSec,
      });
    }
  }

  return {
    text: allWords.map((w) => w.word).join(" "),
    words: allWords,
    durationSec: totalDuration,
    provider,
  };
}

/** Transcribe an audio file on disk with the configured provider (TRANSCRIPTION_PROVIDER). */
export async function transcribeFile(audioPath: string): Promise<TranscriptionResult> {
  const provider = process.env.TRANSCRIPTION_PROVIDER === "openai" ? "openai" : "groq";
  const vocals = await separateVocals(audioPath);
  let segments: Segment[] = [];
  try {
    segments = await prepareAudio(vocals?.vocalsPath ?? audioPath);
    return await transcribeSegments(segments, provider);
  } finally {
    for (const segment of segments) {
      if (segment.temporary) await cleanup(segment.path);
    }
    if (vocals) await cleanup(vocals.outDir);
  }
}
