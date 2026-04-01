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

interface RenderMetrics {
  fps: number;
  framesRendered: number;
  totalFrames: number;
  elapsedSec: number;
  etaSec: number;
  cpu: {
    cpuPercent: number;
    memUsedMb: number;
    memTotalMb: number;
    memPercent: number;
  };
}

interface RenderSummary {
  totalFrames: number;
  totalTimeSec: number;
  avgFps: number;
  concurrency: number;
  cpuCount: number;
  peakCpuPercent: number;
  peakMemMb: number;
  memTotalMb: number;
  resolution: string;
  quality: string;
  hints: string[];
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function MeterBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min(Math.round((value / max) * 100), 100);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-white/50">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function ExportButton({ config }: ExportButtonProps) {
  const [state, setState] = useState<RenderState>({ status: "idle" });
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [metrics, setMetrics] = useState<RenderMetrics | null>(null);
  const [summary, setSummary] = useState<RenderSummary | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function addLog(message: string) {
    const ts = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, `[${ts}] ${message}`]);
  }

  async function handleExport(quality: RenderQuality) {
    setLogs([]);
    setShowLogs(false);
    setMetrics(null);
    setSummary(null);
    addLog(`Export gestartet: ${quality === "draft" ? "Draft 720p" : "Full 1080p"}`);
    setState({ status: "bundling", progress: 0 });

    const exportConfig: VideoConfig = {
      ...config,
      renderQuality: quality,
    };

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportConfig),
        signal: controller.signal,
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
          } else if (data.phase === "metrics") {
            setMetrics(data.metrics);
          } else if (data.phase === "summary") {
            setSummary(data.summary);
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
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        addLog("Export abgebrochen.");
        setState({ status: "idle" });
        return;
      }
      setState({ status: "error", message: "Fehler beim Exportieren." });
    } finally {
      abortControllerRef.current = null;
      setState((prev) => (prev.status === "error" ? prev : { status: "idle" }));
    }
  }

  const isActive = state.status !== "idle" && state.status !== "error";
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
        <div className="flex flex-col gap-3">
          {/* Progress bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-sm text-white/80">
              <span className="font-medium">{label}</span>
              <div className="flex items-center gap-3">
                <span className="tabular-nums font-semibold">{percent}%</span>
                <button
                  onClick={() => abortControllerRef.current?.abort()}
                  className="rounded-md border border-white/20 px-2.5 py-0.5 text-xs text-white/60 transition hover:border-red-400/50 hover:text-red-400"
                >
                  Abbrechen
                </button>
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Live metrics panel */}
          {metrics && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="mb-2 grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold tabular-nums text-white">{metrics.fps}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">FPS</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-white">{metrics.framesRendered}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">
                    / {metrics.totalFrames}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-white">{formatTime(metrics.elapsedSec)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Vergangen</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-white">~{formatTime(metrics.etaSec)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Verbleibend</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <MeterBar
                  value={metrics.cpu.cpuPercent}
                  max={100}
                  color={metrics.cpu.cpuPercent > 80 ? "#ef4444" : metrics.cpu.cpuPercent > 50 ? "#eab308" : "#22c55e"}
                  label={`CPU ${metrics.cpu.cpuPercent}%`}
                />
                <MeterBar
                  value={metrics.cpu.memUsedMb}
                  max={metrics.cpu.memTotalMb}
                  color={metrics.cpu.memPercent > 80 ? "#ef4444" : metrics.cpu.memPercent > 50 ? "#eab308" : "#3b82f6"}
                  label={`RAM ${metrics.cpu.memUsedMb} MB / ${metrics.cpu.memTotalMb} MB`}
                />
              </div>
            </div>
          )}
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

      {/* Performance summary after render */}
      {summary && !isActive && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">
            Performance-Übersicht
          </div>
          <div className="mb-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md bg-white/5 px-2 py-1.5">
              <div className="font-bold tabular-nums text-white">{summary.avgFps} fps</div>
              <div className="text-white/40">Render-Speed</div>
            </div>
            <div className="rounded-md bg-white/5 px-2 py-1.5">
              <div className="font-bold tabular-nums text-white">{formatTime(summary.totalTimeSec)}</div>
              <div className="text-white/40">Gesamtdauer</div>
            </div>
            <div className="rounded-md bg-white/5 px-2 py-1.5">
              <div className="font-bold tabular-nums text-white">{summary.concurrency}x</div>
              <div className="text-white/40">Worker</div>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-md bg-white/5 px-2 py-1.5">
              <div className="font-bold tabular-nums text-white">{summary.peakCpuPercent}%</div>
              <div className="text-white/40">Peak CPU</div>
            </div>
            <div className="rounded-md bg-white/5 px-2 py-1.5">
              <div className="font-bold tabular-nums text-white">{summary.peakMemMb} MB</div>
              <div className="text-white/40">Peak RAM</div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {summary.hints.map((hint, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-white/50">
                <span className="mt-0.5 shrink-0">
                  {hint.includes("gut") || hint.includes("passt") || hint.includes("schnell") || hint.includes("exzellent")
                    ? "●"
                    : hint.includes("knapp") || hint.includes("langsam") || hint.includes("massiv")
                      ? "●"
                      : "●"}
                </span>
                <span
                  className={
                    hint.includes("gut") || hint.includes("passt") || hint.includes("schnell") || hint.includes("exzellent")
                      ? "text-green-400/70"
                      : hint.includes("knapp") || hint.includes("langsam") || hint.includes("massiv")
                        ? "text-amber-400/70"
                        : "text-white/50"
                  }
                >
                  {hint}
                </span>
              </div>
            ))}
          </div>
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
