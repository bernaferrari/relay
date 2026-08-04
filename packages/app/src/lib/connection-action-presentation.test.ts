import assert from "node:assert/strict";
import test from "node:test";
import type { ActionSpec } from "@relay/protocol";
import { connectionActionSummaries, updateConnectionWait } from "./connection-action-presentation";

test("recorded actions become concise rows with an editable pause", () => {
  const actions: ActionSpec[] = [
    {
      id: "recording",
      kind: "recorded",
      takeId: "take",
      takeRevision: 1,
      evidenceIds: [],
      steps: [
        { id: "tap", kind: "tap", target: { label: "Continue" } },
        { id: "pause", kind: "sleep", ms: 5_650 },
      ],
    },
  ];

  assert.deepEqual(connectionActionSummaries(actions, null), [
    { id: "recording:tap", actionId: "recording", stepId: "tap", label: 'Tap "Continue"' },
    {
      id: "recording:pause",
      actionId: "recording",
      stepId: "pause",
      label: "Wait",
      waitMs: 5_650,
    },
  ]);
  const updated = updateConnectionWait(actions, "recording", "pause", 1_000);
  assert.equal(
    updated[0]?.kind === "recorded"
      ? updated[0].steps[1]?.kind === "sleep" && updated[0].steps[1].ms
      : 0,
    1_000,
  );
  assert.equal(
    actions[0]?.kind === "recorded"
      ? actions[0].steps[1]?.kind === "sleep" && actions[0].steps[1].ms
      : 0,
    5_650,
  );
});

test("direct waits clamp to a finite non-negative millisecond value", () => {
  const actions: ActionSpec[] = [{ id: "wait", kind: "wait", ms: 500 }];
  assert.deepEqual(updateConnectionWait(actions, "wait", undefined, -20), [
    { id: "wait", kind: "wait", ms: 0 },
  ]);
});
