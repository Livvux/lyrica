import { readFile } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  if (!name || /[/\\]/.test(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }

  const filePath = resolve(process.cwd(), "example", name);
  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
      headers: { "Content-Type": "audio/mpeg", "Content-Disposition": `inline; filename="${name}"` },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
