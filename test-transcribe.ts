import { readFileSync } from "fs";
import Groq from "groq-sdk";

const AUDIO_PATH = "/Users/livvux/Downloads/Forever Yours (Latest).mp3";

async function main() {
  const client = new Groq();
  const audioBuffer = readFileSync(AUDIO_PATH);
  const file = new File([audioBuffer], "test.mp3", { type: "audio/mpeg" });

  console.log(`Testing transcription with: ${AUDIO_PATH}`);
  console.log(`File size: ${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  const response = await client.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const raw = response as unknown as {
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
    duration?: number;
  };

  console.log(`\nDuration: ${raw.duration}s`);
  console.log(`Text: ${raw.text.slice(0, 300)}...`);
  console.log(`Words: ${raw.words?.length ?? 0}`);

  if (raw.words && raw.words.length > 0) {
    console.log(`\nFirst 10 words:`);
    raw.words.slice(0, 10).forEach((w) => {
      console.log(`  "${w.word}" ${w.start}s - ${w.end}s`);
    });
  }
}

main().catch(console.error);
