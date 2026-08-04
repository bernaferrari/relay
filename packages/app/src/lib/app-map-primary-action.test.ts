import assert from "node:assert/strict";
import test from "node:test";
import { appMapPrimaryAction } from "./app-map-primary-action";

const runnable = {
  visible: true,
  ready: true,
  reason: "",
  label: "Run flow" as const,
  transitionPath: ["transition-1"],
};

test("the primary action names the next real device action", () => {
  assert.equal(
    appMapPrimaryAction({
      saveState: "saved",
      run: runnable,
      serverOnline: true,
      device: { kind: "choose-device" },
    }).label,
    "Choose device",
  );
  assert.equal(
    appMapPrimaryAction({
      saveState: "saved",
      run: runnable,
      serverOnline: true,
      device: { kind: "screen-preparing", title: "Connecting", detail: "Waiting for pixels" },
    }).label,
    "Connecting…",
  );
  assert.equal(
    appMapPrimaryAction({
      saveState: "saved",
      run: runnable,
      serverOnline: true,
      device: { kind: "capture-error", title: "Unavailable", detail: "Open elsewhere" },
    }).label,
    "Open device",
  );
});

test("map validity takes precedence over device setup", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "invalid",
      run: runnable,
      serverOnline: true,
      device: { kind: "choose-device" },
    }),
    {
      kind: "blocked",
      label: "Fix actions",
      reason: "Fix incomplete actions before running this flow",
      icon: "alert",
    },
  );
});

test("a ready map and device produce the run action", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "saved",
      run: runnable,
      serverOnline: true,
      device: { kind: "ready" },
    }),
    { kind: "run", label: "Run flow", reason: "", icon: "play" },
  );
});

test("an active replay can always be stopped", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "saved",
      run: runnable,
      serverOnline: true,
      device: { kind: "ready" },
      running: true,
    }),
    {
      kind: "cancel",
      label: "Stop run",
      reason: "Stop the current replay",
      icon: "x",
    },
  );
});
