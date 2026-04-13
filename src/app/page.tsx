"use client";

import { useState, useCallback, useEffect, useMemo, useDeferredValue, useRef } from "react";
import { UploadForm } from "@/components/upload-form";
import { PreviewPlayer } from "@/components/preview-player";
import { LyricsEditor } from "@/components/lyrics-editor";
import { ExportButton } from "@/components/export-button";
import { CustomizationPanel } from "@/components/customization-panel";
import { LyricsValidationPanel } from "@/components/lyrics-validation-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { groupWordsIntoLines, getDurationInFrames } from "@/lib/timing";
import { validateLines } from "@/lib/lyrics-validation";
import { useHistory } from "@/lib/use-history";
import { savePersistence, loadPersistence } from "@/lib/use-persistence";
import { DEFAULT_STYLE } from "@/types/lyrics";
import type { LyricLine, VideoConfig, StyleConfig, ValidationResult, SongMatch, ReferenceLyrics } from "@/types/lyrics";

type ValidationPhase = "idle" | "identifying" | "fetching" | "validating" | "done";

export default function Home() {
  const linesHistory = useHistory<LyricLine[]>([]);
  const lines = linesHistory.value;
  const setLines = linesHistory.set;
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [style, setStyle] = useState<StyleConfig>(DEFAULT_STYLE);
  const [lyricsActive, setLyricsActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [validationPhase, setValidationPhase] = useState<ValidationPhase>("idle");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [pendingLines, setPendingLines] = useState<LyricLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const previewUpdateMark = useRef(0);

  // Restore from localStorage on mount
  useEffect(() => {
    const saved = loadPersistence();
    if (saved) {
      if (saved.audioUrl) setAudioUrl(saved.audioUrl);
      if (saved.durationSec) setDurationSec(saved.durationSec);
      if (saved.style) setStyle({ ...DEFAULT_STYLE, ...saved.style, waveConfig: { ...DEFAULT_STYLE.waveConfig, ...(saved.style.waveConfig ?? {}) } });
      if (saved.lyricsActive) setLyricsActive(saved.lyricsActive);
      if (saved.lines?.length) setLines(saved.lines);
    }
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage on every change
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      savePersistence({ lines, audioUrl, durationSec, style, lyricsActive });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [lines, audioUrl, durationSec, style, lyricsActive, hydrated]);

  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          linesHistory.redo();
        } else {
          linesHistory.undo();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [linesHistory]);

  const handleAudioUploaded = useCallback(
    (url: string, duration: number) => {
      if (lines.length > 0) {
        const confirmed = window.confirm(
          "Du hast bereits Lyrics bearbeitet. Beim Hochladen eines neuen Songs werden die Lyrics zurückgesetzt. Fortfahren?"
        );
        if (!confirmed) return;
      }
      setAudioUrl(url);
      setDurationSec(duration);
      setLines([]);
      setLyricsActive(false);
      setTranscribeError(null);
    },
    [setLines, lines]
  );

  async function handleActivateLyrics() {
    if (!audioUrl) return;
    setIsTranscribing(true);
    setTranscribeError(null);
    try {
      const audioFilename = audioUrl.split("/").pop();
      if (!audioFilename) {
        setTranscribeError("Ungültige Audio-URL.");
        return;
      }
      const formData = new FormData();
      formData.append("audioFilename", audioFilename);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setTranscribeError(data.error ?? "Fehler bei der Transkription.");
        return;
      }
      const grouped = groupWordsIntoLines(data.result.words);
      setPendingLines(grouped);
      try {
        await runValidation(audioFilename, grouped);
      } catch {
        // Validation ist optional — Fehler werden graceful behandelt
      }
    } catch {
      setTranscribeError("Fehler bei der Transkription.");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function runValidation(audioFilename: string, grouped: LyricLine[]) {
    setValidationPhase("identifying");
    setValidationResult(null);

    let songMatch: SongMatch | null = null;
    let reference: ReferenceLyrics | null = null;

    try {
      // Step 1: Identify song
      const identifyRes = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioFilename }),
      });
      const identifyData = await identifyRes.json();
      songMatch = identifyData.match ?? null;

      // Step 2: Fetch reference lyrics if song was identified
      if (songMatch) {
        setValidationPhase("fetching");
        const lyricsRes = await fetch("/api/lyrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            artist: songMatch.artist,
            title: songMatch.title,
            durationSec,
          }),
        });
        const lyricsData = await lyricsRes.json();
        reference = lyricsData.lyrics ?? null;
      }
    } catch {
      // Graceful: proceed without identification
    }

    // Step 3: Validate
    setValidationPhase("validating");
    const result = validateLines(grouped, songMatch, reference);
    setValidationResult(result);
    setValidationPhase("done");
  }

  function handleValidationAccept(acceptedLines: LyricLine[]) {
    setLines(acceptedLines);
    setLyricsActive(true);
    setValidationPhase("idle");
    setValidationResult(null);
    setPendingLines([]);
  }

  function handleValidationSkip() {
    setLines(pendingLines);
    setLyricsActive(true);
    setValidationPhase("idle");
    setValidationResult(null);
    setPendingLines([]);
  }

  function handleDeactivateLyrics() {
    setLyricsActive(false);
    setValidationPhase("idle");
    setValidationResult(null);
    setPendingLines([]);
  }

  const config = useMemo<VideoConfig | null>(() => {
    if (!audioUrl || durationSec <= 0) return null;
    return {
      lines: lyricsActive ? lines : [],
      audioUrl,
      style,
      durationInFrames: getDurationInFrames(durationSec),
      fps: 30,
      width: 1920,
      height: 1080,
    };
  }, [audioUrl, durationSec, style, lyricsActive, lines]);

  const previewConfig = useDeferredValue(config);

  useEffect(() => {
    if (!config) return;
    previewUpdateMark.current = performance.now();
  }, [config]);

  useEffect(() => {
    if (!previewConfig || process.env.NODE_ENV !== "development") return;
    if (previewUpdateMark.current === 0) return;
    const lagMs = Math.round(performance.now() - previewUpdateMark.current);
    if (lagMs >= 120) {
      console.debug(`[perf] preview update lag ${lagMs}ms`);
    }
  }, [previewConfig]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Lyrica</h1>
        <p className="mt-2 text-sm text-white/50">
          Lade einen Song hoch und erstelle ein Beat-Video. Lyrics optional.
        </p>
      </header>

      <UploadForm onAudioUploaded={handleAudioUploaded} />

      {config && (
        <>
          <ErrorBoundary>
            {previewConfig && <PreviewPlayer config={previewConfig} />}
          </ErrorBoundary>
          <CustomizationPanel
            style={style}
            onChange={setStyle}
            lyricsActive={lyricsActive}
          />

          {validationPhase !== "idle" && !lyricsActive ? (
            <LyricsValidationPanel
              lines={pendingLines}
              phase={validationPhase as "identifying" | "fetching" | "validating" | "done"}
              result={validationResult}
              onAccept={handleValidationAccept}
              onSkip={handleValidationSkip}
            />
          ) : !lyricsActive ? (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleActivateLyrics}
                disabled={isTranscribing}
                className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isTranscribing
                  ? "Lyrics werden generiert..."
                  : "Lyrics aktivieren"}
              </button>
              {transcribeError && (
                <p className="text-sm text-red-400 text-center">
                  {transcribeError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-white/60">Lyrics</h3>
                <button
                  onClick={handleDeactivateLyrics}
                  className="text-xs text-white/40 transition hover:text-white/60"
                >
                  Lyrics deaktivieren
                </button>
              </div>
              <LyricsEditor
                lines={lines}
                onChange={setLines}
                onUndo={linesHistory.undo}
                onRedo={linesHistory.redo}
                canUndo={linesHistory.canUndo}
                canRedo={linesHistory.canRedo}
              />
            </div>
          )}

          <ExportButton config={config} />
        </>
      )}
    </main>
  );
}
