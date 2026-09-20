import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { toByteWebStream } from "../src/lib/media-response";

const CHUNK_BYTES = 64 * 1024;

test("a stalled consumer cannot buffer the whole file", async () => {
  let produced = 0;
  const stream = new Readable({
    highWaterMark: CHUNK_BYTES,
    read() {
      if (produced === 512) { this.push(null); return; }
      produced++;
      this.push(Buffer.alloc(CHUNK_BYTES));
    },
  });
  const web = toByteWebStream(stream);
  try {
    await setImmediate();
    await setImmediate();
    assert.ok(produced > 0, "The adapter should begin reading");
    assert.ok(produced <= 4, `Buffered ${produced * CHUNK_BYTES} bytes for a stalled consumer`);
    assert.equal(stream.readableEnded, false);
  } finally { await web.cancel(); }
});

test("consumer cancellation destroys the Node stream", async () => {
  const stream = new Readable({ read() {} });
  const closed = new Promise<void>((resolve) => stream.once("close", resolve));
  const web = toByteWebStream(stream);
  await web.cancel();
  await closed;
  assert.equal(stream.destroyed, true);
});

test("read failures propagate to the Web stream", async () => {
  const stream = new Readable({ read() { this.destroy(new Error("Read failed")); } });
  await assert.rejects(toByteWebStream(stream).getReader().read(), /Read failed/);
});

test("canceling a real file stream closes its descriptor", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lyrica-descriptor-"));
  try {
    const filename = path.join(directory, "file.bin");
    await writeFile(filename, Buffer.alloc(CHUNK_BYTES * 16));
    const file = await open(filename, "r");
    const stream = file.createReadStream({ highWaterMark: CHUNK_BYTES, autoClose: true });
    const closed = new Promise<void>((resolve) => stream.once("close", resolve));
    const web = toByteWebStream(stream);
    await web.cancel();
    await closed;
    await assert.rejects(file.stat(), { code: "EBADF" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
