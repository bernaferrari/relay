import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import { createAppMapEventOrchestration } from "./app-map-events";
import { createWorkspaceController } from "../lib/workspace-controller";

test("workspace commands replace the legacy run, capture, and device-panel event bus", () => {
  const controller = createWorkspaceController();
  const run = vi.fn();
  const record = vi.fn();
  const capture = vi.fn();
  const toggleDevice = vi.fn();
  const showDevice = vi.fn();
  const hideDevice = vi.fn();
  const root = document.createElement("div");
  document.body.append(root);

  const dispose = render(() => {
    createAppMapEventOrchestration({
      workspaceController: controller,
      devicePanelOpen: () => false,
      runReadiness: () => ({
        visible: true,
        ready: true,
        reason: "Ready",
        next: "run",
        label: "Run Test",
        transitionPath: null,
      }),
      canvasTool: () => "select",
      renamingScreen: () => false,
      onDeviceSelected() {},
      onToggleDevicePanel: toggleDevice,
      onOpenDevicePanel: showDevice,
      onCloseDevicePanel: hideDevice,
      onRunMap: run,
      onUndoRequest() {},
      onToolChange() {},
      onCaptureScreen: capture,
      onAddNote() {},
      onRecord: record,
      onDeleteSelection() {},
      onZoomStep() {},
      onEscape() {},
    });
    return <div />;
  }, root);

  expect(controller.execute({ kind: "test.run" })).toBe(true);
  expect(controller.execute({ kind: "test.record" })).toBe(true);
  expect(controller.execute({ kind: "screen.capture" })).toBe(true);
  expect(run).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledOnce();
  expect(controller.execute({ kind: "device.toggle" })).toBe(true);
  expect(controller.execute({ kind: "device.show" })).toBe(true);
  expect(controller.execute({ kind: "device.hide" })).toBe(true);
  expect(toggleDevice).toHaveBeenCalledOnce();
  expect(showDevice).toHaveBeenCalledOnce();
  expect(hideDevice).toHaveBeenCalledOnce();

  for (const name of [
    "relay:run-app-map",
    "relay:record-path",
    "relay:capture-screen",
    "relay:open-device-picker",
    "relay:toggle-device-panel",
    "relay:open-device-panel",
    "relay:close-device-panel",
    "relay:open-settings",
    "relay:open-run-history",
  ]) {
    window.dispatchEvent(
      new CustomEvent(name, { detail: { jobId: "legacy", section: "devices" } }),
    );
  }
  expect(run).toHaveBeenCalledOnce();
  expect(record).toHaveBeenCalledOnce();
  expect(capture).toHaveBeenCalledOnce();
  expect(toggleDevice).toHaveBeenCalledOnce();
  expect(showDevice).toHaveBeenCalledOnce();
  expect(hideDevice).toHaveBeenCalledOnce();

  dispose();
  root.remove();
  expect(controller.execute({ kind: "test.run" })).toBe(false);
  expect(controller.execute({ kind: "device.show" })).toBe(false);
});
