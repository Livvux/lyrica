# Media delivery and temporary-file cleanup

## Behavior

Both `/api/audio/[filename]` and `/api/render/[filename]` share the same file-response implementation. Rendering profiles, audio processing, video quality and UI behavior are unchanged.

- GET streams a full file or a single byte range. Suffix ranges such as `bytes=-500` return the last 500 bytes, not the beginning of the file. Oversized ends are clamped and unsatisfiable ranges return 416 with `Content-Range: bytes */size`.
- Malformed, unsupported-unit and multipart Range headers are ignored and receive the complete representation. Multipart responses are not implemented. A supplied `If-Range` also falls back to a full response because these endpoints do not expose validators.
- HEAD returns metadata without creating a body stream. Range is ignored for HEAD.
- A single open descriptor supplies both metadata and bytes. The Node read buffer and Web-stream queue each have an explicit 64 KiB budget. This is not a cap on total process memory. Aborting a request or canceling its body closes its stream without deleting the file.
- MP4 downloads remain attachments named `lyrica-video.mp4`, now support byte ranges, and use `private, no-store`. Completed or interrupted downloads can be retried while the temporary file exists.
- Traversal-like filenames are rejected rather than silently rewritten. This is not an authentication or authorization mechanism; public deployment still needs access controls.

## Retention tradeoff

Exports are no longer deleted on stream close. This prevents a canceled request, metadata request, or first download from destroying the only copy. The existing `cleanupTmpFiles()` policy remains responsible for deletion: files older than one hour are eligible during subsequent upload/render-triggered scans, with a five-minute scan cooldown. There is **no background timer or guaranteed deletion deadline**. Retained exports consume more disk space until cleanup runs; monitor disk use on busy installations.

Cleanup now processes batches of at most 32 files instead of queuing one stat/promise for every file at once. Concurrent callers still share one scan. Fresh files, directories and per-file filesystem failures retain their previous handling.

## Validation

After installing the repository dependencies, run:

```sh
pnpm test
```

The runner uses the existing TypeScript dependency and Node's built-in test runner. It strictly compiles the tested production modules and actual route handlers into an isolated OS temporary directory, runs the tests, and removes the generated files. It does not require API keys, Next.js to be running, Chrome, or FFmpeg. No dependency or lockfile changes are needed.

The 66 tests cover range parsing (including a 12,500-case bounds sweep), real-file GET/HEAD responses, both route adapters, cancellation, descriptor closure, retryable downloads, filesystem errors, byte-sized backpressure, and cleanup concurrency/coalescing/retention.

A synthetic 1,000-file scan holds at most 32 stat operations in flight with the new cleanup; the previous implementation launches all 1,000. This measures queued filesystem work, **not** production latency or rendering speed.

A separate stalled-consumer check on Node 22.16.0 found 128 KiB of source read-ahead with both the previous `Readable.toWeb()` default and the explicit byte-sized strategy. No memory reduction is claimed for that runtime. The regression test protects the intended buffering bound.

The development check used Node 22.16.0, available TypeScript 5.8.3 and Node types 25.1.0. A complete dependency install, repository-wide lint/type-check, Next.js production build, browser playback, and end-to-end MP4 rendering were not run in that environment. Run the existing `pnpm lint`, `pnpm type-check`, and `pnpm build` commands plus a real export before merging for production.

## References

- HTTP range semantics: https://www.rfc-editor.org/rfc/rfc9110.html#section-14
- Node stream conversion and queuing strategy: https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options
- File-handle streams and automatic descriptor closure: https://nodejs.org/api/fs.html#filehandlecreatereadstreamoptions
