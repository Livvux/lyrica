"use client";

import { useState, useCallback, useEffect, useMemo, useDeferredValue } from "react";
import dynamic from "next/dynamic";
import { UploadForm } from "@/components/upload-form";
import { LyricsEditor } from "@/components/lyrics-editor";
import { ExportButton } from "@/components/export-button";
import { CustomizationPanel } from "@/components/customization-panel";
import { LyricsValidationPanel } from "@/components/lyrics-validation-panel";
import { MixTracklistPanel } from "@/components/mix-tracklist-panel";
import { ErrorBoundary } from "@/components/error-boundary";
import { groupWordsIntoLines, getDurationInFrames } from "@/lib/timing";
import { validateLines } from "@/lib/lyrics-validation";
import { useHistory } from "@/lib/use-history";
import { savePersistence, loadPersistence } from "@/lib/use-persistence";
import { DEFAULT_STYLE } from "@/types/lyrics";
import type { LyricLine, VideoConfig, StyleConfig, ValidationResult, SongMatch, ReferenceLyrics, MixTrack, LineValidation } from "@/types/lyrics";

const PreviewPlayer = dynamic(() => import("@/components/preview-player").then((m) => m.PreviewPlayer), {
  ssr: false,
  // Same footprint as the player so nothing jumps when it arrives.
  loading: () => <div className="aspect-video rounded-2xl border border-white/10 bg-black" aria-hidden="true" />,
});

type ValidationPhase = "idle" | "identifying" | "fetching" | "validating" | "done";
const NO_LINES: LyricLine[] = [];

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

async function fetchReference(artist: string, title: string, durationSec: number): Promise<ReferenceLyrics | null> {
  const data = await postJson("/api/lyrics", { artist, title, durationSec });
  return data.lyrics ?? null;
}

