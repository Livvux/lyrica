"use server";

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getProvider } from "@/lib/transcription";
import type { TranscriptionResult } from "@/types/lyrics";

const TMP_DIR = path.join(process.cwd(), "tmp", "lyrica");

export async function transcribeAudio(
  formData: FormData
): Promise<{
  result?: TranscriptionResult;
  audioPath?: string;
  error?: string;
}> {
  const file = formData.get("audio") as File | null;
  if (!file) {
    return { error: "Keine Audiodatei ausgewählt." };
  }

  if (file.size > 25 * 1024 * 1024) {
    return { error: "Datei zu groß. Maximal 25 MB erlaubt." };
  }

  const allowedTypes = [
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
    "audio/x-m4a",
    "audio/mp3",
    "video/mp4",
    "audio/m4a",
  ];
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|mp4|wav|webm|m4a)$/i)) {
    return { error: "Ungültiges Format. Erlaubt: MP3, MP4, WAV, WebM, M4A." };
  }

  try {
    await mkdir(TMP_DIR, { recursive: true });
    const ext = path.extname(file.name) || ".mp3";
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(TMP_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const provider = getProvider();
    const result = await provider.transcribe(file);

    if (result.words.length === 0) {
      return { error: "Kein Gesang erkannt. Bitte eine andere Datei versuchen." };
    }

    return { result, audioPath: filePath };
  } catch (e) {
    console.error("Transcription error:", e);
    return { error: "Fehler bei der Transkription. Bitte erneut versuchen." };
  }
}
