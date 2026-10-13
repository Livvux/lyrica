import type { LyricLine, StyleConfig } from "../types/lyrics";

const STORAGE_KEY = "lyrica-session-v1";
function privateStorageKey(binding?:string):string {
  const project=binding??sessionStorage.getItem("lyrica-private-project");
  return project ? `${STORAGE_KEY}:${project}` : `${STORAGE_KEY}:unbound`;
}

export interface PersistedState {
  lines: LyricLine[];
  audioUrl: string | null;
  durationSec: number;
  style: StyleConfig;
  lyricsActive: boolean;
}

export function savePersistence(state: PersistedState,binding?:string): void {
  try {
    localStorage.setItem(privateStorageKey(binding), JSON.stringify(state));
  } catch {
    // localStorage voll oder nicht verfügbar — ignorieren
  }
}

export function loadPersistence(binding?:string): PersistedState | null {
  try {
    const raw = localStorage.getItem(privateStorageKey(binding));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export function clearPersistence(binding?:string): void {
  try {
    localStorage.removeItem(privateStorageKey(binding));
  } catch {
    // ignorieren
  }
}
