import assert from "node:assert/strict";
import test from "node:test";
import { connectAppMapWorkspaceCommands } from "./app-map-workspace-command-adapter";
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
  });

  controller.execute({ kind: "target.selected", targetId: "ipad-1" });
  controller.execute({ kind: "device.toggle" });
  controller.execute({ kind: "device.show" });
  controller.execute({ kind: "device.hide" });
  controller.execute({ kind: "test.run" });
  controller.execute({ kind: "test.record" });
  controller.execute({ kind: "screen.capture" });
  assert.deepEqual(calls, ["selected", "toggle", "show", "hide", "run", "record", "capture"]);

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
    })(),
  );
});
