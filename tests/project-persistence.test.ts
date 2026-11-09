import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectSchema, loadPersistence, savePersistence } from "../src/lib/use-persistence";
import { DEFAULT_STYLE } from "../src/types/lyrics";

const legacy = { lines: [], audioUrl: "/api/audio/song.mp3", durationSec: 10, style: DEFAULT_STYLE, lyricsActive: false };

test("legacy sessions migrate additively without replacing user styles", () => {
  const saved = ProjectSchema.parse({ ...legacy, style: { textColor: "#22d3ee" } });
  assert.equal(saved.aspectRatio, "16:9");
  assert.equal(saved.clip, null);
  assert.equal(saved.beatSensitivity, 1);
  assert.equal(saved.style.textColor, "#22d3ee");
  assert.deepEqual(saved.style.waveConfig, DEFAULT_STYLE.waveConfig);
});

test("invalid sessions, unsafe URLs and out-of-song clips cannot be restored", () => {
  for (const patch of [{ durationSec: -1 }, { audioUrl: "//other.test/audio" }, { clip: { startFrame: 50, endFrame: 40 } }, { clip: { startFrame: 0, endFrame: 301 } }, { style: { bgImage: "/\\other.test/x" } }]) {
    assert.equal(ProjectSchema.safeParse({ ...legacy, ...patch }).success, false);
  }
});

test("autosave reports storage failure and never destroys the previous value", () => {
  let raw: string | null = null;
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => raw,
    setItem: (_key: string, value: string) => { if (fail) throw new Error("quota"); raw = value; },
  }});
  const state = ProjectSchema.parse(legacy);
  assert.equal(savePersistence(state), true);
  fail = true;
  assert.equal(savePersistence({ ...state, aspectRatio: "9:16" }), false);
  assert.equal(loadPersistence()?.aspectRatio, "16:9");
  raw = "broken json";
  assert.equal(loadPersistence(), null);
  Reflect.deleteProperty(globalThis, "localStorage");
});
