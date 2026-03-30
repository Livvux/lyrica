import type { TranscriptionWord, LyricLine } from "@/types/lyrics";

const FPS = 30;
const FADE_FRAMES = 10;

// Visual line length limits (character count) for consistent display at ~76px
const MAX_CHARS_PER_LINE = 40;
const IDEAL_CHARS_PER_LINE = 22;

// Pause thresholds — tuned for songs where even short pauses are meaningful
const FORCE_BREAK_PAUSE_SEC = 0.6; // Always break on pauses >= 0.6s
const STRONG_PAUSE_SEC = 0.3; // Strongly prefer breaking here
const MILD_PAUSE_SEC = 0.15; // Slight preference for breaking here

// Words that should NOT end a line — they belong with the next word
const NEVER_END_WITH = new Set([
  // English articles, prepositions, conjunctions, pronouns, auxiliaries
  "i", "a", "an", "the", "to", "in", "on", "at", "of", "for", "and", "but",
  "or", "so", "my", "your", "his", "her", "its", "our", "their", "is", "am",
  "are", "was", "were", "be", "do", "not", "no", "with", "from", "by", "as",
  "if", "than", "that", "this", "it",
  // German articles, prepositions, conjunctions, pronouns
  "ich", "du", "er", "sie", "es", "wir", "ihr", "ein", "eine", "einer",
  "einem", "einen", "der", "die", "das", "den", "dem", "des", "und", "oder",
  "aber", "doch", "zu", "in", "an", "auf", "mit", "fuer", "für", "von",
  "bei", "nach", "ueber", "über", "mein", "dein", "sein", "unser", "euer",
  "nicht", "kein", "keine", "ob", "wenn", "weil", "dass", "als",
]);

/**
 * Known Whisper hallucination phrases that appear during silent/instrumental sections.
 * Checked after lines are formed to catch full-line hallucinations like "Thank you."
 */
export const HALLUCINATED_LINES = new Set([
  "thank you",
  "thank you.",
  "thanks",
  "thanks.",
  "thanks for watching",
  "thanks for watching.",
  "thanks for listening",
  "thanks for listening.",
  "thank you for watching",
  "thank you for watching.",
  "thank you for listening",
  "thank you for listening.",
  "please subscribe",
  "please subscribe.",
  "subscribe",
  "like and subscribe",
  "see you next time",
  "see you next time.",
  "see you in the next video",
  "bye",
  "bye.",
  "goodbye",
  "goodbye.",
  "subtitles by",
  "untertitel von",
  "copyright",
  "the end",
  "the end.",
  "you",
  "you.",
]);

function isHallucinatedLine(text: string): boolean {
  const norm = text.toLowerCase().trim();
  if (HALLUCINATED_LINES.has(norm)) return true;
  // Bracketed/parenthesized annotations
  if (/^\[.*\]$/.test(norm) || /^\(.*\)$/.test(norm)) return true;
  // Just punctuation or music notes
  if (/^[.!?,;:\s♪]+$/.test(norm)) return true;
  return false;
}

function secToFrame(sec: number): number {
  return Math.round(sec * FPS);
}

