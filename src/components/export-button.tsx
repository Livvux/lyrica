"use client";

import { useState, useRef } from "react";
import type { VideoConfig, RenderQuality } from "@/types/lyrics";

const PROFILES: { key: RenderQuality; label: string; resolution: string }[] = [
  { key: "fast", label: "Schnell", resolution: "720p" },
  { key: "balanced", label: "Ausgewogen", resolution: "1080p" },
  { key: "quality", label: "Qualität", resolution: "1080p HQ" },
];

type RenderState =
  | { status: "idle" }
  | { status: "bundling" | "rendering"; progress: number; elapsed: number }
  | { status: "error"; message: string };

function formatEta(sec: number): string {
  if (sec < 60) return `noch ${Math.max(1, Math.round(sec))} s`;
  return `noch ${Math.round(sec / 60)} min`;
}

export function ExportButton({ config }: { config: VideoConfig }) {
  const [profile, setProfile] = useState<RenderQuality>("balanced");
  const [state, setState] = useState<RenderState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const selected = PROFILES.find((p) => p.key === profile) ?? PROFILES[1];

  async function handleExport() {
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    setState({ status: "bundling", progress: 0, elapsed: 0 });

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, renderQuality: profile } satisfies VideoConfig),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        setState({ status: "error", message: data?.error ?? "Export fehlgeschlagen." });
        return;
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let filename: string | null = null;
      let error: string | null = null;
      let renderStartedAt = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const events = (buffer + value).split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const data = JSON.parse(event.slice(6));
          if (data.phase === "bundling") setState({ status: "bundling", progress: data.progress, elapsed: (Date.now() - startedAt) / 1000 });
          else if (data.phase === "rendering") {
            renderStartedAt ||= Date.now();
            setState({ status: "rendering", progress: data.progress, elapsed: (Date.now() - renderStartedAt) / 1000 });
          } else if (data.phase === "done") filename = data.filename;
          else if (data.phase === "error") error = data.error;
        }
      }

      if (!filename) {
        setState({ status: "error", message: error ?? "Kein Video erhalten." });
        return;
      }
      // Let the browser stream the file to disk (resumable, no in-memory blob).
      const a = document.createElement("a");
      a.href = `/api/render/${filename}`;
      a.download = `lyrica-${selected.resolution.split(" ")[0]}.mp4`;
      a.click();
      setState({ status: "idle" });
    } catch (e) {
      setState(e instanceof Error && e.name === "AbortError" ? { status: "idle" } : { status: "error", message: "Export fehlgeschlagen." });
    } finally {
      abortRef.current = null;
    }
  }

  if (state.status === "bundling" || state.status === "rendering") {
    const rendering = state.status === "rendering";
    const percent = Math.round((rendering ? 0.05 + state.progress * 0.95 : state.progress * 0.05) * 100);
    const eta = rendering && state.progress > 0.02 ? (state.elapsed / state.progress) * (1 - state.progress) : null;
    return (
      <section className="panel flex flex-col gap-3" aria-label="Export">
        <div className="flex items-center gap-3">
          <span role="status" className="flex-1 text-sm font-medium text-white">
            {rendering ? "Rendern" : "Vorbereiten"}
            {eta !== null && <span className="ml-2 font-normal text-white/50">{formatEta(eta)}</span>}
          </span>
          <span className="text-sm font-semibold tabular-nums text-white" aria-hidden="true">{percent}%</span>
          <button type="button" onClick={() => abortRef.current?.abort()} className="btn-quiet hover:text-danger">
            Abbrechen
          </button>
        </div>
        <div
          role="progressbar"
          aria-label="Exportfortschritt"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
      </section>
    );
  }

  return (
    <section className="panel flex flex-col gap-3" aria-label="Export">
      <div role="group" aria-label="Exportqualität" className="segmented">
        {PROFILES.map((p) => (
          <button key={p.key} type="button" aria-pressed={profile === p.key} onClick={() => setProfile(p.key)} className="segment">
            {p.label}
          </button>
        ))}
      </div>
      <button type="button" onClick={handleExport} className="btn-primary w-full">
        Video exportieren · {selected.resolution}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">{state.message}</p>
      )}
    </section>
  );
}
