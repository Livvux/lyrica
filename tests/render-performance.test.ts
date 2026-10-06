import assert from "node:assert/strict";
import { test } from "node:test";
import { adaptPreviewQuality, initialPreviewQuality } from "../src/lib/preview-quality";
import type { QualitySample } from "../src/lib/preview-quality";
import { chooseRenderConcurrency, cpuQuotaLimit } from "../src/lib/render-resources";
import { flowingWavePath, sampleFrequency } from "../src/lib/visualizer-geometry";
import { VISUALIZER_PRESETS } from "../src/types/lyrics";

test("hardware hints start conservatively and work without deviceMemory", () => {
  assert.equal(initialPreviewQuality(4, 16), "low");
  assert.equal(initialPreviewQuality(12, 4), "low");
  assert.equal(initialPreviewQuality(12), "balanced");
});

test("adaptation needs sustained evidence and recovers without oscillating", () => {
  let state: QualitySample = { quality: "high", slowWindows: 0, healthyWindows: 0 };
  state = adaptPreviewQuality(state, 0.5);
  assert.equal(state.quality, "high");
  state = adaptPreviewQuality(state, 0.5);
  assert.equal(state.quality, "balanced");
  for (let i = 0; i < 5; i++) state = adaptPreviewQuality(state, 1);
  assert.equal(state.quality, "balanced");
  state = adaptPreviewQuality(state, 1);
  assert.equal(state.quality, "high");
  for (let i = 0; i < 20; i++) state = adaptPreviewQuality(state, 0.4);
  assert.equal(state.quality, "low");
});

test("container quotas support v1/v2 and unlimited values", () => {
  assert.equal(cpuQuotaLimit("200000 100000"), 2);
  assert.equal(cpuQuotaLimit("150000", "100000"), 1);
  assert.equal(cpuQuotaLimit("max 100000"), undefined);
  assert.equal(cpuQuotaLimit("-1", "100000"), undefined);
});

const machine = { cpus: 16, totalMb: 32768, availableMb: 24000, workerMb: 2000, durationSec: 30, hardCap: 10 };
test("export adapts to memory pressure, containers and long audio", () => {
  assert.equal(chooseRenderConcurrency(machine).concurrency, 10);
  assert.equal(chooseRenderConcurrency({ ...machine, availableMb: 4096 }).concurrency, 1);
  assert.equal(chooseRenderConcurrency({ ...machine, cpus: 2 }).concurrency, 1);
  assert.ok(chooseRenderConcurrency({ ...machine, durationSec: 7200 }).concurrency < 5);
  assert.equal(chooseRenderConcurrency({ ...machine, availableMb: 0 }).concurrency, 1);
});

test("explicit valid worker override is preserved, malformed overrides ignored", () => {
  assert.equal(chooseRenderConcurrency({ ...machine, override: "2" }).concurrency, 2);
  for (const override of ["0", "-1", "2oops", "1.5", "Infinity"]) {
    assert.equal(chooseRenderConcurrency({ ...machine, override }).overridden, false);
  }
});

test("presets activate audio-reactive visuals without replacing user media or lyrics", () => {
  assert.equal(VISUALIZER_PRESETS.length, 6);
  for (const { style } of VISUALIZER_PRESETS) {
    assert.ok(style.visualizerMode && style.visualizerMode !== "none");
    assert.equal(style.beatReactive, true);
    assert.equal(style.bgImage, undefined);
    assert.equal(style.customLogo, undefined);
    assert.equal(style.fontFamily, undefined);
  }
});


test("wave geometry is deterministic, smooth and bounded for silent and loud input", () => {
  for (const samples of [12, 18, 32, 64]) {
    for (const energy of [0, 1, 10]) {
      const data = Array.from({ length: 64 }, () => energy);
      const path = flowingWavePath(data, samples, 1.5, 4, 500, 0.2, energy);
      assert.equal(path, flowingWavePath(data, samples, 1.5, 4, 500, 0.2, energy));
      assert.ok(path.includes(" Q"));
      assert.ok(!/NaN|Infinity/.test(path));
      const coordinates = [...path.matchAll(/([\d.]+),([\d.]+)/g)];
      assert.ok(coordinates.every(([, x, y]) => Number(x) >= 0 && Number(x) <= 1920 && Number(y) >= 180 && Number(y) <= 972));
    }
  }
});

test("spectrum sampling includes low frequency bins and empty input is silent", () => {
  const bass = Array.from({ length: 64 }, (_, i) => i < 4 ? 1 : 0);
  assert.ok(sampleFrequency(bass, 2, 32, 2) > 0);
  assert.equal(sampleFrequency([], 0, 32, 2), 0);
});
