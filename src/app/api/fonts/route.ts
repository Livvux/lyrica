import { exec } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execAsync = promisify(exec);

// Cache font list in memory — system fonts don't change during runtime
let cachedFonts: string[] | null = null;

export async function GET() {
  try {
    if (!cachedFonts) {
      const { stdout } = await execAsync("fc-list : family");
      cachedFonts = [
        ...new Set(
          stdout
            .split("\n")
            .map((line) => line.split(",")[0].trim())
            .filter((name) => name.length > 0 && !name.startsWith("."))
        ),
      ].sort((a, b) => a.localeCompare(b));
    }

    return NextResponse.json(cachedFonts, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return NextResponse.json(["Inter", "Arial", "Helvetica", "sans-serif"], {
      status: 200,
    });
  }
}
