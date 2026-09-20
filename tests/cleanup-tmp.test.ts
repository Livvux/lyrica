import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { mock, test } from "node:test";
import { cleanupTmpFiles } from "../src/lib/cleanup-tmp";

// Exercise the real cleanup with a synthetic 1,000-file directory. No filesystem
// data or actual time needs to change, and every patch is restored at the end.
test("cleanup bounds work, coalesces callers, throttles scans and preserves retention rules", async (t) => {
  let now = 10_000_000;
  let active = 0;
  let peak = 0;
  const deleted: string[] = [];
  const names = Array.from({ length: 1000 }, (_, index) => `${index}.mp4`);
  const clock = mock.method(Date, "now", () => now);
  const listing = mock.method(fs, "readdir", async () => names);
  const stats = mock.method(fs, "stat", async (filename: string) => {
    active++;
    peak = Math.max(peak, active);
    await setImmediate();
    active--;
    const name = path.basename(filename);
    if (name === "2.mp4") throw new Error("File disappeared");
    return { isFile: () => name !== "1.mp4", mtimeMs: name === "0.mp4" ? now : now - 3_600_001 };
  });
  const unlink = mock.method(fs, "unlink", async (filename: string) => {
    deleted.push(path.basename(filename));
    if (path.basename(filename) === "3.mp4") throw new Error("File already removed");
  });

  try {
    await Promise.all([cleanupTmpFiles(), cleanupTmpFiles(), cleanupTmpFiles()]);
    assert.equal(listing.mock.callCount(), 1, "Concurrent callers share one scan");
    assert.equal(stats.mock.callCount(), 1000);
    assert.ok(peak > 1 && peak <= 32, `Peak pending filesystem tasks: ${peak}`);
    assert.equal(deleted.length, 997);
    assert.ok(!deleted.includes("0.mp4"), "Fresh files must survive");
    assert.ok(!deleted.includes("1.mp4"), "Directories must survive");
    assert.ok(!deleted.includes("2.mp4"), "Missing files must not break cleanup");
    t.diagnostic(`Synthetic 1,000-file scan: peak pending stat operations = ${peak}`);

    await cleanupTmpFiles();
    assert.equal(listing.mock.callCount(), 1, "The five-minute cooldown is preserved");
    now += 300_001;
    await cleanupTmpFiles();
    assert.equal(listing.mock.callCount(), 2, "Cleanup runs again after the cooldown");
  } finally {
    clock.mock.restore(); listing.mock.restore(); stats.mock.restore(); unlink.mock.restore();
  }
});
