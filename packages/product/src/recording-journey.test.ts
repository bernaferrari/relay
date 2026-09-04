import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringInteraction } from "@relay/protocol";
import type { AuthorTestSnapshot } from "@relay/workflows";
import { createProductRecordingJourney } from "./recording-journey.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;

function snapshot(
  stage: AuthorTestSnapshot["stage"],
  allowedNextActions: AuthorTestSnapshot["allowedNextActions"],
  expectedVersion = 4,
  extra: Partial<AuthorTestSnapshot> = {},
): AuthorTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "author-test",
    title: "Settings language",
    phase: stage === "committed" ? "succeeded" : "running",
    stage,
    version: `workflow-v${expectedVersion}`,
    workflow: { workflowId: "workflow-1", expectedVersion },
    frozen: {
      title: "Settings language",
      actorId: "actor-1",
      appMapId: "app-1",
      appMapRevision: 3,
      target,
    },
    authoring: { sessionId: "session-1" },
    progress: { label: stage },
    allowedNextActions,
    problems: [],
    evidenceRefs: [],
    ...extra,
  };
}

function jobsFor(input: {
  recorded?: AuthorTestSnapshot;
  inspected?: AuthorTestSnapshot;
  advanced?: AuthorTestSnapshot;
  onAdvance?: (decision: unknown) => void;
}) {
  return {
    async connect() {
      return { targets: [target], current: target };
    },
    async record(intent: unknown) {
      void intent;
      return input.recorded ?? snapshot("recording", ["inspect", "stop"]);
    },
    async inspect() {
      return input.inspected ?? input.recorded ?? snapshot("recording", ["inspect", "stop"]);
    },
    async advanceRecording(decision: unknown) {
      input.onAdvance?.(decision);
      return input.advanced ?? snapshot("reviewing", ["inspect", "replay"]);
    },
  };
}

test("recording transitions are gated by canonical allowedNextActions", async () => {
  let advanceCalls = 0;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({
      recorded: snapshot("recording", ["inspect", "stop"]),
      onAdvance: () => advanceCalls++,
    }),
  });

  await journey.begin({ title: "Settings language", appMapId: "app-1", targetId: "pixel-9" });
  const blocked = await journey.replay();

  assert.equal(blocked.recovery?.code, "unexpected-authoring-state");
  assert.equal(blocked.recovery?.action, "replay");
  assert.equal(advanceCalls, 0);
});

test("a transition forwards the inspected workflow version as the CAS fence", async () => {
  let decision: unknown;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({
      recorded: snapshot("recording", ["inspect", "stop"], 17),
      inspected: snapshot("recording", ["inspect", "stop"], 17),
      advanced: snapshot("reviewing", ["inspect", "replay"], 18),
      onAdvance: (next) => (decision = next),
    }),
  });

  await journey.begin({ title: "Settings language" });
  const next = await journey.stop();

  assert.deepEqual(decision, {
    workflowId: "workflow-1",
    expectedVersion: 17,
    action: "stop",
  });
  assert.equal(next.snapshot?.workflow?.expectedVersion, 18);
  assert.equal(next.status, "reviewing");
});

test("review edits use the canonical edit transition", async () => {
  let decision: unknown;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({
      recorded: snapshot("reviewing", ["inspect", "edit", "replay"], 9),
      inspected: snapshot("reviewing", ["inspect", "edit", "replay"], 9),
      advanced: snapshot("reviewing", ["inspect", "edit", "replay"], 10),
      onAdvance: (next) => (decision = next),
    }),
  });

  await journey.begin({ title: "Settings language" });
  const next = await journey.edit({
    kind: "rename",
    actionId: "action-1",
    intent: "Open settings",
  });

  assert.deepEqual(decision, {
    workflowId: "workflow-1",
    expectedVersion: 9,
    action: "edit",
    edit: { kind: "rename", actionId: "action-1", intent: "Open settings" },
  });
  assert.equal(next.snapshot?.workflow?.expectedVersion, 10);
});

test("public state is bounded and detached from the canonical projection", async () => {
  const interaction = { kind: "screenshot", label: "Before" } as AuthoringInteraction;
  const unsafe = Object.assign(snapshot("recording", ["inspect", "record", "stop"]), {
    session: { secretFrameBytes: "must-not-cross-the-product-boundary" },
  }) as AuthorTestSnapshot;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({ recorded: unsafe }),
  });
  await journey.connect();
  await journey.begin({ title: "Settings language" });

  const exposed = journey.state();
  (exposed.targets[0] as { targetId: string }).targetId = "mutated";
  (exposed.snapshot as unknown as { allowedNextActions: readonly never[] }).allowedNextActions = [];
  assert.equal(journey.state().targets[0]?.targetId, "pixel-9");
  assert.deepEqual(journey.state().snapshot?.allowedNextActions, ["inspect", "record", "stop"]);
  assert.equal("session" in (journey.state().snapshot ?? {}), false);

  const result = await journey.record(interaction);
  assert.equal(result.snapshot?.stage, "reviewing");
});
