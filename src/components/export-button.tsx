"use client";

import { useState } from "react";
import type { VideoConfig, RenderQuality } from "@/types/lyrics";

interface ExportButtonProps {
  config: VideoConfig;
}

type RenderState =
  | { status: "idle" }
  | { status: "bundling"; progress: number }
  | { status: "rendering"; progress: number }
  | { status: "downloading" }
  | { status: "error"; message: string };

export function ExportButton({ config }: ExportButtonProps) {
  const [state, setState] = useState<RenderState>({ status: "idle" });

  async function handleExport(quality: RenderQuality) {
    setState({ status: "bundling", progress: 0 });

    const exportConfig: VideoConfig = {
      ...config,
      renderQuality: quality,
    };

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportConfig),
      });

      if (!response.ok || !response.body) {
        setState({ status: "error", message: "Render-Fehler" });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let downloadFilename: string | null = null;

      function processLines(text: string) {
        const lines = text.split("\n\n");
        const remaining = lines.pop() ?? "";
        for (const line of lines) {
          const match = line.match(/^data: (.+)$/);
          if (!match) continue;
          const data = JSON.parse(match[1]);
          if (data.phase === "bundling") {
            setState({ status: "bundling", progress: data.progress });
          } else if (data.phase === "rendering") {
            setState({ status: "rendering", progress: data.progress });
          } else if (data.phase === "done") {
            downloadFilename = data.filename;
          } else if (data.phase === "error") {
            setState({ status: "error", message: data.error });
          }
        }
        return remaining;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = processLines(buffer);
      }
      // Process any remaining data in buffer
      if (buffer.trim()) processLines(buffer + "\n\n");

      if (!downloadFilename) {
        setState({ status: "error", message: "Kein Video erhalten." });
        return;
      }

      setState({ status: "downloading" });
      const mp4 = await fetch(`/api/render/${downloadFilename}`);
      const blob = await mp4.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lyrica-${quality === "draft" ? "draft-720p" : "1080p"}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setState({ status: "error", message: "Fehler beim Exportieren." });
    } finally {
      setState((prev) => (prev.status === "error" ? prev : { status: "idle" }));
    }
  }

  const isActive = state.status !== "idle" && state.status !== "error";
  const progress =
    state.status === "bundling"
      ? state.progress * 0.3
      : state.status === "rendering"
        ? 0.3 + state.progress * 0.7
        : state.status === "downloading"
          ? 1
          : 0;

  const label =
    state.status === "bundling"
      ? "Vorbereiten..."
      : state.status === "rendering"
        ? `Rendere ${Math.round(progress * 100)}%`
        : state.status === "downloading"
          ? "Download..."
          : null;

  return (
    <div className="flex flex-col gap-2">
      {isActive ? (
        <button
          disabled
          className="relative overflow-hidden rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          <div
            className="absolute inset-0 bg-white/30 transition-all duration-300 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
          <span className="relative">{label}</span>
        </button>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => handleExport("draft")}
            className="flex-1 rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10"
          >
            Schnell-Export (720p)
          </button>
          <button
            onClick={() => handleExport("full")}
            className="flex-1 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Export (1080p)
          </button>
        </div>
      )}
      {state.status === "error" && (
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-red-400">{state.message}</p>
          <button
            onClick={() => setState({ status: "idle" })}
            className="text-xs text-white/30 transition hover:text-white/50"
          >
            Schließen
          </button>
        </div>
      )}
    </div>
  );
}
