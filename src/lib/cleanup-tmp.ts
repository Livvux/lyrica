import { readdir, stat, unlink } from "fs/promises";
import path from "path";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export async function cleanupTmpFiles() {
  try {
    const files = await readdir(TMP_DIR);
    const now = Date.now();

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(TMP_DIR, file);
        const stats = await stat(filePath).catch(() => null);
        if (stats && now - stats.mtimeMs > MAX_AGE_MS) {
          await unlink(filePath).catch(() => {});
        }
      })
    );
  } catch {
    // tmp dir may not exist yet
  }
}
