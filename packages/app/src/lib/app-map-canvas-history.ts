import { createSignal } from "solid-js";

export type CanvasHistoryEntry<T> = {
  before: T;
  after: T;
  at: number;
};

/** Owns the undo/redo invariant for renderer-only App Map canvas state. */
export function createAppMapCanvasHistory<T>(limit = 100) {
  let undoStack: CanvasHistoryEntry<T>[] = [];
  let redoStack: CanvasHistoryEntry<T>[] = [];
  const [depth, setDepth] = createSignal({ undo: 0, redo: 0 });

  const syncDepth = () => setDepth({ undo: undoStack.length, redo: redoStack.length });
  const clear = () => {
    undoStack = [];
    redoStack = [];
    syncDepth();
  };
  const record = (entry: CanvasHistoryEntry<T>) => {
    undoStack = [...undoStack, entry].slice(-limit);
    redoStack = [];
    syncDepth();
  };
  const undo = () => {
    const entry = undoStack.pop();
    if (!entry) return undefined;
    redoStack.push(entry);
    syncDepth();
    return entry;
  };
  const redo = () => {
    const entry = redoStack.pop();
    if (!entry) return undefined;
    undoStack.push(entry);
    syncDepth();
    return entry;
  };

  return { depth, clear, record, undo, redo };
}
