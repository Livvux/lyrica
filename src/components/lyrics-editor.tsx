"use client";

import type { LyricLine } from "@/types/lyrics";

const FPS = 30;

interface LyricsEditorProps {
  lines: LyricLine[];
  onChange: (lines: LyricLine[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onDeactivate: () => void;
}

export function LyricsEditor({ lines, onChange, onUndo, onRedo, canUndo, canRedo, onDeactivate }: LyricsEditorProps) {
  function updateText(index: number, text: string) {
    onChange(lines.map((line, i) => (i === index ? { ...line, text } : line)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  function addLine(afterIndex: number) {
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
    onChange([...lines.slice(0, afterIndex + 1), newLine, ...lines.slice(afterIndex + 1)]);
  }

  return (
    <section className="panel flex flex-col gap-3" aria-labelledby="lyrics-heading">
      <div className="flex items-center gap-1">
        <h2 id="lyrics-heading" className="flex-1 text-sm font-semibold text-white">Lyrics</h2>
        <button type="button" onClick={onUndo} disabled={!canUndo} className="btn-quiet" aria-keyshortcuts="Meta+Z Control+Z">
          Rückgängig
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} className="btn-quiet" aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z">
          Wiederholen
        </button>
        <button type="button" onClick={onDeactivate} className="btn-quiet">
          Deaktivieren
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/40">Keine Zeilen</p>
      ) : (
        <ol className="-mx-1 flex max-h-[28rem] flex-col overflow-y-auto px-1">
          {lines.map((line, i) => (
            <li
              key={`${line.startSec}-${line.endSec}`}
              className="group flex items-center gap-2 rounded-lg px-2 transition focus-within:bg-white/[0.06] hover:bg-white/[0.04]"
            >
              <span className="w-12 shrink-0 text-xs tabular-nums text-white/35">{formatTime(line.startSec)}</span>
              <input
                type="text"
                aria-label={`Zeile ${i + 1}`}
                value={line.text}
                onChange={(e) => updateText(i, e.target.value)}
                className="min-h-9 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-white outline-none focus-visible:bg-white/5 focus-visible:outline-1 focus-visible:outline-offset-0"
              />
              <div className="flex shrink-0 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <button type="button" onClick={() => addLine(i)} className="btn-quiet size-8 text-base" aria-label={`Zeile nach ${i + 1} einfügen`}>
                  +
                </button>
                <button type="button" onClick={() => removeLine(i)} className="btn-quiet size-8 text-base hover:text-danger" aria-label={`Zeile ${i + 1} löschen`}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <button type="button" onClick={() => addLine(lines.length - 1)} className="btn-quiet self-start">
        + Zeile
      </button>
    </section>
  );
}

function formatTime(sec: number): string {
  const tenths = Math.round(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}
