"use client";

import type { LyricLine } from "@/types/lyrics";

interface LyricsEditorProps {
  lines: LyricLine[];
  onChange: (lines: LyricLine[]) => void;
}

export function LyricsEditor({ lines, onChange }: LyricsEditorProps) {
  function updateLine(index: number, updates: Partial<LyricLine>) {
    const updated = lines.map((line, i) =>
      i === index ? { ...line, ...updates } : line
    );
    onChange(updated);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-white/60 mb-1">
        Lyrics bearbeiten
      </h3>
      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">
        {lines.map((line, i) => (
          <div
            key={i}
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
          </div>
        ))}
      </div>
      {lines.length === 0 && (
        <p className="text-sm text-white/30 text-center py-4">
          Noch keine Lyrics vorhanden
        </p>
      )}
    </div>
  );
}
