import { test } from "node:test";
import assert from "node:assert/strict";
import { clampClip, editLineTiming, snapFrame, waveformPeaks } from "../src/lib/timeline";
import type { LyricLine } from "../src/types/lyrics";

function line(start: number, end: number): LyricLine {
  return { text: "hello", startFrame: start, endFrame: end, startSec: start / 30, endSec: end / 30,
    words: [{ word: "hello", startSec: (start + 3) / 30, endSec: (end - 3) / 30 }] };
}

test("moving a line clamps to neighbours and shifts karaoke words without mutating input", () => {
  const lines = [line(0, 30), line(60, 90), line(120, 150)];
  const result = editLineTiming(lines, 1, "move", 110, 180, 30);
  assert.equal(result[1].startFrame, 90);
  assert.equal(result[1].endFrame, 120);
  assert.equal(result[1].startSec, 3);
  assert.equal(result[1].words?.[0].startSec, 3.1);
  assert.equal(lines[1].startFrame, 60);
  assert.equal(result[0], lines[0]);
  assert.equal(editLineTiming(lines, 1, "move", -10, 180, 30)[1].startFrame, 30);
});

test("resizing scales word timing and guarantees at least one frame", () => {
  const original = [line(30, 90)];
  const result = editLineTiming(original, 0, "end", 150, 180, 30)[0];
  assert.equal(result.endSec, 5);
  assert.ok(Math.abs(result.words![0].startSec - 1.2) < 1e-10);
  assert.ok(Math.abs(result.words![0].endSec - 4.8) < 1e-10);
  assert.equal(editLineTiming(original, 0, "end", 0, 180, 30)[0].endFrame, 31);
  assert.equal(editLineTiming(original, 0, "start", 180, 180, 30)[0].startFrame, 89);
});

test("snap chooses closest boundary only within its pixel-derived frame threshold", () => {
  assert.equal(snapFrame(33.2, [0, 30, 60], 5), 30);
  assert.equal(snapFrame(36, [0, 30, 60], 5), 36);
  assert.equal(snapFrame(58, [0, 30, 60], 5), 60);
});

test("invalid edits and no-op edits preserve state identity", () => {
  const lines = [line(30, 60)];
  assert.equal(editLineTiming(lines, 0, "move", 30, 90, 30), lines);
  assert.equal(editLineTiming(lines, 0, "end", NaN, 90, 30), lines);
  assert.equal(editLineTiming(lines, 2, "end", 30, 90, 30), lines);
});

test("clip limits are frame accurate and end is exclusive", () => {
  assert.deepEqual(clampClip({ startFrame: -1, endFrame: 999 }, 300), { startFrame: 0, endFrame: 300 });
  assert.deepEqual(clampClip({ startFrame: 999, endFrame: -1 }, 300), { startFrame: 299, endFrame: 300 });
  assert.deepEqual(clampClip({ startFrame: 10, endFrame: 11 }, 300), { startFrame: 10, endFrame: 11 });
});

test("waveform aggregation bounds geometry and retains short transients", () => {
  const samples = Array.from({ length: 10000 }, (_, i) => i === 1234 ? 1 : 0);
  const peaks = waveformPeaks(samples);
  assert.equal(peaks.length, 1600);
  assert.equal(Math.max(...peaks), 1);
  assert.deepEqual(waveformPeaks([NaN, Infinity, -0.5, 2]), [0, 0, 0.5, 1]);
  assert.deepEqual(waveformPeaks([]), []);
});
