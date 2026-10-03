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
  onRecord?: (intent: unknown) => void;
  onAdvance?: (decision: unknown) => void;
}) {
  return {
    async connect() {
      return { targets: [target], current: target };
    },
    async record(intent: unknown) {
      input.onRecord?.(intent);
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

test("recording connection forwards the selected surface scope", async () => {
  let received: unknown;
  const jobs = jobsFor({});
  jobs.connect = async (intent?: unknown) => {
    received = intent;
    return { targets: [target], current: target };
  };
  const journey = createProductRecordingJourney({ jobs });
  await journey.connect({ targetKind: "device" });
  assert.deepEqual(received, { kind: "connect-target", targetKind: "device" });
});

test("recording preserves selected Map path identity", async () => {
  let recordedIntent: unknown;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({ onRecord: (intent) => (recordedIntent = intent) }),
  });

  await journey.begin({
    title: "Checkout path",
    appMapId: "app-1",
    targetId: "pixel-9",
    sourceScreenId: "cart",
    pendingConnectionId: "cart-to-confirmation",
  });

  assert.deepEqual(recordedIntent, {
    kind: "record-test",
    title: "Checkout path",
    appMapId: "app-1",
    targetId: "pixel-9",
    sourceScreenId: "cart",
    pendingConnectionId: "cart-to-confirmation",
    confirmControl: true,
  });
});

test("recording carries the prepared browser session and account", async () => {
  let recordedIntent: unknown;
  const journey = createProductRecordingJourney({
    jobs: jobsFor({ onRecord: (intent) => (recordedIntent = intent) }),
  });

  await journey.begin({
    title: "Checkout path",
    appMapId: "app-1",
    targetId: "checkout-browser",
    liveSessionId: "live-member-session",
    authenticationFixtureId: "authfx:member:1",
  });

  assert.deepEqual(recordedIntent, {
    kind: "record-test",
    title: "Checkout path",
    appMapId: "app-1",
    targetId: "checkout-browser",
    liveSessionId: "live-member-session",
    authenticationFixtureId: "authfx:member:1",
    confirmControl: true,
  });
});

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

test("an unavailable read preserves the review while blocking mutations until fresh inspection", async () => {
  let unavailable = true;
  let writes = 0;
  const review = {
    actionCount: 1,
    actions: [
      {
        id: "step",
        intent: "Open settings",
        stepCount: 1,
        captureProof: "relay-controlled" as const,
      },
    ],
    replayRequired: false,
  };
  const healthy = snapshot("reviewing", ["inspect", "approve"], 9, { review });
  const jobs = jobsFor({
    recorded: healthy,
    onAdvance: () => {
      writes++;
    },
  });
  jobs.inspect = async () =>
    unavailable
      ? snapshot("unknown", ["inspect"], 1, {
          version: "unavailable",
          phase: "needs-attention",
          frozen: undefined,
          authoring: undefined,
          problems: [
            {
              code: "operation-unavailable",
              title: "Connection interrupted",
              detail: "Offline",
              recovery: "Try again",
              retryable: true,
            },
          ],
        })
      : healthy;
  const journey = createProductRecordingJourney({ jobs });
  await journey.begin({ title: "Settings" });
  const failed = await journey.approve();
  assert.equal(writes, 0);
  assert.deepEqual(failed.snapshot?.review, review);
  assert.deepEqual(failed.snapshot?.allowedNextActions, ["inspect"]);
  assert.equal(failed.recovery?.code, "operation-unavailable");
  assert.equal(failed.snapshot?.workflow?.expectedVersion, 9);
  unavailable = false;
  const restored = await journey.inspect();
  assert.equal(restored.recovery, undefined);
  assert.deepEqual(restored.snapshot?.allowedNextActions, ["inspect", "approve"]);
});

function saveFixture(
  options: {
    alreadyVerified?: boolean;
    priorFailure?: boolean;
    replayOutcome?: "passed" | "failed";
    inspectFailure?: boolean;
    uncertainReplay?: boolean;
    changeAfterReplay?: boolean;
  } = {},
) {
  let canonical = snapshot(
    "reviewing",
    ["inspect", "edit", "replay", ...(options.alreadyVerified ? ["approve" as const] : [])],
    10,
    {
      review: {
        currentRevision: 1,
        actionCount: 1,
        actions: [
          {
            id: "step-1",
            intent: "Open settings",
            stepCount: 1,
            captureProof: "relay-controlled" as const,
          },
        ],
        replayRequired: !options.alreadyVerified,
      },
    },
  );
  if (options.priorFailure)
    canonical.problems = [
      {
        code: "operation-unavailable",
        title: "Check failed",
        detail: "Expected screen missing",
        recovery: "Fix the step",
        retryable: true,
      },
    ];
  const decisions: Record<string, unknown>[] = [];
  const jobs = jobsFor({ recorded: canonical });
  jobs.inspect = async () => {
    if (options.inspectFailure) throw new Error("Connection interrupted");
    if (options.changeAfterReplay && decisions.some((item) => item.action === "replay")) {
      canonical = { ...canonical, review: { ...canonical.review!, currentRevision: 99 } };
    }
    return canonical;
  };
  jobs.advanceRecording = async (input) => {
    const decision = input as Record<string, unknown>;
    decisions.push(decision);
    if (decision.action === "replay" && options.uncertainReplay) throw new Error("Response lost");
    const revision = canonical.review!.currentRevision!;
    const version = canonical.workflow!.expectedVersion + 1;
    if (decision.action === "edit") {
      canonical = snapshot("reviewing", ["inspect", "edit", "replay"], version, {
        review: { ...canonical.review!, currentRevision: revision + 1, replayRequired: true },
      });
    } else if (decision.action === "replay") {
      const outcome = options.replayOutcome ?? "passed";
      canonical = snapshot(
        "reviewing",
        ["inspect", "edit", "replay", ...(outcome === "passed" ? ["approve" as const] : [])],
        version,
        {
          review: {
            ...canonical.review!,
            latestReplay: { id: "replay-1", takeRevision: revision, outcome },
            replayRequired: outcome !== "passed",
          },
        },
      );
    } else {
      canonical = snapshot("committed", ["inspect"], version);
    }
    return canonical;
  };
  return { journey: createProductRecordingJourney({ jobs }), decisions };
}

test("Save checks edited steps and approves with fresh canonical versions", async () => {
  const { journey, decisions } = saveFixture();
  await journey.begin({ title: "Settings" });
  const progress: string[] = [];
  const result = await journey.save({
    testName: " Settings ",
    reviewRevision: 1,
    onProgress: (phase) => progress.push(phase),
  });
  assert.equal(result.status, "saved");
  assert.deepEqual(progress, ["checking", "saving"]);
  assert.deepEqual(decisions, [
    { workflowId: "workflow-1", expectedVersion: 10, action: "replay" },
    { workflowId: "workflow-1", expectedVersion: 11, action: "approve", testName: "Settings" },
  ]);
});

test("Save preserves the canonical permission to save an unedited recording immediately", async () => {
  const { journey, decisions } = saveFixture({ alreadyVerified: true });
  await journey.begin({ title: "Settings" });
  assert.equal((await journey.save({ testName: "Settings", reviewRevision: 1 })).status, "saved");
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    ["approve"],
  );
});

