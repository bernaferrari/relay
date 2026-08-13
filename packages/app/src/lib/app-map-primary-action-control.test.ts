import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapPrimaryAction } from "./app-map-primary-action";
import { appMapPrimaryActionControl } from "./app-map-primary-action-control";

const actions: AppMapPrimaryAction[] = [
  { kind: "run", label: "Run path", reason: "", icon: "play" },
  {
    kind: "view-run",
    label: "View run",
    reason: "Open live progress",
    icon: "arrow-right",
  },
  {
    kind: "choose-device",
    label: "Choose device",
    reason: "Choose a target",
    icon: "smartphone",
  },
  {
    kind: "open-device",
    label: "Reconnect device",
    reason: "Reconnect the selected target",
    icon: "refresh",
  },
  {
    kind: "record-path",
    label: "Start recording",
    reason: "Record the next path",
    icon: "circle",
  },
  { kind: "keep-path", label: "Keep path", reason: "Keep this Take", icon: "check" },
  {
    kind: "capture-screen",
    label: "Save first screen",
    reason: "Capture the current screen",
    icon: "camera",
  },
  {
    kind: "blocked",
    label: "Connecting…",
    reason: "Waiting for pixels",
    icon: "refresh",
  },
];

test("all primary action kinds expose truthful button semantics and one activation", () => {
  for (const action of actions) {
    let activations = 0;
    const control = appMapPrimaryActionControl(action, () => {
      activations += 1;
    });

    assert.equal(control.label, action.label);
    assert.equal(control.blocked, action.kind === "blocked");
    assert.equal(control.describedBy, action.reason ? "app-map-primary-action-reason" : undefined);
    assert.equal(control.reason, action.reason);

    control.activate();
    assert.equal(activations, action.kind === "blocked" ? 0 : 1);
  }
});
