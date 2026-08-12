import { createSignal } from "solid-js";

export type CanvasHistoryEntry<T, Restore = undefined> = {
  before: T;
  after: T;
  at: number;
  /**
   * Optional canonical pre-image required to faithfully recreate an entity
   * that a canvas edit removed. Canvas state intentionally excludes media and
   * other executable records, so this belongs to the history transaction
   * rather than the canvas document itself.
   */
  restore?: Restore;
};

/** Owns the undo/redo invariant for renderer-only App Map canvas state. */
export function createAppMapCanvasHistory<T, Restore = undefined>(limit = 100) {
  let undoStack: CanvasHistoryEntry<T, Restore>[] = [];
  let redoStack: CanvasHistoryEntry<T, Restore>[] = [];
  const [depth, setDepth] = createSignal({ undo: 0, redo: 0 });

  const syncDepth = () => setDepth({ undo: undoStack.length, redo: redoStack.length });
  const clear = () => {
    undoStack = [];
    redoStack = [];
    syncDepth();
  };
  const record = (entry: CanvasHistoryEntry<T, Restore>) => {
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
