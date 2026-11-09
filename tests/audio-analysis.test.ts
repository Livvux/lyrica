import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAudio, envelopeAt, transientPulse, ENVELOPE_RATE, SPECTRUM_BANDS } from "../src/lib/audio-analysis";
import { AudioAnalysisSchema } from "../src/lib/audio-analysis-schema";

const sampleRate = 22050;

function clicks(duration: number, interval: number): Float32Array {
  const result = new Float32Array(sampleRate * duration);
  for (let time = 0.5; time < duration; time += interval) {
    const start = Math.round(time * sampleRate);
    for (let i = 0; i < sampleRate * 0.035 && start + i < result.length; i++) {
      result[start + i] = Math.sin(2 * Math.PI * 90 * i / sampleRate) * Math.exp(-i / (sampleRate * 0.008));
    }
  }
  return result;
}

test("silence stays silent without fabricated tempo or events", () => {
  const analysis = analyzeAudio(new Float32Array(sampleRate * 3), sampleRate);
  assert.equal(analysis.bpm, null);
  assert.equal(analysis.bpmConfidence, 0);
  assert.deepEqual(analysis.beats, []);
  assert.deepEqual(analysis.onsets, []);
  assert.ok([...analysis.low, ...analysis.mid, ...analysis.high, ...analysis.spectrum].every((value) => value === 0));
});

test("regular kick transients produce useful 120 BPM timing", () => {
  const analysis = analyzeAudio(clicks(10, 0.5), sampleRate);
  assert.ok(analysis.bpm !== null && Math.abs(analysis.bpm - 120) <= 2, `BPM: ${analysis.bpm}`);
  assert.ok(analysis.bpmConfidence > 0.8);
  assert.ok(analysis.beats.length >= 16, `beats: ${analysis.beats.length}`);
  for (const event of analysis.beats) {
    const closest = Math.round(event * 2) / 2;
    assert.ok(Math.abs(closest - event) <= 0.06, `${event} differs from transient ${closest}`);
  }
});

test("spectrum retains frequency differences with shared band normalization", () => {
  for (const [frequency, expected] of [[90, "low"], [1000, "mid"], [6000, "high"]] as const) {
    const tone = Float32Array.from({ length: sampleRate * 2 }, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5);
    const analysis = analyzeAudio(tone, sampleRate);
    const energies = { low: analysis.low[10], mid: analysis.mid[10], high: analysis.high[10] };
    assert.ok(energies[expected] > 0.9, `${frequency}: ${JSON.stringify(energies)}`);
    for (const band of ["low", "mid", "high"] as const) if (band !== expected) assert.ok(energies[band] < 0.05);
  }
});

test("analysis is deterministic, bounded, serializable, and handles partial final frames", () => {
  const pcm = clicks(3, 0.5).subarray(0, sampleRate * 3 - 11);
  const a = analyzeAudio(pcm, sampleRate);
  assert.deepEqual(a, analyzeAudio(pcm, sampleRate));
  const count = Math.ceil(a.durationSec * ENVELOPE_RATE);
  assert.equal(a.low.length, count);
  assert.equal(a.mid.length, count);
  assert.equal(a.high.length, count);
  assert.equal(a.spectrum.length, count * SPECTRUM_BANDS);
  assert.ok(a.waveform.length <= 2000);
  assert.ok([...a.waveform, ...a.low, ...a.mid, ...a.high, ...a.spectrum].every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test("invalid audio metadata is rejected before allocating envelopes", () => {
  for (const rate of [0, -1, Infinity, NaN, 7999, 192001]) assert.throws(() => analyzeAudio(new Float32Array(1), rate));
  assert.throws(() => analyzeAudio(new Float32Array(0), sampleRate));
});

test("frame sampling interpolates smoothly and transient release depends only on source time", () => {
  assert.equal(envelopeAt([0, 1, 0], 0.5, 1), 0.5);
  assert.equal(envelopeAt([0, 1, 0], 4, 1), 0);
  assert.equal(transientPulse([1, 2], 0.5), 0);
  assert.equal(transientPulse([1, 2], 1), 1);
  assert.equal(transientPulse([1, 2], 2), 1);
  assert.ok(transientPulse([1, 2], 1.14) > 0.36 && transientPulse([1, 2], 1.14) < 0.38);
  assert.equal(transientPulse([1, 2], 10), 0);
});

test("render boundary rejects non-finite, mismatched and unordered analysis data", () => {
  const analysis = analyzeAudio(clicks(3, 0.5), sampleRate);
  assert.ok(AudioAnalysisSchema.safeParse(analysis).success);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, low: [] }).success, false);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, spectrum: analysis.spectrum.slice(1) }).success, false);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, low: analysis.low.map(() => NaN) }).success, false);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, beats: [2, 1] }).success, false);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, beats: [1, 1] }).success, false);
  assert.equal(AudioAnalysisSchema.safeParse({ ...analysis, beats: [4] }).success, false);
});
