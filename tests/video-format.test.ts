import assert from "node:assert/strict";
import { test } from "node:test";
import { ASPECT_RATIOS, dimensionsForAspectRatio, getRenderPlan } from "../src/lib/video-format";

const source = { width: 1920, height: 1080, fps: 30, durationInFrames: 900 };

test("all four social formats keep their exact aspect ratio in standard and draft output", () => {
  const draft = [[1280, 720], [720, 1280], [720, 720], [720, 900]];
  Object.keys(ASPECT_RATIOS).forEach((key, index) => {
    const dimensions = dimensionsForAspectRatio(key as keyof typeof ASPECT_RATIOS);
    const standard = getRenderPlan({ ...source, ...dimensions }, 30);
    assert.deepEqual([standard.outputWidth, standard.outputHeight], [dimensions.width, dimensions.height]);
    const fast = getRenderPlan({ ...source, ...dimensions }, 24, 2 / 3);
    assert.deepEqual([fast.outputWidth, fast.outputHeight], draft[index]);
    assert.equal(fast.outputWidth / fast.outputHeight, dimensions.width / dimensions.height);
    assert.equal(fast.durationInFrames, 720);
    assert.deepEqual(fast.frameRange, [0, 719]);
  });
});

test("clip selection keeps the original source clock at 30 and 24 fps", () => {
  const config = { ...source, clipStartFrame: 90, clipEndFrame: 240 };
  assert.deepEqual(getRenderPlan(config, 30).frameRange, [90, 239]);
  assert.deepEqual(getRenderPlan(config, 24).frameRange, [72, 191]);
  assert.equal(getRenderPlan(config, 24).exportedFrameCount / 24, 5);
  assert.equal(getRenderPlan(config, 30).durationInFrames, 900);
});

test("one-frame clips and source endpoints remain within rendered composition", () => {
  for (let start = 0; start < source.durationInFrames; start++) {
    const plan = getRenderPlan({ ...source, clipStartFrame: start, clipEndFrame: start + 1 }, 24);
    assert.equal(plan.exportedFrameCount, 1);
    assert.ok(plan.frameRange[0] >= 0);
    assert.ok(plan.frameRange[1] < plan.durationInFrames);
  }
  const plan = getRenderPlan({ ...source, durationInFrames: 901 }, 24);
  assert.deepEqual(plan.frameRange, [0, 720]);
});

test("legacy custom even sizes stay renderable if draft scaling would produce odd pixels", () => {
  const plan = getRenderPlan({ ...source, width: 1282, height: 722 }, 24, 2 / 3);
  assert.equal(plan.scale, 1);
  assert.deepEqual([plan.outputWidth, plan.outputHeight], [1282, 722]);
});

test("invalid or out-of-track clip selections are rejected before rendering", () => {
  for (const clip of [
    { clipStartFrame: -1 }, { clipEndFrame: 0 },
    { clipStartFrame: 300, clipEndFrame: 299 },
    { clipEndFrame: 901 }, { clipStartFrame: NaN }, { clipEndFrame: Infinity },
  ]) assert.throws(() => getRenderPlan({ ...source, ...clip }, 30));
});
