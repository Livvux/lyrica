export interface AudioAnalysis {
  version: 1;
  durationSec: number;
  sampleRate: number;
  envelopeRate: number;
  waveform: number[];
  low: number[];
  mid: number[];
  high: number[];
  /** Eight logarithmic frequency bands per envelope frame, flattened frame first. */
  spectrum: number[];
  onsets: number[];
  beats: number[];
  bpm: number | null;
  bpmConfidence: number;
}

export const ENVELOPE_RATE = 25;
export const SPECTRUM_BANDS = 8;
export const MAX_ANALYSIS_DURATION = 7200;

const rounded = (value: number) => Math.round(value * 10000) / 10000;

function normalize(values: number[], reference?: number): number[] {
  const sorted = reference === undefined ? [...values].sort((a, b) => a - b) : [];
  const ceiling = reference ?? sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (ceiling < 0.00001) return values.map(() => 0);
  return values.map((value) => rounded(Math.min(1, value / ceiling)));
}

function estimateTempo(onsets: number[]): { bpm: number | null; confidence: number; beats: number[] } {
  if (onsets.length < 4) return { bpm: null, confidence: 0, beats: [] };
  const histogram = new Float64Array(201);
  const intervals: number[] = [];
  // Adjacent intervals avoid treating every fast transient as a musical beat.
  for (let i = 1; i < onsets.length; i++) {
    const delta = onsets[i] - onsets[i - 1];
    if (delta < 0.25 || delta > 1.5) continue;
    let bpm = 60 / delta;
    while (bpm < 60) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    intervals.push(60 / bpm);
    const center = Math.round(bpm);
    for (let offset = -2; offset <= 2; offset++) {
      if (center + offset >= 60 && center + offset <= 200) histogram[center + offset] += 3 - Math.abs(offset);
    }
  }
  let winner = 0;
  for (let bpm = 60; bpm <= 200; bpm++) if (histogram[bpm] > histogram[winner]) winner = bpm;
  if (!winner) return { bpm: null, confidence: 0, beats: [] };
  // Average the winning interval neighbourhood to remove envelope-frame quantization bias.
  const cluster = intervals.filter((interval) => Math.abs(60 / interval - winner) <= winner * 0.12);
  if (cluster.length) winner = Math.round(60 / (cluster.reduce((sum, interval) => sum + interval, 0) / cluster.length));
  const interval = 60 / winner;
  let bestPhase = onsets[0];
  let bestMatches = 0;
  // Try a bounded number of onset phases; retain actual transients, never invent beats in silence.
  for (const phase of onsets.slice(0, 32)) {
    let matches = 0;
    for (const onset of onsets) {
      const offset = Math.abs((onset - phase) / interval - Math.round((onset - phase) / interval)) * interval;
      if (offset <= 0.075) matches++;
    }
    if (matches > bestMatches) { bestMatches = matches; bestPhase = phase; }
  }
  const confidence = bestMatches / onsets.length;
  if (confidence < 0.55) return { bpm: null, confidence: rounded(confidence), beats: [] };
  const beats = onsets.filter((onset) => Math.abs((onset - bestPhase) / interval - Math.round((onset - bestPhase) / interval)) * interval <= 0.075);
  return { bpm: winner, confidence: rounded(confidence), beats };
}

