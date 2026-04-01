"use client";

import { useState, useCallback } from "react";

interface UseHistoryReturn<T> {
  value: T;
  set: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const MAX_HISTORY = 50;

export function useHistory<T>(initial: T): UseHistoryReturn<T> {
  const [value, setValue] = useState(initial);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const set = useCallback((next: T) => {
    setValue((prev) => {
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), prev]);
      setFuture([]);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      const remaining = p.slice(0, -1);
      setValue((current) => {
        setFuture((f) => [...f, current]);
        return previous;
      });
      return remaining;
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      const remaining = f.slice(0, -1);
      setValue((current) => {
        setPast((p) => [...p, current]);
        return next;
      });
      return remaining;
    });
  }, []);

  return {
    value,
    set,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
