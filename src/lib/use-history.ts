"use client";

import { useCallback, useState } from "react";

const MAX_HISTORY = 50;

interface HistoryState<T> {
  past: T[];
  value: T;
  future: T[];
}

// One state object keeps updaters pure (StrictMode-safe) and the callbacks stable.
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({ past: [], value: initial, future: [] });

  const set = useCallback((next: T) => {
    setState((s) => ({ past: [...s.past.slice(-(MAX_HISTORY - 1)), s.value], value: next, future: [] }));
  }, []);

  /** Replace the value and drop history (e.g. restoring a saved session or loading a new song). */
  const reset = useCallback((next: T) => {
    setState({ past: [], value: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setState((s) => s.past.length === 0 ? s : {
      past: s.past.slice(0, -1),
      value: s.past[s.past.length - 1],
      future: [...s.future, s.value],
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => s.future.length === 0 ? s : {
      past: [...s.past, s.value],
      value: s.future[s.future.length - 1],
      future: s.future.slice(0, -1),
    });
  }, []);

  return {
    value: state.value,
    set,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
