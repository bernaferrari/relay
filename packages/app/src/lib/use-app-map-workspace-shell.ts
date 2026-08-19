import type { AppMapCanvasState, CanvasFlow } from "@relay/protocol";
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import { toast } from "../context/toast";
import type { MapCanvasView } from "../components/map-mode-switch";
import { compactCanvasPositions } from "./app-map-auto-layout";
import { withCanvasGraph } from "./app-map-canvas-graph";
import type { CanvasScreenRotation } from "./app-map-canvas-layout";
import { bindAppMapWorkspaceShellEvents } from "./app-map-workspace-shell-events";
import { applyTargetSetToActiveFlow } from "./app-map-workspace-helpers";

/** Shell commands that mutate canvas metadata or reveal a canonical screen. */
export function useAppMapWorkspaceShell(options: {
  activeFlow: Accessor<CanvasFlow | null>;
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>;
  canvasState: Accessor<AppMapCanvasState>;
  rotations: Accessor<Record<string, CanvasScreenRotation>>;
  persistMetadata: (value: AppMapCanvasState) => void;
  fit: () => void;
  historyOpen: Accessor<boolean>;
  setHistoryOpen: (open: boolean) => void;
  setCaptureOpen: (open: boolean) => void;
  selectedAppMapId: Accessor<string | null>;
  setWorkspaceView: (view: MapCanvasView) => void;
  setSelectedNodeId: (id: string | null) => void;
  revealScreen: (screenId: string) => void;
}) {
  const chooseTargetSet = (targetSetId?: string) => {
    const flow = options.activeFlow();
    if (!flow) return;
    const next = applyTargetSetToActiveFlow(options.graph(), flow.id, targetSetId);
    options.persistMetadata(withCanvasGraph(options.canvasState(), next));
  };
  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:target-set-state", {
        detail: { targetSetId: options.activeFlow()?.targetSetId },
      }),
    );
  });
  const tidyMap = () => {
    const rotations = options.rotations();
    const arranged = compactCanvasPositions(options.graph(), {
      sourceRotationFor: (screenId) => rotations[screenId] ?? "none",
    });
    if (!Object.keys(arranged).length) return;
    options.persistMetadata({ ...options.canvasState(), positions: arranged });
    requestAnimationFrame(options.fit);
    toast("Map tidied", "success");
  };

  onMount(() => {
    const unbind = bindAppMapWorkspaceShellEvents({
      onChooseTargetSet: chooseTargetSet,
      onTidyMap: tidyMap,
      onToggleHistory: () => {
        const opening = !options.historyOpen();
        if (opening) options.setCaptureOpen(false);
        options.setHistoryOpen(opening);
      },
      onRevealScreen: (detail) => {
        if (!detail.screenId || !detail.appMapId || detail.appMapId !== options.selectedAppMapId())
          return;
        options.setWorkspaceView("map");
        options.setSelectedNodeId(detail.screenId);
        queueMicrotask(() => options.revealScreen(detail.screenId!));
      },
    });
    onCleanup(unbind);
  });
}
