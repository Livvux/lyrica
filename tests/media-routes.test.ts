import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Import the actual route handlers after choosing an isolated working directory.
// No Next.js server, API key or rendering process is needed.
let directory: string;
const cwd = process.cwd();
let audio: typeof import("../src/app/api/audio/[filename]/route");
let video: typeof import("../src/app/api/render/[filename]/route");
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lyrica-routes-"));
  await mkdir(path.join(directory, "tmp", "lyrica"), { recursive: true });
  for (const filename of ["sample.mp3", "sample.mp4", "image.PNG", "unknown.bin"]) {
    await writeFile(path.join(directory, "tmp", "lyrica", filename), "0123456789");
  }
  process.chdir(directory);
  audio = await import("../src/app/api/audio/[filename]/route");
  video = await import("../src/app/api/render/[filename]/route");
});
after(async () => {
  process.chdir(cwd);
  await rm(directory, { recursive: true, force: true });
});
const params = (filename: string) => ({ params: Promise.resolve({ filename }) });
const request = (headers: HeadersInit = {}, method = "GET") => new Request("http://localhost/media", { headers, method });

test("audio route serves correct suffix bytes", async () => {
  const response = await audio.GET(request({ range: "bytes=-3" }), params("sample.mp3"));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(await response.text(), "789");
});

test("media MIME types remain case-insensitive with a binary fallback", async () => {
  for (const [filename, type] of [["image.PNG", "image/png"], ["unknown.bin", "application/octet-stream"]]) {
    const response = await audio.HEAD(request({}, "HEAD"), params(filename));
    assert.equal(response.headers.get("content-type"), type);
    assert.equal(response.body, null);
  }
});

test("download route supports resume and keeps its attachment filename", async () => {
  const response = await video.GET(request({ range: "bytes=5-" }), params("sample.mp4"));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-range"), "bytes 5-9/10");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="lyrica-video.mp4"');
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "56789");
});

test("HEAD on downloads returns metadata without destroying the export", async () => {
  const response = await video.HEAD(request({ range: "bytes=-2" }, "HEAD"), params("sample.mp4"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.body, null);
  assert.equal((await stat(path.join(directory, "tmp", "lyrica", "sample.mp4"))).size, 10);
});

test("completed downloads can be downloaded again", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await video.GET(request(), params("sample.mp4"));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "0123456789");
  }
});

test("both routes reject path traversal and return 404 for missing media", async () => {
  for (const handler of [audio.GET, video.GET]) {
    assert.equal((await handler(request(), params("../sample.mp4"))).status, 400);
    assert.equal((await handler(request(), params("missing.mp4"))).status, 404);
  }
});

test("download route still rejects non-MP4 filenames", async () => {
  assert.equal((await video.GET(request(), params("sample.mp3"))).status, 400);
});
