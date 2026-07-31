import * as Y from "yjs";
import type { JourneyMetadata } from "@relay/protocol";

const ROOT = "relay-journey";
const METADATA = "metadata";

/**
 * A small collaboration seam around the canvas-only part of a journey.
 *
 * Unlike the earlier JSON-blob adapter, this writes real nested Y.Map/Y.Array
 * values. Today the server remains the revisioned persistence authority, but a
 * Yjs provider can now sync individual graph screens, transitions, positions,
 * and notes without changing every canvas component or the executable recipe.
 */
export type JourneyDocument = {
  doc: Y.Doc;
  undo: Y.UndoManager;
  read: () => JourneyMetadata;
  replace: (value: JourneyMetadata, origin?: unknown) => JourneyMetadata;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoOnce: () => JourneyMetadata;
  redoOnce: () => JourneyMetadata;
  destroy: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toYValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const next = new Y.Array<unknown>();
    next.push(value.map((entry) => toYValue(entry)));
    return next;
  }
  if (isRecord(value)) {
    const next = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(value)) next.set(key, toYValue(entry));
    return next;
  }
  return structuredClone(value);
}

function fromYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [key, fromYValue(entry)]));
  }
  if (value instanceof Y.Array) return value.toArray().map(fromYValue);
  return structuredClone(value);
}

/** Reconcile objects in-place so existing Yjs child types retain identity. */
function syncMap(target: Y.Map<unknown>, value: Record<string, unknown>): void {
  for (const key of [...target.keys()]) if (!(key in value)) target.delete(key);
  for (const [key, next] of Object.entries(value)) {
    const current = target.get(key);
    if (isRecord(next) && current instanceof Y.Map) {
      syncMap(current, next);
      continue;
    }
    // Arrays deliberately replace as a unit for now. The public API is still
    // snapshot based; a future collaborative canvas will mutate one Y.Array
    // item at a time through this same document boundary.
    if (JSON.stringify(fromYValue(current)) === JSON.stringify(next)) continue;
    target.set(key, toYValue(next));
  }
}

export function createJourneyDocument(initial: JourneyMetadata): JourneyDocument {
  const doc = new Y.Doc({ gc: true });
  const root = doc.getMap<unknown>(ROOT);
  const localOrigin = Symbol("journey-local-edit");
  const undo = new Y.UndoManager(root, {
    trackedOrigins: new Set([localOrigin]),
    captureTimeout: 500,
  });

  const metadataMap = (): Y.Map<unknown> => {
    const current = root.get(METADATA);
    if (current instanceof Y.Map) return current;
    const next = new Y.Map<unknown>();
    root.set(METADATA, next);
    return next;
  };
  const read = (): JourneyMetadata =>
    structuredClone(fromYValue(metadataMap())) as JourneyMetadata;

  const replace = (value: JourneyMetadata, origin?: unknown): JourneyMetadata => {
    doc.transact(
      () => syncMap(metadataMap(), structuredClone(value) as Record<string, unknown>),
      (origin === undefined ? localOrigin : origin) as symbol,
    );
    return read();
  };

  // Seeding is intentionally not undoable; history starts with a person's edit.
  replace(initial, "seed");
  undo.clear();

  return {
    doc,
    undo,
    read,
    replace,
    canUndo: () => undo.undoStack.length > 0,
    canRedo: () => undo.redoStack.length > 0,
    undoOnce: () => {
      undo.undo();
      return read();
    },
    redoOnce: () => {
      undo.redo();
      return read();
    },
    destroy: () => doc.destroy(),
  };
}
