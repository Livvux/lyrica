"use client";

import { useState, useEffect } from "react";
import type { MixTrack } from "@/types/lyrics";

interface MixTracklistPanelProps {
  audioFilename: string;
  onConfirm: (tracks: MixTrack[]) => void;
  onSkip: () => void;
}

export function MixTracklistPanel({
  audioFilename,
  onConfirm,
  onSkip,
}: MixTracklistPanelProps) {
  const [scanning, setScanning] = useState(true);
  const [tracks, setTracks] = useState<MixTrack[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function scan() {
      try {
        const res = await fetch("/api/identify-mix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioFilename }),
        });
        if (cancelled) return;
        const data = await res.json();
        if (data.error) {
          setScanError(data.error);
        } else {
          setTracks(data.tracks ?? []);
        }
      } catch {
        if (!cancelled) setScanError("Scan fehlgeschlagen.");
      } finally {
        if (!cancelled) setScanning(false);
      }
    }

    scan();
    return () => {
      cancelled = true;
    };
  }, [audioFilename]);

  function updateTrack(index: number, field: "artist" | "title", value: string) {
    setTracks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function removeTrack(index: number) {
    setTracks((prev) => prev.filter((_, i) => i !== index));
  }

  if (scanning) {
    return (
      <section className="panel flex items-center gap-3" aria-label="Mix-Erkennung">
        <span className="spinner" aria-hidden="true" />
        <span role="status" className="flex-1 text-sm text-white/70">Mix wird analysiert …</span>
        <button type="button" onClick={onSkip} className="btn-quiet">
          Überspringen
        </button>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Mix-Erkennung">
      <h2 className="mb-4 text-sm font-semibold text-white">
        {tracks.length > 0
          ? `${tracks.length} Song${tracks.length !== 1 ? "s" : ""} erkannt`
          : "Keine Songs erkannt"}
      </h2>

      {scanError && (
        <p role="alert" className="mb-4 text-xs text-warn">{scanError}</p>
      )}

      {tracks.length > 0 && (
        <ol className="mb-4 flex flex-col gap-1.5">
          {tracks.map((track, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1"
            >
              <span className="w-10 shrink-0 text-xs tabular-nums text-white/40">
                {formatTime(track.startSec)}
              </span>
              <input
                value={track.artist}
                onChange={(e) => updateTrack(i, "artist", e.target.value)}
                placeholder="Artist"
                aria-label={`Artist ${i + 1}`}
                className="input min-w-0 flex-1 border-transparent bg-transparent"
              />
              <span className="text-xs text-white/30" aria-hidden="true">·</span>
              <input
                value={track.title}
                onChange={(e) => updateTrack(i, "title", e.target.value)}
                placeholder="Titel"
                aria-label={`Titel ${i + 1}`}
                className="input min-w-0 flex-1 border-transparent bg-transparent"
              />
              <button
                type="button"
                onClick={() => removeTrack(i)}
                aria-label={`Song ${i + 1} entfernen`}
                className="btn-quiet size-8 text-base hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tracks.length > 0 && (
          <button
            type="button"
            onClick={() => onConfirm(tracks.filter((t) => t.artist && t.title))}
            className="btn-solid"
          >
            Lyrics laden
          </button>
        )}
        <button type="button" onClick={onSkip} className="btn-quiet">
          Überspringen
        </button>
      </div>
    </section>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
