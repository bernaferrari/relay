import assert from "node:assert/strict";
import test from "node:test";
import {
  connectAppMapShellCommands,
  connectAppMapWorkspaceCommands,
} from "./app-map-workspace-command-adapter";
import { createWorkspaceController } from "./workspace-controller";

test("Map editor owns typed target, device, Run, record, and capture commands", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  const disconnect = connectAppMapWorkspaceCommands(controller, {
    targetSelected: () => calls.push("selected"),
    toggleDevice: () => calls.push("toggle"),
    showDevice: () => calls.push("show"),
    hideDevice: () => calls.push("hide"),
    runTest: () => calls.push("run"),
    recordTest: () => calls.push("record"),
    captureScreen: () => calls.push("capture"),
    undoMap: () => calls.push("undo"),
    redoMap: () => calls.push("redo"),
  });

  controller.execute({ kind: "target.selected", targetId: "ipad-1" });
  controller.execute({ kind: "device.toggle" });
  controller.execute({ kind: "device.show" });
  controller.execute({ kind: "device.hide" });
  controller.execute({ kind: "test.run" });
  controller.execute({ kind: "test.record" });
  controller.execute({ kind: "screen.capture" });
  controller.execute({ kind: "map.undo" });
  controller.execute({ kind: "map.redo" });
  assert.deepEqual(calls, [
    "selected",
    "toggle",
    "show",
    "hide",
    "run",
    "record",
    "capture",
    "undo",
    "redo",
  ]);

  disconnect();
  assert.equal(controller.execute({ kind: "test.run" }), false);
});

test("Map command connection is a no-op without a shell controller", () => {
  assert.doesNotThrow(() =>
    connectAppMapWorkspaceCommands(undefined, {
      targetSelected() {},
      toggleDevice() {},
      showDevice() {},
      hideDevice() {},
      runTest() {},
      recordTest() {},
      captureScreen() {},
      undoMap() {},
      redoMap() {},
    })(),
  );
});

test("Map shell owns typed target-set, tidy, history, and screen-reveal commands", () => {
  const controller = createWorkspaceController();
  const calls: unknown[] = [];
  const disconnect = connectAppMapShellCommands(controller, {
    chooseTargetSet: (targetSetId) => calls.push(["target-set", targetSetId]),
    tidyMap: () => calls.push(["tidy"]),
    toggleHistory: () => calls.push(["history"]),
    revealScreen: ({ appMapId, screenId }) => calls.push(["reveal", appMapId, screenId]),
  });

  controller.execute({ kind: "map.target-set.choose", targetSetId: "release" });
  controller.execute({ kind: "map.tidy" });
  controller.execute({ kind: "map.history.toggle" });
  controller.execute({ kind: "map.screen.reveal", appMapId: "map-1", screenId: "settings" });
  assert.deepEqual(calls, [
    ["target-set", "release"],
    ["tidy"],
    ["history"],
    ["reveal", "map-1", "settings"],
  ]);
  disconnect();
  assert.equal(controller.execute({ kind: "map.tidy" }), false);
});
