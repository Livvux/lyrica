import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedJson, BodyTooLargeError } from "../src/lib/bounded-json";

test("render request byte limit counts streamed UTF8 bytes without trusting headers", async () => {
  const request = (body: string) => new Request("http://localhost/render", { method: "POST", body });
  assert.deepEqual(await readBoundedJson(request('{"x":"ä"}'), 10), { x: "ä" });
  await assert.rejects(readBoundedJson(request('{"x":"ä"}'), 9), BodyTooLargeError);
  assert.equal(await readBoundedJson(request("invalid"), 10), null);
});

test("over-limit streams cancel their source before parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(32)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/render", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(request, 16), BodyTooLargeError);
  assert.equal(cancelled, true);
});
