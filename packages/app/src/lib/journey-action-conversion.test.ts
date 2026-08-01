import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RecipeStep } from "./api-types";
import {
  convertStepAction,
  convertTapGesture,
  type EditableActionKind,
} from "./journey-action-conversion";

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

  it("uses sensible editable defaults without dropping recorded context", () => {
    assert.deepEqual(convertStepAction(recordedTap, "expect"), {
      kind: "expect",
      target: recordedTap.target,
      condition: "visible",
      evidence: recordedTap.evidence,
    });
    assert.deepEqual(convertStepAction(recordedTap, "sleep"), {
      kind: "sleep",
      ms: 1_000,
      evidence: recordedTap.evidence,
    });
    assert.deepEqual(convertStepAction(recordedTap, "scroll"), {
      kind: "scroll",
      direction: "down",
      evidence: recordedTap.evidence,
    });
  });

  it("creates a real editable shape for every supported action", () => {
    const kinds: EditableActionKind[] = [
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

  it("keeps durable editor identity while changing actions", () => {
    const converted = convertStepAction({ ...recordedTap, id: "step-recorded" }, "scroll");
    assert.equal(converted.id, "step-recorded");
    assert.equal(converted.evidence, recordedTap.evidence);
  });

  it("turns a tap into a useful swipe and keeps the swipe start when changing back", () => {
    const swipe = convertStepAction(recordedTap, "swipe");
    assert.deepEqual(swipe, {
      kind: "swipe",
      from: { x: 489, y: 1053 },
      to: { x: 489, y: 773 },
      evidence: recordedTap.evidence,
    });
    assert.deepEqual(convertStepAction(swipe, "tap"), {
      kind: "tap",
      target: { point: { x: 489, y: 1053 } },
      evidence: recordedTap.evidence,
    });
  });

  it("creates a centered vertical swipe when an action has screen bounds but no point", () => {
    const typed: RecipeStep = {
      kind: "type",
      text: "",
      evidence: {
        id: "evidence-2",
        recordedAt: 2,
        deviceBounds: { width: 1_080, height: 2_400 },
      },
    };
    assert.deepEqual(convertStepAction(typed, "swipe"), {
      kind: "swipe",
      from: {
        x: 540,
        y: 1632,
        anchor: { horizontal: "left", vertical: "top" },
        referenceBounds: { width: 1_080, height: 2_400 },
      },
      to: {
        x: 540,
        y: 960,
        anchor: { horizontal: "left", vertical: "top" },
        referenceBounds: { width: 1_080, height: 2_400 },
      },
      evidence: typed.evidence,
    });
  });

  it("uses a centered coordinate when a new tap has no detectable target", () => {
    assert.deepEqual(convertStepAction({ kind: "network", action: "dump" }, "tap"), {
      kind: "tap",
      target: {
        point: {
          x: 540,
          y: 1200,
          referenceBounds: { width: 1_080, height: 2_400 },
        },
      },
    });
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
