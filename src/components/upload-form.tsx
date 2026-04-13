"use client";

import { useState, useRef } from "react";

interface UploadFormProps {
  onAudioUploaded: (audioUrl: string, durationSec: number, originalFilename: string) => void;
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener("loadedmetadata", () => {
      const duration = audio.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error("Audio-Dauer konnte nicht ermittelt werden."));
        return;
      }
      resolve(duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Audio-Dauer konnte nicht ermittelt werden."));
    });
  });
}

export function UploadForm({ onAudioUploaded }: UploadFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setError(null);
    setIsLoading(true);
    setFileName(file.name);

    try {
      const durationSec = await getAudioDuration(file);

      const formData = new FormData();
      formData.append("audio", file);

      const response = await fetch("/api/upload-audio", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        setError(data.error ?? "Fehler beim Hochladen.");
        return;
      }

      if (data.audioFilename) {
        onAudioUploaded(`/api/audio/${data.audioFilename}`, durationSec, file.name);
      }
    } catch {
      setError("Ein unerwarteter Fehler ist aufgetreten.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("audio") as File | null;

    if (!file || file.size === 0) {
      setError("Bitte eine Audiodatei auswählen.");
      return;
    }

    await uploadFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      void uploadFile(file);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 transition cursor-pointer ${
          isDragOver
            ? "border-white/60 bg-white/15"
            : "border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10"
        }`}
      >
        <svg
          className="h-10 w-10 text-white/50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
        <p className="text-sm text-white/70">
          {fileName ?? "MP3, WAV, M4A oder WebM hierhin ziehen oder klicken"}
        </p>
        <input
          ref={inputRef}
          type="file"
          name="audio"
          accept=".mp3,.mp4,.wav,.webm,.m4a,audio/*"
          onChange={handleFileChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 text-center">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isLoading || !fileName}
          className="flex-1 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Wird hochgeladen..." : "Hochladen"}
        </button>

        {process.env.NODE_ENV === "development" && (
          <button
            type="button"
            disabled={isLoading}
            onClick={async () => {
              setError(null);
              setIsLoading(true);
              try {
                const audioRes = await fetch("/api/dev-audio?name=visite.mp3");
                if (!audioRes.ok) throw new Error("Dev-Audio nicht gefunden");
                const blob = await audioRes.blob();
                const file = new File([blob], "visite.mp3", { type: "audio/mpeg" });

                const durationSec = await getAudioDuration(file);

                const formData = new FormData();
                formData.append("audio", file);

                const res = await fetch("/api/upload-audio", { method: "POST", body: formData });
                const data = await res.json();
                if (!res.ok || data.error) {
                  setError(data.error ?? "Fehler beim Hochladen.");
                  return;
                }
                if (data.audioFilename) {
                  onAudioUploaded(`/api/audio/${data.audioFilename}`, durationSec, "visite.mp3");
                }
              } catch {
                setError("Schnellimport fehlgeschlagen.");
              } finally {
                setIsLoading(false);
              }
            }}
            className="rounded-xl border border-dashed border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm font-medium text-yellow-400 transition hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? "..." : "visite.mp3"}
          </button>
        )}
      </div>
    </form>
  );
}
