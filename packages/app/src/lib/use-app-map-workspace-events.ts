import { type Accessor, type Setter } from "solid-js";
import { useRecorder } from "../context/recorder";
import { toast } from "../context/toast";
import { createAppMapEventOrchestration } from "../components/app-map-events";
import type { AppMapCanvasTool } from "../components/app-map-toolbar";
import type { AppMapRunReadiness } from "./app-map-run-readiness";
import type { CanvasConnection } from "./app-map-connection-draft";
import type { MapTreeNode } from "./app-map-tree";
import type { WorkspaceController } from "./workspace-controller";

/** Global shell and keyboard events translated into workspace-level intents. */
export function useAppMapWorkspaceEvents(options: {
  workspaceController?: WorkspaceController;
  captureOpen: Accessor<boolean>;
  runReadiness: Accessor<AppMapRunReadiness>;
  canvasTool: Accessor<AppMapCanvasTool>;
  setCanvasTool: Setter<AppMapCanvasTool>;
  renamingScreen: Accessor<boolean>;
  hasContent: Accessor<boolean>;
  selectedConnection: Accessor<CanvasConnection | null>;
  selectedNode: Accessor<MapTreeNode | null>;
  hereScreenId: Accessor<string | null>;
  contextSurfaceOpen: Accessor<boolean>;
  historyCanUndo: Accessor<boolean>;
  historyCanRedo: Accessor<boolean>;
  onDeviceSelected: () => void;
  onToggleDevice: () => void;
  onOpenDevice: () => void;
  onCloseDevice: () => void;
  onRun: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCaptureScreen: () => void;
  onUseCurrentScreenAsStart: () => void;
  onAddNote: () => void;
  onRecordFromHere: () => void;
  onRecordConnection: (connection: CanvasConnection) => void;
  onRemoveConnection: (connection: CanvasConnection) => void;
  onRemoveScreen: (node: MapTreeNode) => void;
  onCancelMarquee: () => boolean;
  onZoomStep: (delta: number) => void;
  onClearContextSurface: () => void;
  onClearSelection: () => void;
}) {
  const recorder = useRecorder();

  createAppMapEventOrchestration({
    workspaceController: options.workspaceController,
    devicePanelOpen: options.captureOpen,
    runReadiness: options.runReadiness,
    canvasTool: options.canvasTool,
    renamingScreen: options.renamingScreen,
    onDeviceSelected: options.onDeviceSelected,
    onToggleDevicePanel: options.onToggleDevice,
    onOpenDevicePanel: options.onOpenDevice,
    onCloseDevicePanel: options.onCloseDevice,
    onRunMap: options.onRun,
    onUndoRequest: (event, shouldRedo) => {
      const canUndo = options.historyCanUndo();
      const canRedo = options.historyCanRedo();
      if (shouldRedo ? !canRedo : !canUndo) return;
      event.preventDefault();
      if (shouldRedo) options.onRedo();
      else options.onUndo();
    },
    onToolChange: options.setCanvasTool,
    onCaptureScreen: options.onCaptureScreen,
    onAddNote: options.onAddNote,
    onRecord: () => {
      if (recorder.recording()) {
        void recorder.stopRecording();
        return;
      }
      if (!options.hasContent()) {
        options.onUseCurrentScreenAsStart();
        return;
      }
      const connection = options.selectedConnection();
      if (connection) options.onRecordConnection(connection);
      else if (options.hereScreenId() || options.selectedNode()) options.onRecordFromHere();
      else toast("Select a screen or path to record", "info");
    },
    onDeleteSelection: () => {
      const connection = options.selectedConnection();
      if (connection) {
        options.onRemoveConnection(connection);
        return;
      }
      const node = options.selectedNode();
      if (node) options.onRemoveScreen(node);
    },
    onZoomStep: options.onZoomStep,
    onEscape: () => {
      if (options.onCancelMarquee()) return;
      if (options.contextSurfaceOpen()) {
        options.onClearContextSurface();
        return;
      }
      options.onClearSelection();
    },
  });
}
