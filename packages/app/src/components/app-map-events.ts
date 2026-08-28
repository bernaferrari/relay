import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import type { AppMapRunReadiness } from "../lib/app-map-run-readiness";
import type { WorkspaceController } from "../lib/workspace-controller";
import { connectAppMapWorkspaceCommands } from "../lib/app-map-workspace-command-adapter";
import type { AppMapCanvasTool } from "./app-map-toolbar";

export type CanvasWheelAction =
  | { kind: "pan"; x: number; y: number }
  | { kind: "zoom"; delta: number }
  | null;

/** The same 0.1 step the minimap stepper uses, shared with the `=`/`+`/`-`
 * canvas keys so every zoom path moves the camera in lockstep. */
export const CANVAS_ZOOM_KEY_STEP = 0.1;

export function canvasOwnsWheel(input: {
  workspaceView: string;
  hasCanvasContent: boolean;
  insideOverlay: boolean;
}): boolean {
  return input.workspaceView === "map" && input.hasCanvasContent && !input.insideOverlay;
}

const CANVAS_SHORTCUT_EXCLUSION =
  "input, textarea, select, button, a, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox'], [data-canvas-shortcuts='ignore']";

export function shouldIgnoreCanvasShortcut(
  event: Pick<KeyboardEvent, "defaultPrevented" | "target">,
): boolean {
  if (event.defaultPrevented) return true;
  const target = event.target as {
    closest?: (selector: string) => Element | null;
  } | null;
  return Boolean(target?.closest?.(CANVAS_SHORTCUT_EXCLUSION));
}

/** Map an unmodified canvas key to a bounded zoom step, mirroring the
 * Cmd/Ctrl-wheel gesture so every zoom path moves the camera in lockstep:
 * `=`/`+` zooms in, `-` zooms out (same 0.1 step as the minimap stepper). */
export function canvasZoomKeyAction(key: string): CanvasWheelAction {
  if (key === "=" || key === "+") return { kind: "zoom", delta: CANVAS_ZOOM_KEY_STEP };
  if (key === "-") return { kind: "zoom", delta: -CANVAS_ZOOM_KEY_STEP };
  return null;
}

export function isCaptureScreenShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">,
): boolean {
  return (
    (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === "s"
  );
}

/** Normalize mouse wheels and trackpads into the two canvas gestures people
 * already expect: unmodified two-axis pan, and anchored Cmd/Ctrl-wheel zoom. */
export function canvasWheelAction(input: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  viewportHeight: number;
}): CanvasWheelAction {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? input.viewportHeight : 1;
  let deltaX = input.deltaX * unit;
  let deltaY = input.deltaY * unit;

  if (input.ctrlKey || input.metaKey) {
    if (deltaY === 0) return null;
    return {
      kind: "zoom",
      delta: Math.max(-0.16, Math.min(0.16, -deltaY * 0.0015)),
    };
  }

  if (input.shiftKey && Math.abs(deltaX) < 0.01) {
    deltaX = deltaY;
    deltaY = 0;
  }
  if (deltaX === 0 && deltaY === 0) return null;
  return {
    kind: "pan",
    x: deltaX === 0 ? 0 : -deltaX,
    y: deltaY === 0 ? 0 : -deltaY,
  };
}

