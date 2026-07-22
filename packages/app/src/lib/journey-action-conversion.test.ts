import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RecipeStep } from "./api-types";
import { convertStepAction, convertTapGesture } from "./journey-action-conversion";

const recordedTap: RecipeStep = {
  kind: "tap",
  target: { ref: "@e53", point: { x: 489, y: 1053 } },
  evidence: {
    id: "evidence-1",
    recordedAt: 1,
    pointer: { x: 489, y: 1053 },
  },
};

describe("convertStepAction", () => {
  it("preserves the target and evidence between compatible actions", () => {
    assert.deepEqual(convertStepAction(recordedTap, "type"), {
      kind: "type",
      text: "",
      target: recordedTap.target,
      evidence: recordedTap.evidence,
    });
  });

  it("uses sensible editable defaults", () => {
    assert.deepEqual(convertStepAction(recordedTap, "expect"), {
      kind: "expect",
      target: recordedTap.target,
      condition: "visible",
      evidence: recordedTap.evidence,
    });
    assert.deepEqual(convertStepAction(recordedTap, "sleep"), {
      kind: "sleep",
      ms: 1_000,
    });
  });

  it("creates a real editable shape for every supported action", () => {
    const kinds: RecipeStep["kind"][] = [
      "tap",
      "type",
      "scroll",
      "swipe",
      "key",
      "sleep",
      "wait-for",
      "wait-response",
      "expect",
      "extract",
      "assert-content",
      "evaluate-semantic",
      "pause",
      "screenshot",
      "flow",
      "module",
      "branch",
      "repeat",
      "script",
      "clipboard",
      "app",
      "device",
      "rotate",
      "settings",
      "location",
      "permission",
      "alert",
      "network",
      "logs",
    ];
    for (const kind of kinds) assert.equal(convertStepAction(recordedTap, kind).kind, kind);
  });

  it("keeps the existing step when its action is selected again", () => {
    assert.equal(convertStepAction(recordedTap, "tap"), recordedTap);
  });

  it("preserves all recorded target data while changing tap gestures", () => {
    const held = convertTapGesture(recordedTap, "hold");
    assert.deepEqual(held, {
      ...recordedTap,
      gesture: "hold",
      durationMs: 700,
    });
    const multi = convertTapGesture(held, "multi");
    assert.deepEqual(multi, {
      ...recordedTap,
      gesture: "multi",
      durationMs: 700,
      tapCount: 2,
      intervalMs: 100,
    });
    assert.deepEqual(convertTapGesture(multi, "single"), {
      ...recordedTap,
      durationMs: 700,
      tapCount: 2,
      intervalMs: 100,
    });
  });
});
