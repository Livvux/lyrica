let safetyNetInstalled = false;

// Puppeteer/Chromium errors surfaced outside renderMedia()'s own promise chain
// (e.g. from browser-crash event listeners) belong to a single render request,
// not the server process. Exiting on these kills every in-flight render and
// every other user's request — only exit for genuinely unclassified errors.
const RECOVERABLE_PATTERNS = [
  "ProtocolError",
  "Target closed",
  "Session closed",
  "Connection closed",
  "TimeoutError",
  "Navigating frame was detached",
];

function isRecoverableBrowserError(err: { name?: string; message?: string } | undefined): boolean {
  if (!err) return false;
  const text = `${err.name ?? ""} ${err.message ?? ""}`;
  return RECOVERABLE_PATTERNS.some((pattern) => text.includes(pattern));
}

export function installRenderSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;

  process.on("uncaughtException", (err: Error & { code?: string }) => {
    if (err?.code === "ERR_INVALID_STATE") {
      console.warn(`[safety] Swallowed ${err.code}: ${err.message}`);
      return;
    }
    if (isRecoverableBrowserError(err)) {
      console.warn(`[safety] Swallowed browser-crash exception: ${err.name}: ${err.message}`);
      return;
    }
    console.error("[uncaughtException]", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason as { code?: string; name?: string; message?: string } | undefined;
    if (err?.code === "ERR_INVALID_STATE") {
      console.warn(`[safety] Swallowed unhandled ${err.code}: ${err.message ?? ""}`);
      return;
    }
    if (isRecoverableBrowserError(err)) {
      console.warn(`[safety] Swallowed unhandled browser-crash rejection: ${err?.name}: ${err?.message ?? ""}`);
      return;
    }
    console.error("[unhandledRejection]", reason);
  });
}
