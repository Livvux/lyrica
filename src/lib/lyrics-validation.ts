import type {
  LyricLine,
  ReferenceLyrics,
  LineValidation,
  ValidationResult,
  SongMatch,
} from "@/types/lyrics";
import { HALLUCINATED_LINES } from "@/lib/timing";

/** Normalize text for comparison: lowercase, strip punctuation, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract bigrams from a string for Dice coefficient. */
function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const norm = normalizeText(text);
  for (let i = 0; i < norm.length - 1; i++) {
    const pair = norm.slice(i, i + 2);
    map.set(pair, (map.get(pair) ?? 0) + 1);
  }
  return map;
}

/** Dice coefficient similarity between two strings (0-1). */
export function compareLine(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (normA === normB) return 1;
  if (normA.length < 2 || normB.length < 2) return 0;

  const biA = bigrams(a);
  const biB = bigrams(b);

  let intersection = 0;
  for (const [pair, count] of biA) {
    intersection += Math.min(count, biB.get(pair) ?? 0);
  }

  let sizeA = 0;
  for (const count of biA.values()) sizeA += count;
  let sizeB = 0;
  for (const count of biB.values()) sizeB += count;

  return (2 * intersection) / (sizeA + sizeB);
}

/** Find best matching reference line for a transcribed line by timestamp or index. */
function matchReferenceLine(
  line: LyricLine,
  lineIndex: number,
  reference: ReferenceLyrics
): string | undefined {
  if (reference.lines.length === 0) return undefined;

  // If synced: find closest by start time
  if (reference.synced) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < reference.lines.length; i++) {
      const refStart = reference.lines[i].startSec;
      if (refStart == null) continue;
      const dist = Math.abs(line.startSec - refStart);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return reference.lines[bestIdx].text;
  }

  // Unsynced: sequential index match
  if (lineIndex < reference.lines.length) {
    return reference.lines[lineIndex].text;
  }
  return undefined;
}

/** Basic quality checks for lines without reference lyrics. */
function basicChecks(lines: LyricLine[]): LineValidation[] {
  const validations: LineValidation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text.trim();
    let issue: LineValidation["issue"] | undefined;

    if (text.length === 0) {
      issue = "empty";
    } else if (text.length < 2) {
      issue = "short";
    } else if (HALLUCINATED_LINES.has(text.toLowerCase())) {
      issue = "hallucination";
    } else if (
      i >= 3 &&
      normalizeText(text) === normalizeText(lines[i - 1].text) &&
      normalizeText(text) === normalizeText(lines[i - 2].text) &&
      normalizeText(text) === normalizeText(lines[i - 3].text)
    ) {
      issue = "repeated";
    }

    validations.push({
      lineIndex: i,
      similarity: issue ? 0 : 1,
      issue,
    });
  }

  return validations;
}

/** Calculate overall quality score from line validations (0-100). */
function calculateScore(validations: LineValidation[]): number {
  if (validations.length === 0) return 100;
  const total = validations.reduce((sum, v) => sum + v.similarity, 0);
  return Math.round((total / validations.length) * 100);
}

/** Validate transcribed lines against optional reference lyrics. */
export function validateLines(
  lines: LyricLine[],
  songMatch: SongMatch | null,
  reference: ReferenceLyrics | null
): ValidationResult {
  if (!reference) {
    const lineValidations = basicChecks(lines);
    return {
      songMatch,
      reference: null,
      overallScore: calculateScore(lineValidations),
      lineValidations,
    };
  }

  const lineValidations: LineValidation[] = lines.map((line, i) => {
    const refText = matchReferenceLine(line, i, reference);
    if (!refText) {
      return { lineIndex: i, similarity: 1 };
    }
    return {
      lineIndex: i,
      similarity: compareLine(line.text, refText),
      referenceLine: refText,
    };
  });

  return {
    songMatch,
    reference,
    overallScore: calculateScore(lineValidations),
    lineValidations,
  };
}

/** Apply reference corrections to lines: replace text where similarity < threshold, keep timing. */
export function applyCorrections(
  lines: LyricLine[],
  validations: LineValidation[],
  threshold: number
): LyricLine[] {
  return lines.map((line, i) => {
    const v = validations[i];
    if (v?.referenceLine && v.similarity < threshold) {
      return { ...line, text: v.referenceLine };
    }
    return line;
  });
}

/** Apply reference text to all lines, keeping timing from transcription. */
export function applyAllReference(
  lines: LyricLine[],
  validations: LineValidation[]
): LyricLine[] {
  return lines.map((line, i) => {
    const v = validations[i];
    if (v?.referenceLine) {
      return { ...line, text: v.referenceLine };
    }
    return line;
  });
}

/** Auto-fix basic quality issues: remove empty, short, and hallucinated lines. */
export function autoFixLines(
  lines: LyricLine[],
  validations: LineValidation[]
): LyricLine[] {
  return lines.filter((_, i) => {
    const v = validations[i];
    return !v?.issue || v.issue === "repeated";
  });
}