export default function Home() {
  const { value: lines, set: setLines, reset: resetLines, undo, redo, canUndo, canRedo } = useHistory<LyricLine[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [style, setStyle] = useState<StyleConfig>(DEFAULT_STYLE);
  const [lyricsActive, setLyricsActive] = useState(false);
  const [transcribing, setTranscribing] = useState<"lyrics" | "mix" | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [validationPhase, setValidationPhase] = useState<ValidationPhase>("idle");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [pendingLines, setPendingLines] = useState<LyricLine[]>([]);
  const [showMixPanel, setShowMixPanel] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const audioFilename = audioUrl?.split("/").pop() || null;

  // Restore the last session once on mount.
  // Applied in a microtask: synchronous setState in an effect trips react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const saved = loadPersistence();
      if (saved) {
        setAudioUrl(saved.audioUrl ?? null);
        setDurationSec(saved.durationSec ?? 0);
        setOriginalFilename(saved.originalFilename ?? null);
        if (saved.style) setStyle({ ...DEFAULT_STYLE, ...saved.style, waveConfig: { ...DEFAULT_STYLE.waveConfig, ...(saved.style.waveConfig ?? {}) } });
        setLyricsActive(Boolean(saved.lyricsActive));
        if (saved.lines?.length) resetLines(saved.lines);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [resetLines]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      savePersistence({ lines, audioUrl, originalFilename, durationSec, style, lyricsActive });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [lines, audioUrl, originalFilename, durationSec, style, lyricsActive, hydrated]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const handleAudioUploaded = useCallback(
    (url: string, duration: number, filename: string) => {
      if (lines.length > 0 && !window.confirm("Neuer Song ersetzt die bearbeiteten Lyrics. Fortfahren?")) return;
      setAudioUrl(url);
      setDurationSec(duration);
      setOriginalFilename(filename);
      resetLines([]);
      setLyricsActive(false);
      setTranscribeError(null);
      setValidationPhase("idle");
      setValidationResult(null);
      setShowMixPanel(false);
      setPendingLines([]);
    },
    [resetLines, lines.length]
  );

  async function transcribe(kind: "lyrics" | "mix"): Promise<LyricLine[] | null> {
    if (!audioFilename) return null;
    setTranscribing(kind);
    setTranscribeError(null);
    try {
      const formData = new FormData();
      formData.append("audioFilename", audioFilename);
      const res = await fetch("/api/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || data.error) {
        setTranscribeError(data.error ?? "Fehler bei der Transkription.");
        return null;
      }
      const grouped = groupWordsIntoLines(data.result.words);
      setPendingLines(grouped);
      return grouped;
    } catch {
      setTranscribeError("Fehler bei der Transkription.");
      return null;
    } finally {
      setTranscribing(null);
    }
  }

  async function handleActivateLyrics() {
    const grouped = await transcribe("lyrics");
    if (!grouped) return;
    setValidationPhase("identifying");
    setValidationResult(null);

    let songMatch: SongMatch | null = null;
    let reference: ReferenceLyrics | null = null;
    try {
      songMatch = (await postJson("/api/identify", { audioFilename, originalFilename })).match ?? null;
      if (songMatch) {
        setValidationPhase("fetching");
        reference = await fetchReference(songMatch.artist, songMatch.title, durationSec);
      }
    } catch {
      // Identification is optional; validate without a reference.
    }

    setValidationPhase("validating");
    try {
      setValidationResult(validateLines(grouped, songMatch, reference));
      setValidationPhase("done");
    } catch {
      acceptLines(grouped);
    }
  }

  async function handleActivateMix() {
    if (await transcribe("mix")) setShowMixPanel(true);
  }

  async function handleMixConfirm(tracks: MixTrack[]) {
    setShowMixPanel(false);
    setValidationPhase("fetching");
    setValidationResult(null);

    const lineValidations: LineValidation[] = [];
    let weightedScore = 0;
    let totalLines = 0;
    let mergedReference: ReferenceLyrics | null = null;

    for (const track of tracks) {
      const indices: number[] = [];
      pendingLines.forEach((line, i) => {
        if (line.startSec >= track.startSec && line.startSec < track.endSec) indices.push(i);
      });
      if (indices.length === 0) continue;
      const trackLines = indices.map((i) => pendingLines[i]);

      let reference: ReferenceLyrics | null = null;
      try {
        reference = await fetchReference(track.artist, track.title, track.endSec - track.startSec);
        mergedReference ??= reference;
      } catch {
        // validate this segment without reference
      }

      setValidationPhase("validating");
      const segment = validateLines(trackLines, { artist: track.artist, title: track.title }, reference);
      for (const v of segment.lineValidations) {
        lineValidations.push({ ...v, lineIndex: indices[v.lineIndex] ?? v.lineIndex });
      }
      weightedScore += segment.overallScore * trackLines.length;
      totalLines += trackLines.length;
    }

    setValidationResult({
      songMatch: tracks[0] ? { artist: tracks[0].artist, title: tracks[0].title } : null,
      reference: mergedReference,
      overallScore: totalLines > 0 ? Math.round(weightedScore / totalLines) : 100,
      lineValidations,
    });
    setValidationPhase("done");
  }

  function acceptLines(accepted: LyricLine[]) {
    setLines(accepted);
    setLyricsActive(true);
    setValidationPhase("idle");
    setValidationResult(null);
    setShowMixPanel(false);
    setPendingLines([]);
  }

  function handleDeactivateLyrics() {
    setLyricsActive(false);
    setValidationPhase("idle");
    setValidationResult(null);
    setPendingLines([]);
  }

  const activeLines = lyricsActive ? lines : NO_LINES;
  const config = useMemo<VideoConfig | null>(() => {
    if (!audioUrl || durationSec <= 0) return null;
    return {
      lines: activeLines,
      audioUrl,
      style,
      durationInFrames: getDurationInFrames(durationSec),
      fps: 30,
      width: 1920,
      height: 1080,
    };
  }, [audioUrl, durationSec, style, activeLines]);

  // Typing and slider drags stay responsive; the player catches up at lower priority.
  const previewConfig = useDeferredValue(config);

  function renderLyrics() {
    if (lyricsActive) {
      return (
        <LyricsEditor
          lines={lines}
          onChange={setLines}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onDeactivate={handleDeactivateLyrics}
        />
      );
    }
    if (validationPhase !== "idle") {
      return (
        <LyricsValidationPanel
          lines={pendingLines}
          phase={validationPhase}
          result={validationResult}
          onAccept={acceptLines}
          onSkip={() => acceptLines(pendingLines)}
        />
      );
    }
    if (showMixPanel && audioFilename) {
      return <MixTracklistPanel audioFilename={audioFilename} onConfirm={handleMixConfirm} onSkip={() => acceptLines(pendingLines)} />;
    }
    return (
      <section className="panel flex flex-col gap-3" aria-labelledby="lyrics-heading">
        <h2 id="lyrics-heading" className="text-sm font-semibold text-white">Lyrics</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleActivateLyrics} disabled={transcribing !== null} className="btn-solid flex-1">
            {transcribing === "lyrics" ? "Wird erkannt …" : "Lyrics erkennen"}
          </button>
          <button type="button" onClick={handleActivateMix} disabled={transcribing !== null} className="btn flex-1">
            {transcribing === "mix" && <span className="spinner" aria-hidden="true" />}
            {transcribing === "mix" ? "Wird erkannt …" : "Mix erkennen"}
          </button>
        </div>
        <p aria-live="polite" className="text-sm text-danger empty:hidden">{transcribeError}</p>
      </section>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-8 sm:px-6">
      <header className="flex h-16 items-center">
        <h1 className="text-lg font-semibold tracking-tight">Lyrica</h1>
      </header>

      {!hydrated ? null : !config ? (
        <div className="mx-auto max-w-xl pt-[8vh] sm:pt-[14vh]">
          <UploadForm onAudioUploaded={handleAudioUploaded} />
        </div>
      ) : (
        // Mobile: one column in flow order. Desktop: sticky preview + export left, editing right.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-6">
          <div className="contents lg:sticky lg:top-6 lg:flex lg:flex-col lg:gap-4">
            <div className="order-1">
              <UploadForm onAudioUploaded={handleAudioUploaded} current={originalFilename ?? "Song"} />
            </div>
            <div className="order-2">
              <ErrorBoundary>
                {previewConfig && <PreviewPlayer config={previewConfig} />}
              </ErrorBoundary>
            </div>
            <div className="order-5">
              <ExportButton config={config} />
            </div>
          </div>
          <div className="contents lg:flex lg:flex-col lg:gap-4">
            <div className="order-3">{renderLyrics()}</div>
            <div className="order-4">
              <CustomizationPanel style={style} onChange={setStyle} lyricsActive={lyricsActive} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