test("Save includes an unsaved instruction and checks its resulting revision", async () => {
  const { journey, decisions } = saveFixture({ alreadyVerified: true });
  await journey.begin({ title: "Settings" });
  const rename = { actionId: "step-1", intent: "Open app settings" };
  assert.equal(
    (await journey.save({ testName: "Settings", reviewRevision: 1, rename })).status,
    "saved",
  );
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    ["edit", "replay", "approve"],
  );
  assert.deepEqual(decisions[0]?.edit, { kind: "rename", ...rename });
  assert.equal(decisions[2]?.expectedVersion, 12);
});

test("Save draft persists an edited revision without any replay or approval", async () => {
  const { journey, decisions } = saveFixture({ alreadyVerified: true });
  await journey.begin({ title: "Settings" });
  const rename = { actionId: "step-1", intent: "Open settings" };
  const result = await journey.saveDraft({ reviewRevision: 1, rename });
  assert.equal(result.snapshot?.stage, "reviewing");
  assert.equal(result.snapshot?.review?.currentRevision, 2);
  assert.equal(result.snapshot?.review?.replayRequired, true);
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    ["edit"],
  );
  assert.deepEqual(decisions[0]?.edit, { kind: "rename", ...rename });
});

test("Save draft refuses stale edits and leaves verification unchanged on a read-only save", async () => {
  const { journey, decisions } = saveFixture({ alreadyVerified: true });
  await journey.begin({ title: "Settings" });
  const initial = await journey.saveDraft({ reviewRevision: 1 });
  assert.equal(initial.snapshot?.stage, "reviewing");
  assert.ok(initial.snapshot?.allowedNextActions.includes("approve"));
  assert.equal(
    (
      await journey.saveDraft({
        reviewRevision: 0,
        rename: { actionId: "step-1", intent: "Stale" },
      })
    ).recovery?.code,
    "unexpected-authoring-state",
  );
  assert.equal(decisions.length, 0);
});

for (const [name, options] of [
  ["failed check", { replayOutcome: "failed" as const }],
  ["uncertain check", { uncertainReplay: true }],
  ["unavailable inspection", { inspectFailure: true }],
  ["steps changed after checking", { changeAfterReplay: true }],
] as const) {
  test(`Save stops on ${name} without approving or retrying`, async () => {
    const { journey, decisions } = saveFixture(options);
    await journey.begin({ title: "Settings" });
    const result = await journey.save({ testName: "Settings", reviewRevision: 1 });
    assert.notEqual(result.status, "saved");
    assert.equal(
      decisions.some((decision) => decision.action === "approve"),
      false,
    );
    assert.ok(decisions.length <= 1);
    if (name !== "failed check") assert.ok(result.recovery);
  });
}

test("Save refuses a stale reviewed revision before sending any mutation", async () => {
  const { journey, decisions } = saveFixture();
  await journey.begin({ title: "Settings" });
  const result = await journey.save({ testName: "Settings", reviewRevision: 0 });
  assert.equal(result.recovery?.title, "The steps changed");
  assert.deepEqual(decisions, []);
});

test("Save can explicitly check again after a known failed replay", async () => {
  const { journey, decisions } = saveFixture({ priorFailure: true });
  await journey.begin({ title: "Settings" });
  assert.equal((await journey.save({ testName: "Settings", reviewRevision: 1 })).status, "saved");
  assert.deepEqual(
    decisions.map((decision) => decision.action),
    ["replay", "approve"],
  );
});