/** Bounded, deterministic FFT analysis. Run once in a worker, then reuse in preview and export. */
export function analyzeAudio(samples: Float32Array, sampleRate: number): AudioAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error("Ungültige Samplerate.");
  if (!samples.length || samples.length / sampleRate > MAX_ANALYSIS_DURATION) throw new Error("Audio muss zwischen 0 und 120 Minuten lang sein.");
  const durationSec = samples.length / sampleRate;
  const waveformCount = Math.min(2000, samples.length);
  const waveform = new Array<number>(waveformCount).fill(0);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? Math.min(1, Math.abs(samples[i])) : 0;
    const bin = Math.min(waveformCount - 1, Math.floor(i * waveformCount / samples.length));
    waveform[bin] = Math.max(waveform[bin], value);
    peak = Math.max(peak, value);
  }

  const size = 1024;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const reverse = new Uint16Array(size);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    let input = i;
    let output = 0;
    for (let bit = 0; bit < 10; bit++) { output = (output << 1) | (input & 1); input >>= 1; }
    reverse[i] = output;
    hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1));
  }
  const count = Math.ceil(durationSec * ENVELOPE_RATE);
  const low = new Array<number>(count);
  const mid = new Array<number>(count);
  const high = new Array<number>(count);
  const spectrum = new Array<number>(count * SPECTRUM_BANDS);
  const bandEdges = [0, 100, 200, 400, 800, 1600, 3200, 6400, sampleRate / 2];
  for (let frame = 0; frame < count; frame++) {
    const start = Math.round(frame * sampleRate / ENVELOPE_RATE);
    for (let i = 0; i < size; i++) {
      const sample = samples[start + i] ?? 0;
      real[reverse[i]] = (Number.isFinite(sample) ? sample : 0) * hann[i];
      imaginary[i] = 0;
    }
    for (let length = 2; length <= size; length *= 2) {
      const angle = -2 * Math.PI / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let offset = 0; offset < size; offset += length) {
        let wr = 1;
        let wi = 0;
        for (let j = 0; j < length / 2; j++) {
          const a = offset + j;
          const b = a + length / 2;
          const tr = wr * real[b] - wi * imaginary[b];
          const ti = wr * imaginary[b] + wi * real[b];
          real[b] = real[a] - tr;
          imaginary[b] = imaginary[a] - ti;
          real[a] += tr;
          imaginary[a] += ti;
          const nextWr = wr * stepReal - wi * stepImaginary;
          wi = wr * stepImaginary + wi * stepReal;
          wr = nextWr;
        }
      }
    }
    const energies = new Array<number>(SPECTRUM_BANDS).fill(0);
    let lower = 0;
    let middle = 0;
    let upper = 0;
    for (let bin = 1; bin < size / 2; bin++) {
      const frequency = bin * sampleRate / size;
      const energy = (real[bin] ** 2 + imaginary[bin] ** 2) / size ** 2;
      let band = 0;
      while (band < SPECTRUM_BANDS - 1 && frequency >= bandEdges[band + 1]) band++;
      energies[band] += energy;
      if (frequency < 200) lower += energy;
      else if (frequency < 2500) middle += energy;
      else upper += energy;
    }
    low[frame] = Math.sqrt(lower);
    mid[frame] = Math.sqrt(middle);
    high[frame] = Math.sqrt(upper);
    for (let band = 0; band < SPECTRUM_BANDS; band++) spectrum[frame * SPECTRUM_BANDS + band] = Math.sqrt(energies[band]);
  }

  // One common normalization preserves relative energy across bands.
  const total = low.map((value, index) => value + mid[index] + high[index]);
  const sorted = [...total].sort((a, b) => a - b);
  const reference = Math.max(0.00001, sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const flux = total.map((value, index) => index === 0 ? value / reference : (
    Math.max(0, low[index] - low[index - 1]) + Math.max(0, mid[index] - mid[index - 1]) + Math.max(0, high[index] - high[index - 1])
  ) / reference);
  const onsets: number[] = [];
  let trailing = 0;
  const window = Math.round(ENVELOPE_RATE * 0.6);
  for (let frame = 0; frame < flux.length; frame++) {
    const threshold = Math.max(0.08, trailing / Math.min(frame || 1, window) * 1.7);
    if (flux[frame] > threshold && flux[frame] >= (flux[frame - 1] ?? 0) && flux[frame] > (flux[frame + 1] ?? 0)) {
      const time = rounded(frame / ENVELOPE_RATE);
      if (!onsets.length || time - onsets[onsets.length - 1] >= 0.2) onsets.push(time);
    }
    trailing += flux[frame];
    if (frame >= window) trailing -= flux[frame - window];
  }
  const tempo = estimateTempo(onsets);
  return {
    version: 1, durationSec, sampleRate, envelopeRate: ENVELOPE_RATE,
    waveform: normalize(waveform, peak), low: normalize(low, reference), mid: normalize(mid, reference), high: normalize(high, reference),
    spectrum: normalize(spectrum, reference), onsets, beats: tempo.beats, bpm: tempo.bpm, bpmConfidence: tempo.confidence,
  };
}

export function envelopeAt(values: readonly number[], time: number, rate: number): number {
  const position = Math.max(0, time * rate);
  const index = Math.floor(position);
  if (index >= values.length) return 0;
  const a = values[index] ?? 0;
  const b = values[Math.min(index + 1, values.length - 1)] ?? 0;
  return a + (b - a) * (position - index);
}

export function transientPulse(events: readonly number[], time: number, decay = 0.14): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle] <= time) low = middle + 1;
    else high = middle;
  }
  if (!low) return 0;
  const elapsed = time - events[low - 1];
  return elapsed > decay * 8 ? 0 : Math.exp(-elapsed / decay);
}
