import type { AppMapCanvasState } from "@relay/protocol";
import type { Accessor } from "solid-js";
import type { MapTreeNode } from "./app-map-tree";
import { removeAuthoredConnection, type CanvasConnection } from "./app-map-connection-draft";
import { removeCanvasScreen, withCanvasGraph } from "./app-map-canvas-graph";
import { applyScreenRemovalToCanvas, applyScreenRenameToCanvas } from "./app-map-workspace-helpers";

/** Screen/connection mutations that only need canvas state + persist. */
export function useAppMapGraphEdits(options: {
  canvasState: Accessor<AppMapCanvasState>;
  graph: Accessor<NonNullable<AppMapCanvasState["graph"]>>;
  titleFor: (node: MapTreeNode) => string;
  persistMetadata: (
    value: AppMapCanvasState,
    options?: {
      before?: AppMapCanvasState;
      recordHistory?: boolean;
    },
  ) => void;
  setSelectedConnectionId: (id: string | null) => void;
  setSelectedNodeId: (id: string | null) => void;
  setScreenInspectorOpen: (open: boolean) => void;
  setRenamingNodeId: (id: string | null) => void;
}) {
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
    removeConnection,
    removeScreen,
    renameScreen,
  };
}
