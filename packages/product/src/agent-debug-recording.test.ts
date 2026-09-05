import assert from "node:assert/strict";
import test from "node:test";
import { startDebugBugRecording } from "@relay/workflows/recording-outcomes";

test("Agent Debug forwards the typed origin into the canonical recording intent", async () => {
  let received: unknown;
  const result = await startDebugBugRecording(
    {
      record: async (intent) => {
        received = intent;
        return { authoring: { sessionId: "session-debug" } } as never;
      },
    },
    "agent:test",
    {
      kind: "debug-bug",
      action: "start",
      title: "Investigate submit",
      targetId: "target-a",
      confirmControl: true,
      debugOrigin: {
        schemaVersion: 1,
        source: { runId: "run-failed", attempt: 1, stepId: "step-submit" },
        evidenceRefs: ["evidence-a"],
        configRefs: ["build:7"],
      },
    },
  );
  assert.deepEqual(received, {
    kind: "record-test",
    title: "Investigate submit",
    targetId: "target-a",
    confirmControl: true,
    debugOrigin: {
      schemaVersion: 1,
      source: { runId: "run-failed", attempt: 1, stepId: "step-submit" },
      evidenceRefs: ["evidence-a"],
      configRefs: ["build:7"],
    },
  });
  assert.equal(result.recording.authoring?.sessionId, "session-debug");
});
