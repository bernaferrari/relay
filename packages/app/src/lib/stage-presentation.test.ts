import assert from "node:assert/strict";
import test from "node:test";
import { liveInspectionHint } from "./stage-presentation";

test("live inspection stays quiet when names are available", () => {
  assert.equal(liveInspectionHint({ inspectable: true, nodeCount: 12 }), null);
  assert.equal(liveInspectionHint({}), null);
});

test("live inspection tells a person to unlock, wake, or reconnect", () => {
  assert.deepEqual(liveInspectionHint({ inspectable: false, inspectionState: "asleep" }), {
    title: "Screen is off",
    detail: "Relay will wake it and try to read names again.",
    actionLabel: "Wake",
  });
  assert.deepEqual(liveInspectionHint({ inspectable: false, inspectionState: "keyguard" }), {
    title: "Unlock the phone",
    detail: "Names appear after you unlock. The picture still works.",
    actionLabel: "Try again",
  });
  assert.equal(
    liveInspectionHint({ inspectable: false, inspectionState: "unavailable" })?.actionLabel,
    "Reconnect",
  );
});
