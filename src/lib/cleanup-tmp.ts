import { readdir, stat, unlink } from "fs/promises";
import path from "path";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let lastCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;

export async function cleanupTmpFiles() {
  const now = Date.now();
  if (cleanupInFlight) return cleanupInFlight;
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;

  cleanupInFlight = (async () => {
    try {
      const files = await readdir(TMP_DIR);
      const current = Date.now();

      await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(TMP_DIR, file);
          const stats = await stat(filePath).catch(() => null);
          if (!stats || !stats.isFile()) return;
          if (current - stats.mtimeMs > MAX_AGE_MS) {
            await unlink(filePath).catch(() => {});
          }
        })
      );
    } catch {
      // tmp dir may not exist yet
    } finally {
      lastCleanupAt = Date.now();
      cleanupInFlight = null;
    }
  })();

  try {
    await cleanupInFlight;
  } catch {
    // errors are already swallowed in cleanupInFlight
  }
}
