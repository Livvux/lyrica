export async function onRequestError() {
  // Required export — Next.js instrumentation hook
}

export async function register() {
  // Pre-bundle Remotion on server start so the first render is instant
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { preBundleRemotionIfNeeded } = await import("@/lib/render-video");
    preBundleRemotionIfNeeded().catch((err) =>
      console.error("[remotion] Pre-bundling failed:", err)
    );
  }
}
