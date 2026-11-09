"use client";

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { clampClip, editLineTiming, snapFrame, waveformPeaks } from "@/lib/timeline";
import type { ClipRange, TimingEdit } from "@/lib/timeline";
import type { LyricLine } from "@/types/lyrics";

interface EditorTimelineProps {
  lines: LyricLine[];
  durationSec: number;
  currentFrame: number;
  fps: number;
  waveform?: number[];
  beats?: number[];
  clip: ClipRange;
  onSeek: (frame: number) => void;
  onChange: (lines: LyricLine[]) => void;
  onClipChange: (clip: ClipRange) => void;
}

interface Drag {
  pointerId: number;
  index: number;
  edit: TimingEdit;
  originX: number;
  pixelsPerFrame: number;
  original: LyricLine[];
  latest: LyricLine[];
}

function timecode(frame: number, fps: number): string {
  const sec = Math.floor(frame / fps);
  return `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}:${Math.floor(frame % fps).toString().padStart(2, "0")}`;
}

function FrameInput({ label, value, min, max, onCommit }: {
  label: string; value: number; min: number; max: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  return (
    <label className="flex items-center gap-2 text-xs text-white/55">
      {label}
      <input
        type="number" step={1} min={min} max={max} aria-label={label}
        value={focused ? draft : value}
        onFocus={() => { cancelled.current = false; setDraft(String(value)); setFocused(true); }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          if (cancelled.current) return;
          const number = Number(draft);
          if (draft.trim() && Number.isFinite(number)) onCommit(Math.max(min, Math.min(max, Math.round(number))));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { cancelled.current = true; event.currentTarget.blur(); }
        }}
        className="input w-24 tabular-nums"
      />
    </label>
  );
}

