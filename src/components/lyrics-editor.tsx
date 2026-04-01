"use client";

import type { LyricLine } from "@/types/lyrics";

interface LyricsEditorProps {
  lines: LyricLine[];
  onChange: (lines: LyricLine[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function LyricsEditor({ lines, onChange, onUndo, onRedo, canUndo, canRedo }: LyricsEditorProps) {
  function updateLine(index: number, updates: Partial<LyricLine>) {
    const updated = lines.map((line, i) =>
      i === index ? { ...line, ...updates } : line
    );
    onChange(updated);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  function addLine(afterIndex: number) {
    const FPS = 30;
    const prev = lines[afterIndex];
    const next = lines[afterIndex + 1];
    const startSec = prev ? prev.endSec : 0;
    const endSec = next ? next.startSec : startSec + 3;
    const newLine: LyricLine = {
      text: "",
      startSec,
      endSec,
      startFrame: Math.round(startSec * FPS),
      endFrame: Math.round(endSec * FPS),
      words: [],
    };
    const updated = [
      ...lines.slice(0, afterIndex + 1),
      newLine,
      ...lines.slice(afterIndex + 1),
    ];
    onChange(updated);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-white/60">
          Lyrics bearbeiten
        </h3>
        {(onUndo || onRedo) && (
          <div className="flex gap-1">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="rounded px-2 py-0.5 text-xs text-white/40 transition hover:bg-white/10 hover:text-white/60 disabled:opacity-30 disabled:pointer-events-none"
              title="Rückgängig (Cmd+Z)"
            >
              Rückgängig
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="rounded px-2 py-0.5 text-xs text-white/40 transition hover:bg-white/10 hover:text-white/60 disabled:opacity-30 disabled:pointer-events-none"
              title="Wiederholen (Cmd+Shift+Z)"
            >
              Wiederholen
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">
        {lines.map((line, i) => (
          <div
            key={`${line.startSec}-${line.endSec}`}
            className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
          >
            <span className="text-xs text-white/30 w-6 shrink-0 text-right">
              {i + 1}
            </span>
            <input
              type="text"
              value={line.text}
              onChange={(e) => updateLine(i, { text: e.target.value })}
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
            />
            <span className="text-xs text-white/30 shrink-0">
              {line.startSec.toFixed(1)}s – {line.endSec.toFixed(1)}s
            </span>
            <button
              onClick={() => removeLine(i)}
              className="text-white/20 hover:text-red-400 transition text-sm"
              title="Zeile entfernen"
            >
              ×
            </button>
            <button
              onClick={() => addLine(i)}
              className="text-white/20 hover:text-green-400 transition text-sm"
              title="Zeile danach einfügen"
            >
              +
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => addLine(lines.length - 1)}
        className="self-start rounded px-2 py-1 text-xs text-white/30 hover:text-white/60 transition"
      >
        + Zeile hinzufügen
      </button>
      {lines.length === 0 && (
        <p className="text-sm text-white/30 text-center py-4">
          Noch keine Lyrics vorhanden
        </p>
      )}
    </div>
  );
}
