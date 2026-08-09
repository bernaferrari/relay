import { createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import type { AppMapCanvasState } from "@relay/protocol";
import { useServer } from "../context/server";
import { mergeAppMapProjection } from "./app-map-projection";
import { EMPTY_APP_MAP_CANVAS_STATE } from "./app-map-canvas-state";
import { appMapLoadFailure, canvasProjectionUnchanged } from "./app-map-workspace-helpers";

export type AppMapLoadState =
  | { status: "idle" }
  | { status: "loading"; appMapId: string }
  | { status: "ready"; appMapId: string }
  | {
      status: "error";
      appMapId: string;
      title: string;
      guidance: string;
      detail?: string;
    };

/** Keeps the renderer projection synchronized with the canonical App Map document. */
export function useAppMapDocumentProjection(options: {
  canvasState: Accessor<AppMapCanvasState>;
  setCanvasState: Setter<AppMapCanvasState>;
  onDocumentReset: () => void;
  onCanonicalProjectionChange: () => void;
}) {
  const server = useServer();
  const [loadedAppMapId, setLoadedAppMapId] = createSignal<string | null>(null);
  const [loadState, setLoadState] = createSignal<AppMapLoadState>({ status: "idle" });
  const [loadAttempt, setLoadAttempt] = createSignal(0);
  let appliedCanonicalRevision = "";

  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    loadAttempt();
    options.onDocumentReset();
    appliedCanonicalRevision = "";
    if (!appMapId) {
      setLoadedAppMapId(null);
      setLoadState({ status: "idle" });
      options.setCanvasState(EMPTY_APP_MAP_CANVAS_STATE);
      return;
    }

    setLoadedAppMapId(null);
    setLoadState({ status: "loading", appMapId });
    void server
      .loadAppMap(appMapId)
      .then((appMap) => {
        if (server.selectedAppMapId() !== appMapId) return;
        options.setCanvasState(mergeAppMapProjection(EMPTY_APP_MAP_CANVAS_STATE, appMap));
        setLoadedAppMapId(appMapId);
        setLoadState({ status: "ready", appMapId });
        void server.refreshRuns(appMapId);
      })
      .catch((error: unknown) => {
        if (server.selectedAppMapId() === appMapId) {
          setLoadState({ status: "error", appMapId, ...appMapLoadFailure(error) });
        }
      });
  });

  createEffect(() => {
    const appMapId = server.selectedAppMapId();
    const appMap = server.appMaps().find((candidate) => candidate.id === appMapId);
    if (!appMapId || !appMap || loadedAppMapId() !== appMapId) return;
    const revisionKey = `${appMapId}:${appMap.revision}`;
    if (appliedCanonicalRevision === revisionKey) return;
    appliedCanonicalRevision = revisionKey;
    const current = options.canvasState();
    const value = mergeAppMapProjection(current, appMap);
    if (canvasProjectionUnchanged(value, current)) return;
    options.onCanonicalProjectionChange();
    options.setCanvasState(value);
  });

  const loadFailure = () => {
    const state = loadState();
    return state.status === "error" ? state : undefined;
  };
  const retry = () => setLoadAttempt((attempt) => attempt + 1);

  return { loadedAppMapId, loadState, loadFailure, retry };
}
