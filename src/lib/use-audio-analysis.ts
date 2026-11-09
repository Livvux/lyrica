"use client";

import { useEffect, useState } from "react";
import { MAX_ANALYSIS_DURATION } from "./audio-analysis";
import type { AudioAnalysis } from "./audio-analysis";

interface AnalysisState {
  url: string | null;
  analysis: AudioAnalysis | null;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, AudioAnalysis>();

/** Media never leaves the host. PCM is transferred to the worker instead of copied. */
export function useAudioAnalysis(audioUrl: string | null) {
  const [state, setState] = useState<AnalysisState>({ url: null, analysis: null, loading: false, error: null });

  useEffect(() => {
    if (!audioUrl) return;
    const url = audioUrl;
    let disposed = false;
    let worker: Worker | undefined;
    const controller = new AbortController();
    async function run() {
      const cached = cache.get(url);
      if (cached) {
        if (!disposed) setState({ url: audioUrl, analysis: cached, loading: false, error: null });
        return;
      }
      try {
        if (!disposed) setState({ url: audioUrl, analysis: null, loading: true, error: null });
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Audio für die Analyse nicht verfügbar.");
        const bytes = await response.arrayBuffer();
        if (disposed) return;
        // decodeAudioData resamples to 22.05 kHz, enough for musical analysis and far less PCM memory.
        const context = new OfflineAudioContext(1, 1, 22050);
        const decoded = await context.decodeAudioData(bytes);
        if (disposed) return;
        if (decoded.duration > MAX_ANALYSIS_DURATION) throw new Error("Audioanalyse unterstützt bis zu 120 Minuten.");
        const mono = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const data = decoded.getChannelData(channel);
          for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
        }
        if (disposed) return;
        worker = new Worker(new URL("../workers/audio-analysis.worker.ts", import.meta.url));
        worker.onmessage = (event: MessageEvent<{ analysis?: AudioAnalysis; error?: string }>) => {
          if (disposed) return;
          const analysis = event.data.analysis;
          if (analysis) {
            cache.set(url, analysis);
            while (cache.size > 2) {
              const oldest = cache.keys().next().value;
              if (oldest !== undefined) cache.delete(oldest);
            }
            setState({ url: audioUrl, analysis, loading: false, error: null });
          } else {
            setState({ url: audioUrl, analysis: null, loading: false, error: event.data.error ?? "Audioanalyse fehlgeschlagen." });
          }
          worker?.terminate();
        };
        worker.onerror = () => {
          if (!disposed) setState({ url: audioUrl, analysis: null, loading: false, error: "Audioanalyse fehlgeschlagen." });
          worker?.terminate();
        };
        worker.postMessage({ samples: mono, sampleRate: decoded.sampleRate }, [mono.buffer]);
      } catch (error) {
        if (!disposed) setState({ url: audioUrl, analysis: null, loading: false, error: error instanceof Error ? error.message : "Audioanalyse fehlgeschlagen." });
      }
    }
    // Also avoids a synchronous effect state update when restoring a cached song.
    queueMicrotask(() => { if (!disposed) void run(); });
    return () => { disposed = true; controller.abort(); worker?.terminate(); };
  }, [audioUrl]);

  return state.url === audioUrl ? { analysis: state.analysis, loading: state.loading, error: state.error }
    : { analysis: null, loading: Boolean(audioUrl), error: null };
}
