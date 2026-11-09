import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const FALLBACK_FONTS = ["Inter", "Arial", "Helvetica", "sans-serif"];

// System fonts don't change at runtime; cache the list (or the fallback when fc-list is missing).
let fontsPromise: Promise<string[]> | null = null;

async function listFonts(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("fc-list", [":", "family"]);
    const fonts = [
      ...new Set(
        stdout
          .split("\n")
          .map((line) => line.split(",")[0].trim())
          .filter((name) => name.length > 0 && !name.startsWith("."))
      ),
    ].sort((a, b) => a.localeCompare(b));
    return fonts.length > 0 ? fonts : FALLBACK_FONTS;
  } catch {
    return FALLBACK_FONTS;
  }
}

export async function GET() {
  fontsPromise ??= listFonts();
  return NextResponse.json(await fontsPromise, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
