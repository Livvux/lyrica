import OpenAI from "openai";
import Groq from "groq-sdk";
import { execFile } from "child_process";
import { writeFile, readFile, unlink, mkdir, stat } from "fs/promises";
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

interface TranscriptionProvider {
  transcribe(audioFile: File): Promise<TranscriptionResult>;
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
 * Returns array of { chunkPath, offsetSec }.
 */
async function splitAudio(inputPath: string, durationSec: number): Promise<Array<{ chunkPath: string; offsetSec: number }>> {
  const chunks: Array<{ chunkPath: string; offsetSec: number }> = [];
  let offset = 0;

  while (offset < durationSec) {
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
    chunks.push({ chunkPath, offsetSec: offset });
    offset += CHUNK_DURATION_SEC;
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

/** Create a File object from a path on disk. */
async function fileFromPath(filePath: string, name: string): Promise<File> {
  const buffer = await readFile(filePath);
  return new File([buffer], name, { type: "audio/mpeg" });
}

/** Silently remove a temp file. */
async function cleanup(filePath: string) {
  try { await unlink(filePath); } catch { /* ignore */ }
}

/**
 * Prepare audio for transcription API:
 * 1. If file <= 25MB, use as-is
 * 2. If > 25MB, compress to mono 64kbps
 * 3. If still > 25MB after compression, split into chunks
 */
async function prepareAudio(audioFile: File): Promise<Array<{ file: File; offsetSec: number; tempPath?: string }>> {
  // Small files: send directly
  if (audioFile.size <= MAX_UPLOAD_SIZE) {
    return [{ file: audioFile, offsetSec: 0 }];
  }

  // Write to disk for ffmpeg processing
  await mkdir(TMP_DIR, { recursive: true });
  const inputPath = path.join(TMP_DIR, `input-${randomUUID()}.mp3`);
  const buffer = Buffer.from(await audioFile.arrayBuffer());
  await writeFile(inputPath, buffer);

  // Try compression first
  const compressedPath = await compressAudio(inputPath);
  const compressedStat = await stat(compressedPath);
  await cleanup(inputPath);

  if (compressedStat.size <= MAX_UPLOAD_SIZE) {
    const file = await fileFromPath(compressedPath, "audio.mp3");
    return [{ file, offsetSec: 0, tempPath: compressedPath }];
  }

  // Compression wasn't enough — split into chunks
  const durationSec = await getAudioDuration(compressedPath);
  const chunks = await splitAudio(compressedPath, durationSec);
  await cleanup(compressedPath);

  const results: Array<{ file: File; offsetSec: number; tempPath: string }> = [];
  for (const chunk of chunks) {
    const file = await fileFromPath(chunk.chunkPath, "chunk.mp3");
    results.push({ file, offsetSec: chunk.offsetSec, tempPath: chunk.chunkPath });
  }

  return results;
}

function createOpenAIProvider(): TranscriptionProvider {
  const client = new OpenAI();

  async function transcribeSingle(audioFile: File): Promise<TranscriptionResult> {
    const response = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const words: TranscriptionWord[] = (response.words ?? []).map((w) => ({
      word: w.word,
      startSec: w.start,
      endSec: w.end,
    }));

    return {
      text: response.text,
      words,
      durationSec: response.duration ?? 0,
      provider: "openai",
    };
  }

  return {
    async transcribe(audioFile: File): Promise<TranscriptionResult> {
      const segments = await prepareAudio(audioFile);
      try {
        return await transcribeAndMerge(segments, transcribeSingle, "openai");
      } finally {
        for (const seg of segments) {
          if (seg.tempPath) await cleanup(seg.tempPath);
        }
      }
    },
  };
}

function createGroqProvider(): TranscriptionProvider {
  const client = new Groq();

  async function transcribeSingle(audioFile: File): Promise<TranscriptionResult> {
    const response = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const raw = response as unknown as {
      text: string;
      words?: Array<{ word: string; start: number; end: number }>;
      duration?: number;
    };

    const words: TranscriptionWord[] = (raw.words ?? []).map((w) => ({
      word: w.word,
      startSec: w.start,
      endSec: w.end,
    }));

    return {
      text: raw.text,
      words,
      durationSec: raw.duration ?? 0,
      provider: "groq",
    };
  }

  return {
    async transcribe(audioFile: File): Promise<TranscriptionResult> {
      const segments = await prepareAudio(audioFile);
      try {
        return await transcribeAndMerge(segments, transcribeSingle, "groq");
      } finally {
        for (const seg of segments) {
          if (seg.tempPath) await cleanup(seg.tempPath);
        }
      }
    },
  };
}

/** Transcribe all segments, filter hallucinations, and merge with corrected timestamps. */
async function transcribeAndMerge(
  segments: Array<{ file: File; offsetSec: number; tempPath?: string }>,
  transcribeFn: (file: File) => Promise<TranscriptionResult>,
  provider: "openai" | "groq"
): Promise<TranscriptionResult> {
  if (segments.length === 1) {
    const result = await transcribeFn(segments[0].file);
    result.words = filterHallucinatedWords(result.words);
    result.text = result.words.map((w) => w.word).join(" ");
    return result;
  }

  const allWords: TranscriptionWord[] = [];
  const allTexts: string[] = [];
  let totalDuration = 0;

  for (const segment of segments) {
    const result = await transcribeFn(segment.file);
    totalDuration = Math.max(totalDuration, segment.offsetSec + result.durationSec);

    // Skip entire chunk if it's a hallucination (silent/instrumental section)
    if (isHallucinatedResult(result)) {
      console.log(`Skipping hallucinated chunk at offset ${segment.offsetSec}s: "${result.text.slice(0, 50)}"`);
      continue;
    }

    const filteredWords = filterHallucinatedWords(result.words);
    allTexts.push(filteredWords.map((w) => w.word).join(" "));

    for (const word of filteredWords) {
      allWords.push({
        word: word.word,
        startSec: word.startSec + segment.offsetSec,
        endSec: word.endSec + segment.offsetSec,
      });
    }
  }

  return {
    text: allTexts.join(" "),
    words: allWords,
    durationSec: totalDuration,
    provider,
  };
}

export function getProvider(name?: string): TranscriptionProvider {
  const providerName = name ?? process.env.TRANSCRIPTION_PROVIDER ?? "groq";

  switch (providerName) {
    case "openai":
      return createOpenAIProvider();
    case "groq":
    default:
      return createGroqProvider();
  }
}
