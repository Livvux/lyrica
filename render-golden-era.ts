/**
 * End-to-End Test: Golden Era Mix
 * Lädt Audio + Bild hoch, transkribiert, rendert und speichert MP4.
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import http from "http";
import { groupWordsIntoLines, getDurationInFrames } from "./src/lib/timing";
import type { TranscriptionResult, VideoConfig } from "./src/types/lyrics";

const BASE_URL = "http://100.99.236.56:3000";
const AUDIO_PATH = "/Users/livvux/Documents/Livvux/mixes/golden_era_2012_2015/golden_era_2012_2015.mp3";
const IMAGE_PATH = "/Users/livvux/Documents/Livvux/Bilder/golden-era-10-15-mix.webp";
const OUTPUT_PATH = path.join(process.cwd(), "golden_era_2012_2015.mp4");

function log(msg: string) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

async function uploadBg(): Promise<string> {
  log("Bild hochladen...");
  const buffer = await readFile(IMAGE_PATH);
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: "image/webp" }), "golden-era.webp");

  const res = await fetch(`${BASE_URL}/api/upload-bg`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload-bg fehlgeschlagen: ${await res.text()}`);
  const { filename } = await res.json() as { filename: string };
  log(`Bild hochgeladen: ${filename}`);
  // Return just the filename — render-video.ts will handle the path correctly
  return filename;
}

async function transcribeAudio(): Promise<{ result: TranscriptionResult; audioFilename: string }> {
  log("Audio hochladen + transkribieren (106 Min → ~11 Groq-Chunks, dauert ~10-15 Min)...");
  const buffer = await readFile(AUDIO_PATH);
  const form = new FormData();
  form.append("audio", new Blob([buffer], { type: "audio/mpeg" }), "golden_era_2012_2015.mp3");

  const res = await fetch(`${BASE_URL}/api/transcribe`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30 * 60 * 1000), // 30 Min Timeout
  });
  if (!res.ok) throw new Error(`Transkription fehlgeschlagen: ${await res.text()}`);
  const data = await res.json() as { result: TranscriptionResult; audioFilename: string };
  log(`Transkription fertig: ${data.result.words.length} Wörter, ${(data.result.durationSec / 60).toFixed(1)} Min`);
  return data;
}

async function renderVideo(config: VideoConfig): Promise<string> {
  log("Render startet (Full HD, ~45-60 Min)...");

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(config);
    const url = new URL(`${BASE_URL}/api/render`);

    const req = http.request({
      hostname: url.hostname,
      port: parseInt(url.port || "80"),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 0, // kein Timeout — Render kann Stunden dauern
    }, (res) => {
      if (res.statusCode !== 200) {
        let errBody = "";
        res.on("data", (c: Buffer) => errBody += c.toString());
        res.on("end", () => reject(new Error(`Render fehlgeschlagen (${res.statusCode}): ${errBody}`)));
        return;
      }

      let buffer = "";
      let filename = "";
      let lastProgress = -1;

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { phase: string; progress?: number; filename?: string; error?: string };
            if (event.error) { reject(new Error(`Render-Fehler: ${event.error}`)); return; }
            if (event.phase === "done" && event.filename) {
              filename = event.filename;
              log(`Rendering abgeschlossen: ${filename}`);
            } else if (event.progress !== undefined) {
              const pct = Math.round(event.progress * 100);
              if (pct !== lastProgress && pct % 5 === 0) {
                log(`${event.phase}: ${pct}%`);
                lastProgress = pct;
              }
            }
          } catch (e) {
            if (!(e instanceof SyntaxError)) reject(e);
          }
        }
      });

      res.on("end", () => {
        if (!filename) reject(new Error("Kein Dateiname vom Server erhalten"));
        else resolve(filename);
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function downloadMp4(filename: string): Promise<void> {
  log(`MP4 herunterladen: ${filename}`);
  const res = await fetch(`${BASE_URL}/api/audio/${filename}`, {
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(OUTPUT_PATH, buffer);
  log(`Gespeichert: ${OUTPUT_PATH} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const startTime = Date.now();
  log("=== Lyrica End-to-End Test: Golden Era 2012-2015 ===");

  // Parallel: Bild hochladen + Audio transkribieren
  const [bgImageUrl, { result: transcription, audioFilename }] = await Promise.all([
    uploadBg(),
    transcribeAudio(),
  ]);

  log("Wörter zu Zeilen gruppieren...");
  const lines = groupWordsIntoLines(transcription.words);
  log(`${lines.length} Zeilen erstellt`);

  const durationInFrames = getDurationInFrames(transcription.durationSec);

  const config: VideoConfig = {
    lines,
    audioUrl: audioFilename,
    durationInFrames,
    fps: 30,
    width: 1920,
    height: 1080,
    renderQuality: "balanced",
    style: {
      fontSize: 76,
      fontFamily: "Inter",
      textColor: "#ffffff",
      bgImage: bgImageUrl,
      bgType: "image",
      effectIntensity: "subtle",
      beatReactive: true,
      animationVariant: "fade-drift",
      visualizerMode: "rainbow",
      logoScale: 217,
      postEffect: "camera-shake",
      showWatermark: false,
      customLogo: null,
      waveConfig: { colors: ["#3a5fcd", "#ff00ff", "#ff0000", "#ffb90f", "#ffffff"], gain: 280, radius: 140, points: 32, spread: 0.55 },
    },
  };

  log(`VideoConfig: ${lines.length} Zeilen, ${(durationInFrames / 30 / 60).toFixed(1)} Min, Full HD`);

  const outputFilename = await renderVideo(config);
  await downloadMp4(outputFilename);

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log(`=== Fertig in ${elapsed} Min ===`);
  log(`MP4: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("FEHLER:", err);
  process.exit(1);
});
