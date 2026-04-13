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
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          <span className="text-sm text-white/60">Mix wird analysiert...</span>
        </div>
        <button
          onClick={onSkip}
          className="mt-3 text-xs text-white/30 transition hover:text-white/50"
        >
          Überspringen
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6">
      <h3 className="mb-4 text-sm font-medium text-white">
        {tracks.length > 0
          ? `${tracks.length} Song${tracks.length !== 1 ? "s" : ""} erkannt`
          : "Keine Songs erkannt"}
      </h3>

      {scanError && (
        <p className="mb-4 text-xs text-amber-400/80">{scanError}</p>
      )}

      {tracks.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {tracks.map((track, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2"
            >
              <span className="w-12 shrink-0 text-xs text-white/40">
                {formatTime(track.startSec)}
              </span>
              <input
                value={track.artist}
                onChange={(e) => updateTrack(i, "artist", e.target.value)}
                placeholder="Artist"
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
              />
              <span className="text-xs text-white/30">—</span>
              <input
                value={track.title}
                onChange={(e) => updateTrack(i, "title", e.target.value)}
                placeholder="Titel"
                className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/30"
              />
              <button
                onClick={() => removeTrack(i)}
                className="shrink-0 text-base leading-none text-white/30 transition hover:text-white/60"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tracks.length > 0 && (
          <button
            onClick={() => onConfirm(tracks.filter((t) => t.artist && t.title))}
            className="rounded-lg bg-white/15 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/25"
          >
            Bestätigen & Lyrics laden
          </button>
        )}
        <button
          onClick={onSkip}
          className="px-3 py-2 text-xs text-white/30 transition hover:text-white/50"
        >
          Überspringen
        </button>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
