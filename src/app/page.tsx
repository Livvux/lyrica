"use client";

import { useState, useCallback, useEffect, useMemo, useDeferredValue, useRef } from "react";
import dynamic from "next/dynamic";
import type { PlayerRef } from "@remotion/player";
import { EditorTimeline } from "@/components/editor-timeline";
import { ASPECT_RATIOS } from "@/lib/video-format";
import type { AspectRatio } from "@/lib/video-format";
import { useAudioAnalysis } from "@/lib/use-audio-analysis";
import { backupMedia, restoreMedia } from "@/lib/project-media";
import type { PersistedState } from "@/lib/use-persistence";
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
import { savePersistence, readPersistence } from "@/lib/use-persistence";
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

const INITIAL_EDIT = { lines: [] as LyricLine[], style: DEFAULT_STYLE, lyricsActive: false,
  aspectRatio: "16:9" as AspectRatio, clip: null as PersistedState["clip"], beatSensitivity: 1,
  manualBeats: undefined as number[] | undefined };

export default function Home() {
  const { value: edit, set: setEdit, reset: resetEdit, undo, redo, canUndo, canRedo } = useHistory(INITIAL_EDIT);
  const { lines, style, lyricsActive, aspectRatio, clip, beatSensitivity, manualBeats } = edit;
  const setLines = useCallback((lines: LyricLine[]) => setEdit(s => ({ ...s, lines })), [setEdit]);
  const setStyle = useCallback((style: StyleConfig | ((previous: StyleConfig) => StyleConfig)) => setEdit(s => ({ ...s, style: typeof style === "function" ? style(s.style) : style })), [setEdit]);
  const setLyricsActive = useCallback((lyricsActive: boolean) => setEdit(s => ({ ...s, lyricsActive })), [setEdit]);
  const playerRef = useRef<PlayerRef>(null);
  const saveBlocked = useRef(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [originalFilename, setOriginalFilename] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState<"lyrics" | "mix" | null>(null);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [validationPhase, setValidationPhase] = useState<ValidationPhase>("idle");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [pendingLines, setPendingLines] = useState<LyricLine[]>([]);
  const [showMixPanel, setShowMixPanel] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const audioFilename = audioUrl ? new URL(audioUrl, "http://localhost").pathname.split("/").pop() ?? null : null;
  const { analysis, loading: analyzing, error: analysisError } = useAudioAnalysis(hydrated ? audioUrl : null);
  const totalFrames = Math.max(1, getDurationInFrames(durationSec));
  const clipRange = useMemo(() => clip ?? { startFrame: 0, endFrame: totalFrames }, [clip, totalFrames]);
  const seek = useCallback((frame: number) => {
    const safe = Math.max(clipRange.startFrame, Math.min(clipRange.endFrame - 1, frame));
    playerRef.current?.seekTo(safe);
    setCurrentFrame(safe);
  }, [clipRange]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const { state: saved, error } = readPersistence();
      if (error && !cancelled) { saveBlocked.current = true; setSaveError(error); }
      if (saved) {
        const recover = async (url: string | null, kind: "audio" | "bg" | "logo") => {
          if (!url) return null;
          try { return await restoreMedia(url, kind); }
          catch (error) {
            if (!cancelled) {
              const message = error instanceof Error ? error.message : "Medien fehlen.";
              if (kind === "audio") setMediaError(message);
              else setBackupError(`${kind === "bg" ? "Hintergrund" : "Logo"}: ${message}`);
            }
            return url;
          }
        };
        const [audio, bgImage, customLogo] = await Promise.all([
          recover(saved.audioUrl, "audio"), recover(saved.style.bgImage, "bg"), recover(saved.style.customLogo, "logo"),
        ]);
        const restored = { ...saved, audioUrl: audio, style: { ...saved.style, bgImage: bgImage ?? saved.style.bgImage, customLogo } };
        if (cancelled) return;
        setAudioUrl(restored.audioUrl);
        setDurationSec(restored.durationSec);
        setOriginalFilename(restored.originalFilename ?? null);
        resetEdit({ lines: restored.lines, style: restored.style, lyricsActive: restored.lyricsActive,
          aspectRatio: restored.aspectRatio, clip: restored.clip, beatSensitivity: restored.beatSensitivity, manualBeats: restored.manualBeats });
      }
      if (!cancelled) setHydrated(true);
    }
    void restore();
    return () => { cancelled = true; };
  }, [resetEdit]);

  useEffect(() => {
    if (!hydrated) return;
    const save = () => {
      if (saveBlocked.current) return;
      const success = savePersistence({ ...edit, audioUrl, originalFilename, durationSec });
      setSaveError(success ? null : "Projekt konnte nicht gespeichert werden. Browserspeicher prüfen.");
    };
    const timer = window.setTimeout(save, 300);
    window.addEventListener("pagehide", save);
    return () => { window.clearTimeout(timer); window.removeEventListener("pagehide", save); };
  }, [edit, audioUrl, originalFilename, durationSec, hydrated]);

  useEffect(() => {
    if (!hydrated || !audioUrl) return;
    let cancelled = false;
    Promise.all([audioUrl, style.bgImage, style.customLogo].filter((url): url is string => Boolean(url)).map(backupMedia))
      .then(() => { if (!cancelled) setBackupError(null); })
      .catch(() => { if (!cancelled) setBackupError("Mediensicherung fehlgeschlagen. Originaldateien aufbewahren."); });
    return () => { cancelled = true; };
  }, [audioUrl, style.bgImage, style.customLogo, hydrated]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") || e.target.closest("[data-timeline-clip]"))) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (e.target instanceof HTMLElement && e.target.closest("button, a, [role=slider], [role=button]")) {
        return;
      } else if (e.code === "Space" && audioUrl) {
        e.preventDefault(); playerRef.current?.toggle();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && audioUrl) {
        e.preventDefault(); seek((playerRef.current?.getCurrentFrame() ?? 0) + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 30 : 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, seek, audioUrl]);

  const handleAudioUploaded = useCallback(
    (url: string, duration: number, filename: string) => {
      if (mediaError && Math.abs(duration - durationSec) > 0.2) {
        setMediaError("Bitte die Originaldatei mit derselben Länge verknüpfen.");
        return;
      }
      if (lines.length > 0 && !window.confirm("Neuer Song ersetzt die bearbeiteten Lyrics. Fortfahren?")) return;
      setAudioUrl(url);
      saveBlocked.current = false;
      setSaveError(null);
      setDurationSec(duration);
      setOriginalFilename(filename);
      // Relinking missing original media preserves the timeline and styling.
      if (!mediaError) resetEdit({ ...edit, lines: [], lyricsActive: false, clip: null, manualBeats: undefined });
      setMediaError(null);
      setCurrentFrame(0);
      setTranscribeError(null);
      setValidationPhase("idle");
      setValidationResult(null);
      setShowMixPanel(false);
      setPendingLines([]);
    },
    [resetEdit, edit, mediaError, lines.length, durationSec]
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
    setEdit(s => ({ ...s, lines: accepted, lyricsActive: true }));
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
      width: ASPECT_RATIOS[aspectRatio].width,
      height: ASPECT_RATIOS[aspectRatio].height,
      clipStartFrame: clipRange.startFrame,
      clipEndFrame: clipRange.endFrame,
      audioAnalysis: analysis ?? undefined,
      beatSensitivity,
      manualBeats,
    };
  }, [audioUrl, durationSec, style, activeLines, aspectRatio, clipRange, analysis, beatSensitivity, manualBeats]);

  // Typing and slider drags stay responsive; the player catches up at lower priority.
  const previewConfig = useDeferredValue(config);

  function renderLyrics() {
    if (lyricsActive) {
      return (
        <LyricsEditor
          durationInFrames={totalFrames}
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
        <button className="btn" type="button" onClick={() => setEdit(s => ({ ...s, lyricsActive: true }))}>Lyrics manuell bearbeiten</button>
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
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pb-6 sm:px-6">
      <header className="flex min-h-16 flex-wrap items-center gap-4 border-b border-white/10 py-3">
        <h1 className="mr-auto text-lg font-semibold tracking-tight">Lyrica <span className="ml-2 text-xs font-normal text-white/60">Studio</span></h1>
        {config && <>
          <button className="btn-quiet" onClick={undo} disabled={!canUndo}>Rückgängig</button>
          <button className="btn-quiet" onClick={redo} disabled={!canRedo}>Wiederholen</button>
          <span role="status" className="text-xs text-white/60">{saveError ?? backupError ?? "Automatisch gespeichert"}</span>
        </>}
      </header>
      {!config && saveError && <p role="alert" className="mt-4 text-warn">{saveError}</p>}
      {mediaError && <div className="my-3 rounded-xl border border-warn/30 p-3 text-warn" role="alert">{mediaError}</div>}
      {!hydrated ? <p className="py-16 text-center text-white/60" role="status">Projekt wird geladen …</p> : !config ? (
        <div className="mx-auto max-w-xl pt-[8vh] sm:pt-[14vh]">
          <UploadForm onAudioUploaded={handleAudioUploaded} />
        </div>
      ) : (
        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[230px_minmax(0,1fr)_340px] xl:items-start">
          <aside className="flex min-w-0 flex-col gap-4 xl:max-h-[60vh] xl:overflow-y-auto" aria-label="Medien und Vorlagen">
            <UploadForm onAudioUploaded={handleAudioUploaded} current={originalFilename ?? "Song"} />
            <section className="panel flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Format</h2>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(ASPECT_RATIOS) as AspectRatio[]).map(ratio => <button type="button" key={ratio} className="btn aria-pressed:border-accent/50 aria-pressed:bg-accent/10" aria-pressed={aspectRatio === ratio} onClick={() => setEdit(s => ({ ...s, aspectRatio: ratio }))}>{ratio}</button>)}
              </div>
            </section>
            <section className="panel flex flex-col gap-3" aria-label="Audioanalyse">
              <h2 className="text-sm font-semibold">Rhythmus <span className="ml-2 font-normal text-white/60">{analyzing ? "Analyse …" : analysis?.bpm ? `${analysis.bpm} BPM` : "Freies Tempo"}</span></h2>
              {analysisError && <p role="alert" className="text-xs text-warn">{analysisError}</p>}
              <label className="field"><span className="label">Empfindlichkeit · {beatSensitivity.toFixed(2)}×</span><input aria-label="Beat-Empfindlichkeit" type="range" min="0.25" max="3" step="0.05" value={beatSensitivity} onChange={e => setEdit(s => ({ ...s, beatSensitivity: Number(e.target.value) }))} /></label>
              <div className="flex flex-wrap gap-1">
                <button className="btn-quiet" type="button" onClick={() => setEdit(s => ({ ...s, manualBeats: [...(s.manualBeats ?? analysis?.beats ?? []), currentFrame / 30].sort((a,b) => a-b).filter((v,i,a) => i === 0 || v-a[i-1] > 1/30) }))}>Beat setzen</button>
                <button className="btn-quiet" type="button" onClick={() => setEdit(s => ({ ...s, manualBeats: (s.manualBeats ?? analysis?.beats ?? []).filter(t => Math.abs(t-currentFrame/30) > 0.1) }))}>Beat entfernen</button>
                <button className="btn-quiet" type="button" disabled={!manualBeats} onClick={() => setEdit(s => ({ ...s, manualBeats: undefined }))}>Erkennung nutzen</button>
              </div>
            </section>
            <ExportButton config={config} />
          </aside>
          <div className="min-w-0 rounded-2xl border border-white/10 bg-black/40 p-3 sm:p-5">
            <ErrorBoundary>{previewConfig && <PreviewPlayer config={previewConfig} playerRef={playerRef} onFrameChange={setCurrentFrame} />}</ErrorBoundary>
            <p className="mt-3 text-center text-xs tabular-nums text-white/60">{ASPECT_RATIOS[aspectRatio].width} × {ASPECT_RATIOS[aspectRatio].height} · 30 fps</p>
          </div>
          <aside className="flex min-w-0 flex-col gap-4 xl:max-h-[60vh] xl:overflow-y-auto" aria-label="Eigenschaften">
            <CustomizationPanel style={style} onChange={setStyle} lyricsActive={lyricsActive} />
            {renderLyrics()}
          </aside>
          <div className="min-w-0 xl:col-span-3">
            <EditorTimeline lines={activeLines} durationSec={durationSec} fps={30} currentFrame={currentFrame} waveform={analysis?.waveform} beats={manualBeats ?? analysis?.beats} clip={clipRange} onSeek={seek} onChange={setLines} onClipChange={clip => setEdit(s => ({ ...s, clip }))} />
          </div>
        </div>
      )}
    </main>
  );
}
