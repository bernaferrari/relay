import type { AppMap, AppMapCanvasState, CanvasNote, ScreenVariant } from "@relay/protocol";
import type { Accessor, Setter } from "solid-js";
import { useRecipeDraft } from "../context/recipe-draft";
import { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "./human-error";
import { ensureCanvasGraph, withCanvasGraph } from "./app-map-canvas-graph";
import type { createAppMapCanvasHistory } from "./app-map-canvas-history";
import {
  mergeAppMapProjection,
  planAppMapProjection,
  screenRestoreSnapshotFor,
  type AppMapScreenRestoreSnapshot,
} from "./app-map-projection";
import {
  appMapCommitSummary,
  canvasRemovalChanges,
  noteChangesFor,
  orderCanvasChanges,
} from "./app-map-workspace-helpers";

type CanvasHistory = ReturnType<
  typeof createAppMapCanvasHistory<AppMapCanvasState, AppMapScreenRestoreSnapshot>
>;

/**
 * Owns the optimistic-canvas to canonical-App-Map transaction boundary.
 * Keeping this queue outside the view makes it explicit that canvas gestures
 * are local projections while App Map commits remain the source of truth.
 */
export function useAppMapCanvasPersistence(options: {
  canvasState: Accessor<AppMapCanvasState>;
  setCanvasState: Setter<AppMapCanvasState>;
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>;
  activeAppMap: Accessor<AppMap | undefined>;
  history: CanvasHistory;
}) {
  const server = useServer();
  const draft = useRecipeDraft();
  let mutationQueue = Promise.resolve();

  function persistCanvas(
    value: AppMapCanvasState,
    previous?: AppMapCanvasState,
    variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>,
    restore?: AppMapScreenRestoreSnapshot,
  ): void {
    const appMapId = server.selectedAppMapId();
    if (!appMapId) return;
    mutationQueue = mutationQueue
      .then(async () => {
        let appMap = await server.loadAppMap(appMapId);
        const projectedGraph = ensureCanvasGraph(value, draft.steps());
        const projectedChanges = planAppMapProjection({
          appMap,
          graph: projectedGraph,
          positions: value.positions,
          groups: value.groups ?? [],
          recipeSteps: draft.steps(),
          ...(variantsByScreen ? { variantsByScreen } : {}),
          ...(restore ? { restore } : {}),
        });
        const removals = previous ? canvasRemovalChanges(previous, value, appMap) : [];
        const noteChanges = noteChangesFor(value.notes ?? [], appMap, previous?.notes ?? []);
        const changes = orderCanvasChanges([...projectedChanges, ...removals, ...noteChanges]);
        if (!changes.length) return;
        appMap = (
          await server.runAction("app-map.commit", {
            appMapId,
            expectedRevision: appMap.revision,
            summary: appMapCommitSummary({ appMap, changes }),
            changes,
          })
        ).appMap;
        await server.refreshAppMaps();
      })
      .catch(async (error) => {
        // Only reconcile the optimistic value that failed. A newer queued
        // gesture must not be overwritten by an older request's recovery.
        if (options.canvasState() === value) {
          try {
            const current = await server.loadAppMap(appMapId);
            options.setCanvasState(mergeAppMapProjection(options.canvasState(), current));
          } catch {
            // Preserve local work when even the recovery read is offline.
          }
        }
        toast(humanError(error, "The map could not be saved"), "warning");
      });
  }

  const persistMetadata = (
    value: AppMapCanvasState,
    settings: {
      before?: AppMapCanvasState;
      recordHistory?: boolean;
      variantsByScreen?: Readonly<Record<string, readonly ScreenVariant[]>>;
      restore?: AppMapScreenRestoreSnapshot;
    } = {},
  ) => {
    if (!server.selectedAppMapId()) return;
    const before = structuredClone(settings.before ?? options.canvasState());
    const canvasChanged = JSON.stringify(before) !== JSON.stringify(value);
    const hasVariantEvidence = Object.values(settings.variantsByScreen ?? {}).some(
      (variants) => variants.length > 0,
    );
    if (!canvasChanged && !hasVariantEvidence) return;
    const restore =
      settings.restore ??
      (() => {
        const appMap = options.activeAppMap();
        if (!appMap) return undefined;
        const removedScreenIds = canvasRemovalChanges(before, value, appMap).flatMap((change) =>
          change.kind === "screen.remove" ? [change.screenId] : [],
        );
        return screenRestoreSnapshotFor(appMap, removedScreenIds);
      })();
    if (canvasChanged && settings.recordHistory !== false) {
      options.history.record({
        before,
        after: structuredClone(value),
        at: Date.now(),
        ...(restore ? { restore } : {}),
      });
    }
    if (canvasChanged) options.setCanvasState(value);
    persistCanvas(value, before, settings.variantsByScreen, settings.restore);
  };

  const persistNotes = (notes: CanvasNote[], before?: AppMapCanvasState) => {
    persistMetadata(withCanvasGraph({ ...options.canvasState(), notes }, options.graph()), {
      before,
    });
  };

  const undo = () => {
    const entry = options.history.undo();
    if (!entry) {
      draft.undo();
      return;
    }
    persistMetadata(structuredClone(entry.before), {
      before: options.canvasState(),
      recordHistory: false,
      ...(entry.restore ? { restore: entry.restore } : {}),
    });
  };
  const redo = () => {
    const entry = options.history.redo();
    if (!entry) {
      draft.redo();
      return;
    }
    persistMetadata(structuredClone(entry.after), {
      before: options.canvasState(),
      recordHistory: false,
    });
  };

  return { persistMetadata, persistNotes, undo, redo };
}