/** Check if a word starts with an uppercase letter (new phrase signal in lyrics). */
function startsWithUppercase(word: string): boolean {
  const first = word.charAt(0);
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Calculate a "break desirability" score at position i (after word i, before word i+1).
 * Higher = better place to break. Negative = avoid breaking here.
 */
function breakScore(
  words: TranscriptionWord[],
  i: number,
  lineCharsSoFar: number,
  lineWordCount: number
): number {
  if (i >= words.length - 1) return 0;

  const word = words[i];
  const nextWord = words[i + 1];
  const pauseSec = nextWord.startSec - word.endSec;
  let score = 0;

  // --- Pause-based scoring (tuned for songs) ---
  if (pauseSec >= FORCE_BREAK_PAUSE_SEC) {
    score += 100; // Force break
  } else if (pauseSec >= STRONG_PAUSE_SEC) {
    score += 35 + (pauseSec - STRONG_PAUSE_SEC) * 60;
  } else if (pauseSec >= MILD_PAUSE_SEC) {
    score += 12 + (pauseSec - MILD_PAUSE_SEC) * 50;
  }

  // --- New phrase detection: next word starts with uppercase ---
  // In lyrics, a capitalized word after a lowercase word strongly signals a new line
  if (startsWithUppercase(nextWord.word) && !startsWithUppercase(word.word)) {
    score += 25;
  }
  // Even if current word is also capitalized, a pause + uppercase is still a signal
  if (startsWithUppercase(nextWord.word) && pauseSec >= MILD_PAUSE_SEC) {
    score += 15;
  }

  // --- Punctuation scoring ---
  if (/[.!?]$/.test(word.word)) {
    score += 50; // Strong punctuation = strong break
  } else if (/[,;:]$/.test(word.word)) {
    score += 12; // Weak punctuation = moderate preference
  }

  // --- Avoid breaking after function words ---
  const lower = word.word.toLowerCase().replace(/[^a-zäöüß]/g, "");
  if (NEVER_END_WITH.has(lower)) {
    score -= 25;
  }

  // --- Line length scoring ---
  if (lineCharsSoFar >= MAX_CHARS_PER_LINE) {
    score += 40; // Line is too long, strongly prefer breaking
  } else if (lineCharsSoFar >= IDEAL_CHARS_PER_LINE) {
    // Gradually increase break preference as we approach max
    score += ((lineCharsSoFar - IDEAL_CHARS_PER_LINE) / (MAX_CHARS_PER_LINE - IDEAL_CHARS_PER_LINE)) * 20;
  }

  // --- Avoid very short lines (orphan prevention) ---
  if (lineWordCount <= 1) {
    score -= 15; // Don't break after just 1 word unless there's a strong reason
  } else if (lineWordCount === 2 && lineCharsSoFar < 10) {
    score -= 8; // Very short 2-word line
  }

  return score;
}

/**
 * Group transcription words into lyric lines using a scoring-based algorithm
 * optimized for song lyrics.
 *
 * Evaluates each potential break point based on:
 * - Pause duration between words (even short pauses matter in songs)
 * - New phrase detection (uppercase after lowercase = new line)
 * - Punctuation type (period/! > comma)
 * - Visual line length (character count, not word count)
 * - Phrase coherence (never break after articles/prepositions)
 */
export function groupWordsIntoLines(words: TranscriptionWord[]): LyricLine[] {
  if (words.length === 0) return [];

  const lines: LyricLine[] = [];
  let currentWords: TranscriptionWord[] = [];
  let currentChars = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    currentWords.push(word);
    currentChars += (currentChars > 0 ? 1 : 0) + word.word.length; // +1 for space

    const isLast = i === words.length - 1;

    if (isLast) {
      flushLine();
      continue;
    }

    const score = breakScore(words, i, currentChars, currentWords.length);

    // Break if score is positive enough, or force break on very long lines
    const shouldBreak =
      score >= 100 || // Force break (long pause)
      (score >= 20 && currentChars >= IDEAL_CHARS_PER_LINE) || // Good break point + decent length
      (score >= 15 && currentChars >= MAX_CHARS_PER_LINE) || // Moderate break + line too long
      currentChars >= MAX_CHARS_PER_LINE + 10; // Emergency: line way too long

    if (shouldBreak) {
      flushLine();
    }
  }

  function flushLine() {
    if (currentWords.length === 0) return;
    const first = currentWords[0];
    const last = currentWords[currentWords.length - 1];
    const text = currentWords.map((w) => w.word).join(" ");

    lines.push({
      text,
      startSec: first.startSec,
      endSec: last.endSec,
      startFrame: Math.max(0, secToFrame(first.startSec) - FADE_FRAMES),
      endFrame: secToFrame(last.endSec) + FADE_FRAMES,
    });

    currentWords = [];
    currentChars = 0;
  }

  // Remove hallucinated lines (e.g. "Thank you." from silent sections)
  const filtered = lines.filter((line) => !isHallucinatedLine(line.text));

  // Prevent overlapping: clamp each line's fade so it doesn't bleed into neighbors
  for (let i = 0; i < filtered.length - 1; i++) {
    const current = filtered[i];
    const next = filtered[i + 1];
    if (current.endFrame > next.startFrame) {
      const mid = Math.round((current.endFrame + next.startFrame) / 2);
      current.endFrame = mid;
      next.startFrame = mid;
    }
  }

  return filtered;
}

export function getDurationInFrames(durationSec: number): number {
  return Math.ceil(durationSec * FPS);
}