export function EditorTimeline({ lines, durationSec, currentFrame, fps, waveform = [], beats = [], clip,
  onSeek, onChange, onClipChange }: EditorTimelineProps) {
  const [zoom, setZoom] = useState(24);
  const [snap, setSnap] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<LyricLine[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
  const visibleLines = draft ?? lines;
  const active = selected === null ? null : visibleLines[selected];
  const width = Math.max(700, durationSec * zoom);
  const peaks = useMemo(() => waveformPeaks(waveform), [waveform]);
  const waveformPath = useMemo(() => peaks.map((peak, i) => {
    const x = ((i + 0.5) / peaks.length * 1600).toFixed(2);
    const halfHeight = Math.max(0.5, peak * 27);
    return `M${x},${32 - halfHeight}v${halfHeight * 2}`;
  }).join(""), [peaks]);
  const rulerStep = zoom >= 64 ? 1 : zoom >= 16 ? 5 : 15;
  const rulerMarks = Math.ceil(durationSec / rulerStep);
  // A 2-hour recording still gets bounded ruler and beat geometry.
  const rulerStride = Math.max(1, Math.ceil(rulerMarks / 1000));
  const beatStride = Math.max(1, Math.ceil(beats.length / 2000));

  function seek(event: PointerEvent<HTMLElement>) {
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds || drag.current) return;
    onSeek(Math.max(0, Math.min(totalFrames - 1, Math.round((event.clientX - bounds.left) / bounds.width * totalFrames))));
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number, edit: TimingEdit) {
    if (event.button !== 0 || !track.current) return;
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(index);
    drag.current = { pointerId: event.pointerId, index, edit, originX: event.clientX,
      pixelsPerFrame: track.current.getBoundingClientRect().width / totalFrames, original: lines, latest: lines };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const original = current.original[current.index];
    const delta = Math.round((event.clientX - current.originX) / current.pixelsPerFrame);
    let frame = (current.edit === "end" ? original.endFrame : original.startFrame) + delta;
    if (snap && !event.altKey) {
      const targets = [0, totalFrames, currentFrame, clip.startFrame, clip.endFrame,
        ...current.original.flatMap((line, i) => i === current.index ? [] : [line.startFrame, line.endFrame]),
        ...beats.map((seconds) => Math.round(seconds * fps))];
      const threshold = 7 / current.pixelsPerFrame;
      const snapped = snapFrame(frame, targets, threshold);
      if (current.edit === "move") {
        const length = original.endFrame - original.startFrame;
        const endSnapped = snapFrame(frame + length, targets, threshold) - length;
        const startDistance = snapped === frame && !targets.includes(frame) ? Infinity : Math.abs(snapped - frame);
        const endDistance = endSnapped === frame && !targets.includes(frame + length) ? Infinity : Math.abs(endSnapped - frame);
        frame = endDistance < startDistance ? endSnapped : snapped;
      } else frame = snapped;
    }
    current.latest = editLineTiming(current.original, current.index, current.edit, frame, totalFrames, fps);
    setDraft(current.latest);
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDraft(null);
    // An undo or another editor must not be overwritten by a stale drag.
    if (commit && current.original === lines && current.latest !== current.original) onChange(current.latest);
  }

  function editSelected(edit: TimingEdit, frame: number) {
    if (selected === null) return;
    const changed = editLineTiming(lines, selected, edit, frame, totalFrames, fps);
    if (changed !== lines) onChange(changed);
  }

  function handleBlockKey(event: KeyboardEvent<HTMLButtonElement>, index: number, edit: TimingEdit = "move") {
    if (event.key === "Escape") {
      drag.current = null;
      setDraft(null);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(index);
    const delta = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1);
    const boundary = edit === "end" ? lines[index].endFrame : lines[index].startFrame;
    const changed = editLineTiming(lines, index, edit, boundary + delta, totalFrames, fps);
    if (changed !== lines) onChange(changed);
  }

  return (
    <section className="panel min-w-0 space-y-3" aria-label="Timeline">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="mr-auto text-sm font-semibold">Timeline</h2>
        <output className="font-mono text-xs tabular-nums text-accent" aria-label="Abspielposition">{timecode(currentFrame, fps)}</output>
        <button type="button" className="btn-quiet" aria-pressed={snap} onClick={() => setSnap(!snap)} title="An Kanten, Beats und Abspielposition einrasten; Alt deaktiviert temporär">
          Einrasten {snap ? "an" : "aus"}
        </button>
        <label className="flex items-center gap-2 text-xs text-white/55">
          Zoom
          <input aria-label="Timeline-Zoom" type="range" min={4} max={128} step={4} value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))} className="max-w-28" />
        </label>
        <button type="button" className="btn-quiet" onClick={() => {
          if (scroll.current) scroll.current.scrollLeft = currentFrame / totalFrames * width - scroll.current.clientWidth / 2;
        }}>Zum Abspielkopf</button>
      </div>
      <div ref={scroll} className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
        <div ref={track} className="relative touch-pan-x select-none" style={{ width, minWidth: "100%" }}
          onPointerMove={moveDrag} onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)} onLostPointerCapture={(event) => finishDrag(event, false)}>
          <div
            role="slider" tabIndex={0} aria-label="Abspielposition in Frames" aria-valuemin={0} aria-valuemax={totalFrames - 1}
            aria-valuenow={Math.max(0, Math.min(totalFrames - 1, currentFrame))} aria-valuetext={timecode(currentFrame, fps)}
            className="relative h-8 cursor-crosshair border-b border-white/10 bg-white/[0.02]" onPointerDown={seek}
            onKeyDown={(event) => {
              let frame = currentFrame;
              if (event.key === "ArrowRight") frame += event.shiftKey ? fps : 1;
              else if (event.key === "ArrowLeft") frame -= event.shiftKey ? fps : 1;
              else if (event.key === "Home") frame = 0;
              else if (event.key === "End") frame = totalFrames - 1;
              else return;
              event.preventDefault(); event.stopPropagation();
              onSeek(Math.max(0, Math.min(totalFrames - 1, frame)));
            }}>
            {Array.from({ length: Math.floor(rulerMarks / rulerStride) + 1 }, (_, index) => {
              const seconds = index * rulerStep * rulerStride;
              return <span key={index} className="pointer-events-none absolute top-0 h-full border-l border-white/15 pl-1 pt-2 text-[10px] tabular-nums text-white/60"
                style={{ left: `${seconds / durationSec * 100}%` }}>{Math.floor(seconds / 60)}:{Math.floor(seconds % 60).toString().padStart(2, "0")}</span>;
            })}
          </div>
          <div className="relative h-20 cursor-crosshair overflow-hidden border-b border-white/10" onPointerDown={seek}>
            {peaks.length > 0 ? <svg viewBox="0 0 1600 64" preserveAspectRatio="none" className="pointer-events-none h-full w-full" aria-label="Audio-Wellenform" role="img">
              <path d={waveformPath} fill="none" stroke="currentColor" strokeWidth={0.75} className="text-accent/65" />
            </svg> : <div className="absolute inset-x-0 top-1/2 border-t border-white/15" />}
            {beats.filter((_, i) => i % beatStride === 0).map((seconds, i) => <span key={i} className="pointer-events-none absolute inset-y-0 border-l border-white/15"
              style={{ left: `${seconds / durationSec * 100}%` }} />)}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: `${clip.startFrame / totalFrames * 100}%` }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60" style={{ width: `${(totalFrames - clip.endFrame) / totalFrames * 100}%` }} />
            <div className="pointer-events-none absolute inset-y-0 border-x border-accent/60" style={{ left: `${clip.startFrame / totalFrames * 100}%`, width: `${(clip.endFrame - clip.startFrame) / totalFrames * 100}%` }} />
          </div>
          <div className="relative h-16" onPointerDown={seek}>
            {visibleLines.map((line, index) => (
              <div key={index} className={`absolute top-2 flex h-11 min-w-1 overflow-hidden rounded-md border ${selected === index ? "border-accent bg-accent/25" : "border-white/20 bg-white/10"}`}
                style={{ left: `${line.startFrame / totalFrames * 100}%`, width: `${(line.endFrame - line.startFrame) / totalFrames * 100}%` }}>
                <button type="button" aria-label={`Anfang Zeile ${index + 1} ziehen`} title="Anfang ziehen"
                  className="z-10 w-2 shrink-0 touch-none cursor-ew-resize bg-white/15 hover:bg-accent/50"
                  onPointerDown={(event) => startDrag(event, index, "start")} onKeyDown={(event) => handleBlockKey(event, index, "start")} />
                <button type="button" aria-label={`Zeile ${index + 1}: ${line.text || "Leer"}`} aria-pressed={selected === index}
                  title="Ziehen: verschieben · Pfeile: 1 Frame · Umschalt+Pfeile: 10 Frames"
                  className="min-w-0 flex-1 touch-none cursor-grab truncate px-2 text-left text-xs active:cursor-grabbing"
                  onClick={() => setSelected(index)} onPointerDown={(event) => startDrag(event, index, "move")}
                  onKeyDown={(event) => handleBlockKey(event, index)}>{line.text || `Zeile ${index + 1}`}</button>
                <button type="button" aria-label={`Ende Zeile ${index + 1} ziehen`} title="Ende ziehen"
                  className="z-10 w-2 shrink-0 touch-none cursor-ew-resize bg-white/15 hover:bg-accent/50"
                  onPointerDown={(event) => startDrag(event, index, "end")} onKeyDown={(event) => handleBlockKey(event, index, "end")} />
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent" style={{ left: `${currentFrame / totalFrames * 100}%` }}>
            <span className="absolute -left-1 top-0 h-2 w-2 rotate-45 bg-accent" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs font-medium text-white/75">Export-Clip</span>
        <FrameInput label="In (Frame)" value={clip.startFrame} min={0} max={clip.endFrame - 1}
          onCommit={(startFrame) => onClipChange(clampClip({ ...clip, startFrame }, totalFrames))} />
        <FrameInput label="Out (exklusiv)" value={clip.endFrame} min={clip.startFrame + 1} max={totalFrames}
          onCommit={(endFrame) => onClipChange(clampClip({ ...clip, endFrame }, totalFrames))} />
        <button type="button" className="btn-quiet" onClick={() => onClipChange({ startFrame: 0, endFrame: totalFrames })}>Ganzer Song</button>
        <span className="ml-auto text-xs tabular-nums text-white/60">{((clip.endFrame - clip.startFrame) / fps).toFixed(2)} s · {fps} fps</span>
      </div>
      {active && <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-3">
        <span className="max-w-52 truncate text-xs text-white/75" title={active.text}>Zeile {selected! + 1} · {active.text}</span>
        <FrameInput label="Zeilenanfang" value={active.startFrame} min={selected === 0 ? 0 : visibleLines[selected! - 1].endFrame} max={active.endFrame - 1}
          onCommit={(frame) => editSelected("start", frame)} />
        <FrameInput label="Zeilenende" value={active.endFrame} min={active.startFrame + 1} max={visibleLines[selected! + 1]?.startFrame ?? totalFrames}
          onCommit={(frame) => editSelected("end", frame)} />
      </div>}
    </section>
  );
}
