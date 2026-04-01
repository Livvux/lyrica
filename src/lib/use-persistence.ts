import type { LyricLine, StyleConfig } from "@/types/lyrics";

const STORAGE_KEY = "lyrica-session-v1";

export interface PersistedState {
  lines: LyricLine[];
  audioUrl: string | null;
  durationSec: number;
  style: StyleConfig;
  lyricsActive: boolean;
}

export function savePersistence(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage voll oder nicht verfügbar — ignorieren
  }
}

export function loadPersistence(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearPersistence(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignorieren
  }
}
