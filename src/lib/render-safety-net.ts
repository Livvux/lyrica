let safetyNetInstalled = false;

export function installRenderSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;

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
