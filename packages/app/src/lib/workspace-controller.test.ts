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
    openChanges: () => calls.push("changes"),
    openSettings: (section) => calls.push(`settings:${section ?? "appearance"}`),
    runTest: () => calls.push("run-test"),
    recordTest: () => calls.push("record"),
  });
  controller.connect({
    toggleDevice: () => calls.push("device-toggle"),
    showDevice: () => calls.push("device"),
    deviceStateChanged: (open) => calls.push(`device-state:${open}`),
    runReadinessChanged: (readiness) => calls.push(`ready:${readiness.ready}`),
    captureScreen: () => calls.push("capture"),
    chooseMapTargetSet: (targetSetId) => calls.push(`target-set:${targetSetId ?? "none"}`),
    mapTargetSetChanged: (targetSetId) => calls.push(`target-set-state:${targetSetId ?? "none"}`),
    undoMap: () => calls.push("undo-map"),
    redoMap: () => calls.push("redo-map"),
    tidyMap: () => calls.push("tidy-map"),
    toggleMapHistory: () => calls.push("map-history"),
    revealMapScreen: ({ appMapId, screenId }) => calls.push(`reveal:${appMapId}:${screenId}`),
  });

  assert.equal(controller.request({ kind: "target.choose" }), true);
  assert.equal(controller.publish({ kind: "target.selected", targetId: "ipad-1" }), true);
  assert.equal(controller.request({ kind: "device.toggle" }), true);
  assert.equal(controller.request({ kind: "device.show" }), true);
  assert.equal(controller.publish({ kind: "device.state", open: true }), true);
  assert.equal(controller.request({ kind: "run.open", runId: "run-7" }), true);
  assert.equal(controller.request({ kind: "changes.open" }), true);
  assert.equal(controller.request({ kind: "settings.open", section: "devices" }), true);
  assert.equal(controller.request({ kind: "test.run" }), true);
  assert.equal(
    controller.publish({
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
  assert.equal(controller.request({ kind: "test.record" }), true);
  assert.equal(controller.request({ kind: "screen.capture" }), true);
  assert.equal(controller.request({ kind: "map.target-set.choose", targetSetId: "release" }), true);
  assert.equal(controller.publish({ kind: "map.target-set.state" }), true);
  assert.equal(controller.request({ kind: "map.undo" }), true);
  assert.equal(controller.request({ kind: "map.redo" }), true);
  assert.equal(controller.request({ kind: "map.tidy" }), true);
  assert.equal(controller.request({ kind: "map.history.toggle" }), true);
  assert.equal(
    controller.request({ kind: "map.screen.reveal", appMapId: "map-1", screenId: "settings" }),
    true,
  );
  assert.deepEqual(calls, [
    "target",
    "selected:ipad-1",
    "device-toggle",
    "device",
    "device-state:true",
    "run:run-7",
    "changes",
    "settings:devices",
    "run-test",
    "ready:true",
    "record",
    "capture",
    "target-set:release",
    "target-set-state:none",
    "undo-map",
    "redo-map",
    "tidy-map",
    "map-history",
    "reveal:map-1:settings",
  ]);
});

test("workspace controller disconnect is idempotent and reports unhandled commands", () => {
  const controller = createWorkspaceController();
  let calls = 0;
  const disconnect = controller.connect({ showDevice: () => calls++ });

  assert.equal(controller.request({ kind: "device.show" }), true);
  disconnect();
  disconnect();
  assert.equal(controller.request({ kind: "device.show" }), false);
  assert.equal(calls, 1);
});

test("workspace controller uses a stable adapter snapshot during notification delivery", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  let disconnectSecond: () => void = () => undefined;
  controller.connect({
    deviceStateChanged: () => {
      calls.push("first");
      disconnectSecond();
    },
  });
  disconnectSecond = controller.connect({ deviceStateChanged: () => calls.push("second") });

  assert.equal(controller.publish({ kind: "device.state", open: false }), true);
  assert.deepEqual(calls, ["first", "second"]);
  calls.length = 0;
  controller.publish({ kind: "device.state", open: false });
  assert.deepEqual(calls, ["first"]);
});

test("workspace controller rejects duplicate imperative owners before any effect", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  controller.connect({ showDevice: () => calls.push("first") });
  controller.connect({ showDevice: () => calls.push("second") });

  assert.throws(
    () => controller.request({ kind: "device.show" }),
    /Workspace request "device\.show" has 2 owners/,
  );
  assert.deepEqual(calls, []);
});

test("workspace controller publishes notifications to every observer", () => {
  const controller = createWorkspaceController();
  const calls: string[] = [];
  controller.connect({ deviceStateChanged: (open) => calls.push(`first:${open}`) });
  controller.connect({ deviceStateChanged: (open) => calls.push(`second:${open}`) });

  assert.equal(controller.publish({ kind: "device.state", open: true }), true);
  assert.deepEqual(calls, ["first:true", "second:true"]);
});

test("retired DOM event names are inert while typed owners request once and disconnect safely", () => {
  const controller = createWorkspaceController();
  const target = new EventTarget();
  const calls: string[] = [];
  const disconnect = controller.connect({
    chooseTarget: () => calls.push("target"),
    showDevice: () => calls.push("device"),
    openSettings: (section) => calls.push(`settings:${section}`),
    openRun: (runId) => calls.push(`run:${runId}`),
  });

  for (const name of [
    "relay:open-device-picker",
    "relay:toggle-device-panel",
    "relay:open-device-panel",
    "relay:close-device-panel",
    "relay:open-settings",
    "relay:open-run-history",
  ]) {
    target.dispatchEvent(new CustomEvent(name, { detail: { jobId: "legacy" } }));
  }
  assert.deepEqual(calls, []);

  assert.equal(controller.request({ kind: "target.choose" }), true);
  assert.equal(controller.request({ kind: "device.show" }), true);
  assert.equal(controller.request({ kind: "settings.open", section: "devices" }), true);
  assert.equal(controller.request({ kind: "run.open", runId: "run-1" }), true);
  assert.deepEqual(calls, ["target", "device", "settings:devices", "run:run-1"]);

  disconnect();
  disconnect();
  assert.equal(controller.request({ kind: "target.choose" }), false);
  assert.equal(controller.request({ kind: "settings.open" }), false);
  assert.equal(calls.length, 4);
});
