export async function onRequestError() {
  // Required export — Next.js instrumentation hook
}

let safetyNetInstalled = false;

function installSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;

  // The /api/render route streams SSE events. When a client disconnects
  // mid-render, Next.js internally transitions the ReadableStream controller
  // to a closed state. A late enqueue from an async metrics/progress callback
  // then surfaces as ERR_INVALID_STATE through an async microtask that
  // bypasses the route's try/catch, and Node turns it into an
  // uncaughtException that kills the PM2 process. We swallow only that
  // specific, known-benign error and let every other crash keep its default
  // behavior so real bugs still surface.
  process.on("uncaughtException", (err: Error & { code?: string }) => {
    if (err?.code === "ERR_INVALID_STATE") {
      console.warn(`[safety] Swallowed ${err.code}: ${err.message}`);
      return;
    }
    console.error("[uncaughtException]", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const err = reason as { code?: string; message?: string } | undefined;
    if (err?.code === "ERR_INVALID_STATE") {
      console.warn(`[safety] Swallowed unhandled ${err.code}: ${err.message ?? ""}`);
      return;
    }
    console.error("[unhandledRejection]", reason);
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    installSafetyNet();
    const { preBundleRemotionIfNeeded } = await import("@/lib/render-video");
    preBundleRemotionIfNeeded().catch((err) =>
      console.error("[remotion] Pre-bundling failed:", err)
    );
  }
}
