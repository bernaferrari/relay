import type { AppMapCanvasState, CanvasFlow } from "@relay/protocol";
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import { toast } from "../context/toast";
import type { MapCanvasView } from "../components/map-mode-switch";
import { compactCanvasPositions } from "./app-map-auto-layout";
import { withCanvasGraph } from "./app-map-canvas-graph";
import type { CanvasScreenRotation } from "./app-map-canvas-layout";
import { connectAppMapShellCommands } from "./app-map-workspace-command-adapter";
import { applyTargetSetToActiveFlow } from "./app-map-workspace-helpers";
import type { WorkspaceController } from "./workspace-controller";

/** Shell commands that mutate canvas metadata or reveal a canonical screen. */
export function useAppMapWorkspaceShell(options: {
  workspaceController?: WorkspaceController;
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
    const targetSetId = options.activeFlow()?.targetSetId;
    options.workspaceController?.execute({
      kind: "map.target-set.state",
      ...(targetSetId !== undefined ? { targetSetId } : {}),
    });
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
    const disconnectWorkspace = connectAppMapShellCommands(options.workspaceController, {
      chooseTargetSet,
      tidyMap,
      toggleHistory: () => {
        const opening = !options.historyOpen();
        if (opening) options.setCaptureOpen(false);
        options.setHistoryOpen(opening);
      },
      revealScreen: ({ appMapId, screenId }) => {
        if (appMapId !== options.selectedAppMapId()) return;
        options.setWorkspaceView("map");
        options.setSelectedNodeId(screenId);
        queueMicrotask(() => options.revealScreen(screenId));
      },
    });
    onCleanup(disconnectWorkspace);
  });
}
