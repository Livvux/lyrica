import { analyzeAudio } from "../lib/audio-analysis";

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const analysis = analyzeAudio(event.data.samples, event.data.sampleRate);
    self.postMessage({ analysis });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Audioanalyse fehlgeschlagen." });
  }
};
