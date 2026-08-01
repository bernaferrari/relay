import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import type { JourneyRunReadiness } from "../lib/journey-run-readiness";
import type { AppMapCanvasTool } from "./app-map-toolbar";

export function createAppMapEventOrchestration(options: {
  devicePanelOpen: Accessor<boolean>;
  reviewingTake: Accessor<boolean>;
  runReadiness: Accessor<JourneyRunReadiness>;
  canvasTool: Accessor<AppMapCanvasTool>;
  renamingScreen: Accessor<boolean>;
  onDeviceSelected: () => void;
  onToggleDevicePanel: () => void;
  onCloseDevicePanel: () => void;
  onRunMap: () => void;
  onCloseTargetSet: () => void;
  onUndoRequest: (event: Event, redo: boolean) => void;
  onToolChange: (tool: AppMapCanvasTool) => void;
  onCaptureScreen: () => void;
  onAddNote: () => void;
  onCreateConnection: () => void;
  onRecord: () => void;
  onEscape: () => void;
}) {
  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:device-panel-state", {
        detail: { open: options.devicePanelOpen() && !options.reviewingTake() },
      }),
    );
  });

  createEffect(() => {
    window.dispatchEvent(
      new CustomEvent("relay:graph-run-readiness", { detail: options.runReadiness() }),
    );
  });

  onMount(() => {
    let toolBeforeSpace: AppMapCanvasTool | null = null;
    const onToggleDevicePanel = () => options.onToggleDevicePanel();
    const onCloseDevicePanel = () => options.onCloseDevicePanel();
    const onRunMap = () => options.onRunMap();
    const onOutsideTargetSet = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest?.("[data-target-set-picker]")) {
        options.onCloseTargetSet();
      }
    };
    const onUndoRequest = (event: Event) => {
      const request = event as CustomEvent<{ redo: boolean }>;
      options.onUndoRequest(event, request.detail.redo);
    };
    const onCanvasKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        options.onCaptureScreen();
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        options.onAddNote();
        return;
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        options.onCreateConnection();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        options.onRecord();
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

    window.addEventListener("relay:device-selected", options.onDeviceSelected);
    window.addEventListener("relay:toggle-device-panel", onToggleDevicePanel);
    window.addEventListener("relay:close-device-panel", onCloseDevicePanel);
    window.addEventListener("relay:run-journey-graph", onRunMap);
    window.addEventListener("relay:undo-request", onUndoRequest);
    window.addEventListener("pointerdown", onOutsideTargetSet);
    window.addEventListener("keydown", onCanvasKey);
    window.addEventListener("keyup", onCanvasKeyUp);
    onCleanup(() => {
      window.removeEventListener("relay:device-selected", options.onDeviceSelected);
      window.removeEventListener("relay:toggle-device-panel", onToggleDevicePanel);
      window.removeEventListener("relay:close-device-panel", onCloseDevicePanel);
      window.removeEventListener("relay:run-journey-graph", onRunMap);
      window.removeEventListener("relay:undo-request", onUndoRequest);
      window.removeEventListener("pointerdown", onOutsideTargetSet);
      window.removeEventListener("keydown", onCanvasKey);
      window.removeEventListener("keyup", onCanvasKeyUp);
    });
  });
}
