import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import { createMediaResponse } from "../src/lib/media-response";

let directory: string;
const contents = "0123456789";
before(async () => {
  directory = await fs.mkdtemp(path.join(tmpdir(), "lyrica-media-"));
  await fs.writeFile(path.join(directory, "sample.mp3"), contents);
  await fs.writeFile(path.join(directory, "empty.mp3"), "");
  await fs.mkdir(path.join(directory, "directory.mp3"));
  const large = await fs.open(path.join(directory, "large.mp4"), "w");
  await large.truncate(8 * 1024 * 1024);
  await large.close();
});
after(async () => { await fs.rm(directory, { recursive: true, force: true }); });

function serve(headers: HeadersInit = {}, filename = "sample.mp3", method = "GET", signal?: AbortSignal) {
  return createMediaResponse(new Request("http://localhost/media", { headers, method, signal }), {
    directory, filename, contentType: "audio/mpeg",
  });
}

test("full response has correct bytes and cache/size headers", async () => {
  const response = await serve();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), contents);
});

for (const [range, body, contentRange] of [
  ["bytes=2-4", "234", "bytes 2-4/10"],
  ["bytes=-3", "789", "bytes 7-9/10"],
  ["bytes=8-", "89", "bytes 8-9/10"],
  ["bytes=8-999", "89", "bytes 8-9/10"],
  ["bytes=-999", contents, "bytes 0-9/10"],
]) {
  test(`partial response ${range}`, async () => {
    const response = await serve({ range });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), contentRange);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(await response.text(), body);
  });
}

for (const range of ["bytes=10-", "bytes=-0", "bytes=7-3"]) {
  test(`unsatisfiable response ${range}`, async () => {
    const response = await serve({ range });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
    assert.equal(response.headers.get("content-length"), "0");
    assert.equal(response.body, null);
  });
}

for (const range of ["bytes=0-1,5-6", "garbage bytes=0-1", "bytes=0-1junk", "items=0-1"]) {
  test(`ignored range returns complete representation: ${range}`, async () => {
    const response = await serve({ range });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(await response.text(), contents);
  });
}

test("unknown If-Range validator falls back to full representation", async () => {
  const response = await serve({ range: "bytes=2-4", "if-range": '"old-version"' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), contents);
});

test("HEAD ignores Range and never opens a read stream", async () => {
  const file = await fs.open(path.join(directory, "sample.mp3"), "r");
  const prototype = Object.getPrototypeOf(file);
  await file.close();
  const spy = mock.method(prototype, "createReadStream", () => {
    throw new Error("HEAD must not read the body");
  });
  try {
    const response = await serve({ range: "bytes=-3" }, "sample.mp3", "HEAD");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), "10");
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(response.body, null);
    assert.equal(spy.mock.callCount(), 0);
  } finally { spy.mock.restore(); }
});

test("empty media is safe with and without Range", async () => {
  const full = await serve({}, "empty.mp3");
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-length"), "0");
  assert.equal(full.body, null);
  const partial = await serve({ range: "bytes=0-" }, "empty.mp3");
  assert.equal(partial.status, 416);
  assert.equal(partial.headers.get("content-range"), "bytes */0");
});

test("invalid filenames cannot alias files inside or outside the media directory", async () => {
  for (const name of ["", ".", "..", "../sample.mp3", "..\\sample.mp3", "nested/sample.mp3", "sample.mp3\0"]) {
    const response = await serve({}, name);
    assert.equal(response.status, 400, name);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("missing files and directories are 404", async () => {
  assert.equal((await serve({}, "missing.mp3")).status, 404);
  assert.equal((await serve({}, "directory.mp3")).status, 404);
});

test("unexpected filesystem failures are not disguised as 404", async () => {
  const spy = mock.method(fs, "open", async () => {
    throw Object.assign(new Error("Too many open files"), { code: "EMFILE" });
  });
  const log = mock.method(console, "error", () => {});
  try {
    const response = await serve();
    assert.equal(response.status, 500);
    assert.equal(log.mock.callCount(), 1);
    assert.ok(!(await response.text()).includes("EMFILE"));
  } finally { spy.mock.restore(); log.mock.restore(); }
});

test("already-aborted requests do not open files", async () => {
  const controller = new AbortController();
  controller.abort();
  const spy = mock.method(fs, "open");
  try {
    const response = await serve({}, "sample.mp3", "GET", controller.signal);
    assert.equal(response.status, 499);
    assert.equal(spy.mock.callCount(), 0);
  } finally { spy.mock.restore(); }
});

test("aborting an in-flight request errors its body and keeps the file retryable", async () => {
  const controller = new AbortController();
  const response = await serve({}, "large.mp4", "GET", controller.signal);
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  controller.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
  reader.releaseLock();
  const retry = await serve({ range: "bytes=65536-65539" }, "large.mp4");
  assert.equal(retry.status, 206);
  assert.equal((await retry.arrayBuffer()).byteLength, 4);
});

test("canceling the response body does not delete the source", async () => {
  const response = await serve({}, "large.mp4");
  await response.body!.cancel();
  assert.equal((await fs.stat(path.join(directory, "large.mp4"))).size, 8 * 1024 * 1024);
});