export function createAppMapEventOrchestration(options: {
  workspaceController?: WorkspaceController;
  devicePanelOpen: Accessor<boolean>;
  runReadiness: Accessor<AppMapRunReadiness>;
  canvasTool: Accessor<AppMapCanvasTool>;
  renamingScreen: Accessor<boolean>;
  onDeviceSelected: () => void;
  onToggleDevicePanel: () => void;
  onOpenDevicePanel: () => void;
  onCloseDevicePanel: () => void;
  onRunMap: () => void;
  onUndoRequest: (redo: boolean) => void;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onCaptureScreen: () => void;
  onAddNote: () => void;
  onRecord: () => void;
  onDeleteSelection: () => void;
  onZoomStep: (delta: number) => void;
  onEscape: () => void;
}) {
  createEffect(() => {
    options.workspaceController?.execute({ kind: "device.state", open: options.devicePanelOpen() });
  });

  createEffect(() => {
    options.workspaceController?.execute({
      kind: "test.run-readiness",
      readiness: options.runReadiness(),
    });
  });

  onMount(() => {
    let toolBeforeSpace: AppMapCanvasTool | null = null;
    const onToggleDevicePanel = () => options.onToggleDevicePanel();
    const onOpenDevicePanel = () => options.onOpenDevicePanel();
    const onCloseDevicePanel = () => options.onCloseDevicePanel();
    const onRunMap = () => options.onRunMap();
    const onRecordPath = () => options.onRecord();
    const onCaptureScreen = () => options.onCaptureScreen();
    const onCanvasKey = (event: KeyboardEvent) => {
      if (shouldIgnoreCanvasShortcut(event)) return;
      if (isCaptureScreenShortcut(event)) {
        event.preventDefault();
        options.onCaptureScreen();
        return;
      }
      if (event.key === "=" || event.key === "+" || event.key === "-") {
        const zoomAction = canvasZoomKeyAction(event.key);
        if (zoomAction?.kind === "zoom") {
          event.preventDefault();
          options.onZoomStep(zoomAction.delta);
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) {
          toolBeforeSpace = options.canvasTool();
          options.onToolChange("hand");
        }
        return;
      }
      if (event.key === "v" || event.key === "V") {
        options.onToolChange("select");
        return;
      }
      if (event.key === "h" || event.key === "H") {
        options.onToolChange("hand");
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        options.onAddNote();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        options.onRecord();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        options.onDeleteSelection();
        return;
      }
      if (event.key !== "Escape" || options.renamingScreen()) return;
      options.onEscape();
    };
    const onCanvasKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || toolBeforeSpace === null) return;
      options.onToolChange(toolBeforeSpace);
      toolBeforeSpace = null;
    };

    const disconnectWorkspace = connectAppMapWorkspaceCommands(options.workspaceController, {
      targetSelected: options.onDeviceSelected,
      toggleDevice: options.onToggleDevicePanel,
      showDevice: options.onOpenDevicePanel,
      hideDevice: options.onCloseDevicePanel,
      runTest: options.onRunMap,
      recordTest: options.onRecord,
      captureScreen: options.onCaptureScreen,
      undoMap: () => options.onUndoRequest(false),
      redoMap: () => options.onUndoRequest(true),
    });

    // Compatibility listeners remain for Map-only surfaces that have not yet
    // joined the typed workspace seam. Golden Test and shell paths use the
    // WorkspaceController above.
    window.addEventListener("relay:toggle-device-panel", onToggleDevicePanel);
    window.addEventListener("relay:open-device-panel", onOpenDevicePanel);
    window.addEventListener("relay:close-device-panel", onCloseDevicePanel);
    window.addEventListener("relay:run-app-map", onRunMap);
    window.addEventListener("relay:record-path", onRecordPath);
    window.addEventListener("relay:capture-screen", onCaptureScreen);
    window.addEventListener("keydown", onCanvasKey);
    window.addEventListener("keyup", onCanvasKeyUp);
    onCleanup(() => {
      disconnectWorkspace();
      window.removeEventListener("relay:toggle-device-panel", onToggleDevicePanel);
      window.removeEventListener("relay:open-device-panel", onOpenDevicePanel);
      window.removeEventListener("relay:close-device-panel", onCloseDevicePanel);
      window.removeEventListener("relay:run-app-map", onRunMap);
      window.removeEventListener("relay:record-path", onRecordPath);
      window.removeEventListener("relay:capture-screen", onCaptureScreen);
      window.removeEventListener("keydown", onCanvasKey);
      window.removeEventListener("keyup", onCanvasKeyUp);
    });
  });
}
