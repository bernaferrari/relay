import type { AppMapCanvasState, RecipeStep } from "@relay/protocol";
import type { Accessor } from "solid-js";
import type { MapTreeNode } from "./app-map-tree";
import {
  addPlannedConnection,
  addPlannedScreenConnection,
  removeAuthoredConnection,
  type CanvasConnection,
} from "./app-map-connection-draft";
import { removeCanvasScreen, withCanvasGraph } from "./app-map-canvas-graph";
import { nextBranchPosition, type CanvasPoint } from "./app-map-canvas-layout";
import { applyScreenRemovalToCanvas, applyScreenRenameToCanvas } from "./app-map-workspace-helpers";

/** Screen/connection mutations that only need canvas state + persist. */
export function useAppMapGraphEdits(options: {
  canvasState: Accessor<AppMapCanvasState>;
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>;
  treeNodes: Accessor<MapTreeNode[]>;
  draftSteps: Accessor<RecipeStep[]>;
  positionFor: (node: MapTreeNode) => CanvasPoint;
  titleFor: (node: MapTreeNode) => string;
  persistMetadata: (
    value: AppMapCanvasState,
    options?: {
      before?: AppMapCanvasState;
      recordHistory?: boolean;
    },
  ) => void;
  setKeyboardConnectionSourceId: (id: string | null) => void;
  setSelectedConnectionId: (id: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  setScreenInspectorOpen: (open: boolean) => void;
  setRenamingNodeId: (id: string | null) => void;
}) {
  const chooseKeyboardConnection = (fromScreenId: string, toScreenId: string) => {
    const next = addPlannedConnection(
      options.canvasState(),
      { fromScreenId, toScreenId },
      Date.now(),
      options.draftSteps(),
    );
    const connection = next.graph?.transitions.at(-1);
    options.persistMetadata(next);
    options.setKeyboardConnectionSourceId(null);
    options.setSelectedConnectionId(connection?.id ?? null);
    options.setSelectedNodeId(null);
  };

  const createKeyboardDestination = (fromScreenId: string) => {
    const source = options.treeNodes().find((node) => node.id === fromScreenId);
    if (!source) return;
    const position = nextBranchPosition(
      options.positionFor(source),
      options.treeNodes().map((node) => options.positionFor(node)),
    );
    const next = addPlannedScreenConnection(
      options.canvasState(),
      {
        fromScreenId,
        position,
      },
      Date.now(),
      options.draftSteps(),
    );
    const connection = next.graph?.transitions.at(-1);
    options.persistMetadata(next);
    options.setKeyboardConnectionSourceId(null);
    options.setSelectedConnectionId(connection?.id ?? null);
    options.setSelectedNodeId(null);
  };

  const removeConnection = (connection: CanvasConnection) => {
    if (connection.source !== "authored") return;
    const next = removeAuthoredConnection(options.canvasState(), connection.id);
    options.persistMetadata(next);
    options.setSelectedConnectionId(null);
  };

  const removeScreen = (node: MapTreeNode) => {
    const next = withCanvasGraph(
      applyScreenRemovalToCanvas(options.canvasState(), node.id),
      removeCanvasScreen(options.graph(), node.id),
    );
    options.persistMetadata(next);
    options.setSelectedNodeId(null);
    options.setScreenInspectorOpen(false);
  };

  const renameScreen = (node: MapTreeNode, title: string) => {
    const next = title.trim();
    if (!next || next === options.titleFor(node)) {
      options.setRenamingNodeId(null);
      return;
    }
    const renamed = applyScreenRenameToCanvas(
      options.canvasState(),
      options.graph(),
      node.id,
      next,
    );
    options.persistMetadata(withCanvasGraph(renamed, renamed.graph!));
    options.setRenamingNodeId(null);
  };

  return {
    chooseKeyboardConnection,
    createKeyboardDestination,
    removeConnection,
    removeScreen,
    renameScreen,
  };
}
