"use client";

import { useId, useState } from "react";

interface UploadFormProps {
  onAudioUploaded: (audioUrl: string, durationSec: number, originalFilename: string) => void;
  /** Name of the loaded song; switches to the compact "replace" layout. */
  current?: string | null;
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      if (!isFinite(audio.duration) || audio.duration <= 0) {
        reject(new Error("Audio-Dauer konnte nicht ermittelt werden."));
        return;
      }
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Audio-Dauer konnte nicht ermittelt werden."));
    });
  });
}

const ACCEPT = ".mp3,.mp4,.wav,.webm,.m4a,audio/*";

export function UploadForm({ onAudioUploaded, current }: UploadFormProps) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputId = useId();

  async function uploadFile(file: File) {
    setError(null);
    setUploading(file.name);
    try {
      const durationSec = await getAudioDuration(file);
      const formData = new FormData();
      formData.append("audio", file);
      const response = await fetch("/api/upload-audio", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok || data.error) {
        setError(data.error ?? "Fehler beim Hochladen.");
        return;
      }
      if (data.audioFilename) {
        onAudioUploaded(`/api/audio/${data.audioFilename}`, durationSec, file.name);
      }
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("Audio") ? e.message : "Hochladen fehlgeschlagen.");
    } finally {
      setUploading(null);
    }
  }

  async function quickImport() {
    try {
      const res = await fetch("/api/dev-audio?name=visite.mp3");
      if (!res.ok) throw new Error();
      await uploadFile(new File([await res.blob()], "visite.mp3", { type: "audio/mpeg" }));
    } catch {
      setError("Schnellimport fehlgeschlagen.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  const dragProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); },
    onDragLeave: () => setIsDragOver(false),
    onDrop: handleDrop,
  };

  const input = (
    <input
      id={inputId}
      type="file"
      accept={ACCEPT}
      onChange={handleFileChange}
      disabled={uploading !== null}
      className="sr-only"
    />
  );

  const devButton = process.env.NODE_ENV === "development" && (
    <button type="button" onClick={quickImport} disabled={uploading !== null} className="btn-quiet text-warn">
      visite.mp3
    </button>
  );

  const errorText = error && <p role="alert" className="text-sm text-danger">{error}</p>;

  if (current) {
    return (
      <div className="flex flex-col gap-2">
        <div
          {...dragProps}
          className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 transition ${
            isDragOver ? "border-white/40 bg-white/10" : "border-white/10 bg-white/[0.03]"
          }`}
        >
          <NoteIcon className="size-4 shrink-0 text-white/40" />
          <span className="min-w-0 flex-1 truncate text-sm text-white/85" aria-live="polite">
            {uploading ?? current}
          </span>
          {uploading && <span className="spinner" aria-hidden="true" />}
          {devButton}
          <label htmlFor={inputId} className="btn-quiet cursor-pointer has-[:disabled]:pointer-events-none has-[:disabled]:opacity-30">
            Ersetzen
            {input}
          </label>
        </div>
        {errorText}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        {...dragProps}
        className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed px-6 py-16 text-center transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent sm:py-24 ${
          isDragOver
            ? "border-white/50 bg-white/10"
            : "border-white/15 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]"
        }`}
      >
        {uploading ? <span className="spinner size-8" aria-hidden="true" /> : <NoteIcon className="size-10 text-white/40" />}
        <span className="text-base font-medium text-white" aria-live="polite">
          {uploading ? `${uploading} wird hochgeladen …` : "Song hierher ziehen oder auswählen"}
        </span>
        {!uploading && <span className="text-xs text-white/40">MP3, WAV, M4A, WebM</span>}
        {input}
      </label>
      {errorText}
      {devButton && <div className="self-center">{devButton}</div>}
    </div>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
      />
    </svg>
  );
}
