"use client";

import { useState, useRef, useEffect } from "react";
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
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function addLog(message: string) {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, `[${ts}] ${message}`]);
  }

  async function handleExport(quality: RenderQuality) {
    setLogs([]);
    setShowLogs(true);
    addLog(`Export gestartet: ${quality === "draft" ? "Draft 720p" : "Full 1080p"}`);
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
          } else if (data.phase === "log") {
            addLog(data.message);
          } else if (data.phase === "done") {
            addLog("Video fertig, Download startet…");
            downloadFilename = data.filename;
          } else if (data.phase === "error") {
            addLog(`FEHLER: ${data.error}`);
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
  // Bundling is usually instant (cached), so give it 5%. Rendering is the real work (90%). Download 5%.
  const progress =
    state.status === "bundling"
      ? state.progress * 0.05
      : state.status === "rendering"
        ? 0.05 + state.progress * 0.90
        : state.status === "downloading"
          ? 0.95
          : 0;

  const percent = Math.round(progress * 100);

  const label =
    state.status === "bundling"
      ? "Vorbereiten…"
      : state.status === "rendering"
        ? `Rendere… ${percent}%`
        : state.status === "downloading"
          ? "Download…"
          : null;

  return (
    <div className="flex flex-col gap-2">
      {isActive ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm text-white/80">
            <span className="font-medium">{label}</span>
            <span className="tabular-nums font-semibold">{percent}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
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
      {logs.length > 0 && (
        <div className="mt-1">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="mb-1 text-xs text-white/40 transition hover:text-white/60"
          >
            {showLogs ? "▼ Debug-Log ausblenden" : "▶ Debug-Log anzeigen"}
          </button>
          {showLogs && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-xs leading-relaxed text-white/60">
              {logs.map((line, i) => (
                <div key={i} className={line.includes("FEHLER") ? "text-red-400" : ""}>
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
