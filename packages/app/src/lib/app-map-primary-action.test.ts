import assert from "node:assert/strict";
import test from "node:test";
import { appMapPrimaryAction } from "./app-map-primary-action";

const runnable = {
  visible: true,
  ready: true,
  reason: "",
  next: "run" as const,
  label: "Run path",
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
    "Reconnect device",
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
      label: "Fix steps",
      reason: "Fix incomplete steps before running this path",
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
    { kind: "run", label: "Run path", reason: "", icon: "play" },
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
      reason: "Stop the current run on the device",
      icon: "x",
    },
  );
});

test("screens without paths point at record path", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "saved",
      run: {
        visible: true,
        ready: false,
        reason: "Record taps between screens",
        next: "record",
        label: "Record path",
        transitionPath: null,
      },
      serverOnline: true,
      device: { kind: "ready" },
    }),
    {
      kind: "record-path",
      label: "Record path",
      reason: "Record taps between screens",
      icon: "circle",
    },
  );
});

test("recording names its source when the device is on a mapped screen", () => {
  assert.equal(
    appMapPrimaryAction({
      saveState: "saved",
      run: {
        visible: true,
        ready: false,
        reason: "Record taps between screens",
        next: "record",
        label: "Record path",
        transitionPath: null,
      },
      serverOnline: true,
      device: { kind: "ready" },
      liveLocation: "here",
    }).label,
    "Start recording",
  );
});

test("a mapped live screen can extend the map without selecting a path first", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "saved",
      run: {
        visible: true,
        ready: false,
        reason: "Click a destination screen to replay the app up to it",
        next: "pick",
        label: "Choose a destination",
        transitionPath: null,
      },
      serverOnline: true,
      device: { kind: "ready" },
      liveLocation: "here",
    }),
    {
      kind: "record-path",
      label: "Start recording",
      reason: "Use the device to open the next screen; Relay will add the path to the map.",
      icon: "circle",
    },
  );
});

test("unkept paths point at keep path before run", () => {
  assert.deepEqual(
    appMapPrimaryAction({
      saveState: "saved",
      run: {
        visible: true,
        ready: false,
        reason: "Try this path on the device, then keep it before running",
        next: "keep",
        label: "Keep path",
        transitionPath: ["t1"],
      },
      serverOnline: true,
      device: { kind: "ready" },
    }),
    {
      kind: "keep-path",
      label: "Keep path",
      reason: "Try this path on the device, then keep it before running",
      icon: "check",
    },
  );
});
