import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceController } from "./workspace-controller";

test("workspace controller routes typed commands to their surface owners", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  controller.connect({
    chooseTarget: () => calls.push("target"),
    targetSelected: (targetId) => calls.push(`selected:${targetId}`),
    openRun: (runId) => calls.push(`run:${runId ?? "latest"}`),
    runTest: () => calls.push("run-test"),
    recordTest: () => calls.push("record"),
  });
  controller.connect({
    toggleDevice: () => calls.push("device-toggle"),
    showDevice: () => calls.push("device"),
    deviceStateChanged: (open) => calls.push(`device-state:${open}`),
    runReadinessChanged: (readiness) => calls.push(`ready:${readiness.ready}`),
    captureScreen: () => calls.push("capture"),
  });

  assert.equal(controller.execute({ kind: "target.choose" }), true);
  assert.equal(controller.execute({ kind: "target.selected", targetId: "ipad-1" }), true);
  assert.equal(controller.execute({ kind: "device.toggle" }), true);
  assert.equal(controller.execute({ kind: "device.show" }), true);
  assert.equal(controller.execute({ kind: "device.state", open: true }), true);
  assert.equal(controller.execute({ kind: "run.open", runId: "run-7" }), true);
  assert.equal(controller.execute({ kind: "test.run" }), true);
  assert.equal(
    controller.execute({
      kind: "test.run-readiness",
      readiness: {
        visible: true,
        ready: true,
        reason: "Ready",
        next: "run",
        label: "Run Test",
        transitionPath: null,
      },
    }),
    true,
  );
  assert.equal(controller.execute({ kind: "test.record" }), true);
  assert.equal(controller.execute({ kind: "screen.capture" }), true);
  assert.deepEqual(calls, [
    "target",
    "selected:ipad-1",
    "device-toggle",
    "device",
    "device-state:true",
    "run:run-7",
    "run-test",
    "ready:true",
    "record",
    "capture",
  ]);
});

test("workspace controller disconnect is idempotent and reports unhandled commands", () => {
  const controller = createWorkspaceController();
  let calls = 0;
  const disconnect = controller.connect({ showDevice: () => calls++ });

  assert.equal(controller.execute({ kind: "device.show" }), true);
  disconnect();
  disconnect();
  assert.equal(controller.execute({ kind: "device.show" }), false);
  assert.equal(calls, 1);
});

test("workspace controller uses a stable adapter snapshot during execution", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  let disconnectSecond: () => void = () => undefined;
  controller.connect({
    hideDevice: () => {
      calls.push("first");
      disconnectSecond();
    },
  });
  disconnectSecond = controller.connect({ hideDevice: () => calls.push("second") });

  assert.equal(controller.execute({ kind: "device.hide" }), true);
  assert.deepEqual(calls, ["first", "second"]);
  calls.length = 0;
  controller.execute({ kind: "device.hide" });
  assert.deepEqual(calls, ["first"]);
});
