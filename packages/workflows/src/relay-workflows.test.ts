import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelayWorkflows,
  type AuthorTestIntent,
  type AuthorTestSnapshot,
  type RunTestIntent,
} from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;

function intent(overrides: Partial<RunTestIntent> = {}): RunTestIntent {
  return {
    kind: "run-test",
    appMapId: "settings",
    testId: "data-controls",
    target,
    ...overrides,
  };
}

function preflight(revision: number, blockers: Array<{ code: string; message: string }> = []) {
  return {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "settings",
    appMapRevision: revision,
    testId: "data-controls",
    planDigest: `plan-${revision}`,
    summary: {
      recipes: 1,
      checkedSelectors: 1,
      resolvedSelectors: blockers.length ? 0 : 1,
      unknownCursorTransitions: 0,
      reviewRequiredReturns: 0,
      blockers: blockers.length,
      warnings: 0,
    },
    selectors: [],
    cursorTimeline: [],
    returns: [],
    findings: blockers.map((blocker) => ({
      severity: "blocker",
      recipeId: "open-settings",
      ...blocker,
    })),
  };
}

function compileStep(
  revision: number,
  blockers?: Array<{ code: string; message: string }>,
): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: { plan: { rootRecipeId: "open-settings" }, preflight: preflight(revision, blockers) },
  };
}

function job(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    action: "app-map.test.run",
    status,
    queuedAt: 100,
    ...overrides,
  };
}

function runStep(revision: number, status = "queued"): ScriptedRelayStep {
  return {
    id: "app-map.test.run",
    output: {
      planIdentity: {
        appMapId: "settings",
        appMapRevision: revision,
        testId: "data-controls",
        rootRecipeId: "open-settings",
      },
      plan: { rootRecipeId: "open-settings" },
      job: job(status),
    },
  };
}

test("current revision is read once, compiled offline, and frozen into the exact run", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    compileStep(7),
    runStep(7),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(
    intent({
      revision: "current",
      startup: { mode: "verified-checkpoint", screenId: "data-controls" },
      sourceRevision: { vcs: "git", sha: "abcdef1", branch: "feature/workflows" },
      capture: { fullSurfaceScreenIds: ["data-controls"] },
    }),
  );

  assert.equal(snapshot.phase, "queued");
  assert.ok(snapshot.ref);
  assert.equal(snapshot.frozen?.appMapRevision, 7);
  assert.equal(snapshot.frozen?.planDigest, "plan-7");
  assert.equal(snapshot.frozen?.rootRecipeId, "open-settings");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect", "cancel"]);
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.get", "app-map.test.compile", "app-map.test.run"],
  );
  assert.deepEqual(scripted.invocations[2]?.input, {
    appMapId: "settings",
    testId: "data-controls",
    expectedRevision: 7,
    target,
    startup: { mode: "verified-checkpoint", screenId: "data-controls" },
    sourceRevision: { vcs: "git", sha: "abcdef1", branch: "feature/workflows" },
    surfaceCapture: { forceRecaptureScreenIds: ["data-controls"] },
  });
});

test("compile blockers are problems and never invoke the run mutation", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(4, [{ code: "selector-absent", message: "Settings is not proven" }]),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ revision: { exact: 4 } }));

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "compile-blocked");
  assert.equal(snapshot.problems[0]?.sourceCode, "selector-absent");
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile"],
  );
});

test("an exact revision bypasses the current read and remains the run revision", async () => {
  const scripted = createScriptedRelayClient([compileStep(12), runStep(12)]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ revision: { exact: 12 } }));

  assert.equal(snapshot.frozen?.appMapRevision, 12);
  const runInvocation = scripted.invocations[1];
  assert.ok(runInvocation);
  assert.equal(runInvocation.id, "app-map.test.run");
  assert.equal((runInvocation.input as { expectedRevision?: unknown }).expectedRevision, 12);
});

test("a revision that changes before compile fails closed without a run", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    compileStep(8),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent());

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "malformed-response");
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.get", "app-map.test.compile"],
  );
});

test("stale optimistic version returns the latest snapshot without cancelling", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(2),
    runStep(2, "queued"),
    { id: "job.get", output: { job: job("running", { startedAt: 110 }) } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 2 } }));
  assert.ok(started.ref);

  const snapshot = await workflows.advance({
    action: "cancel",
    ref: started.ref,
    expectedVersion: started.version,
  });

  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.problems.at(-1)?.code, "stale-workflow-version");
  assert.equal(scripted.invocations.filter(({ id }) => id === "job.cancel").length, 0);
  assert.equal(scripted.remaining(), 0);
});

test("cancel checks the exact active job and performs one cancellation", async () => {
  const active = job("running", { startedAt: 110 });
  const scripted = createScriptedRelayClient([
    compileStep(2),
    {
      ...runStep(2, "running"),
      output: {
        ...(runStep(2, "running").output as object),
        job: active,
      },
    },
    { id: "job.get", output: { job: active } },
    { id: "job.cancel", output: { job: job("cancelled", { startedAt: 110, finishedAt: 120 }) } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 2 } }));
  assert.ok(started.ref);

  const snapshot = await workflows.advance({
    action: "cancel",
    ref: started.ref,
    expectedVersion: started.version,
  });

  assert.equal(snapshot.phase, "cancelled");
  assert.deepEqual(scripted.invocations.at(-1), { id: "job.cancel", input: { jobId: "job-1" } });
  assert.equal(scripted.invocations.filter(({ id }) => id === "job.cancel").length, 1);
});

test("inspect reconstructs terminal progress and immutable evidence from the canonical job", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(5),
    runStep(5),
    {
      id: "job.get",
      output: {
        job: job("ok", { startedAt: 110, finishedAt: 140, frameCount: 8, runId: "run-9" }),
      },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 5 } }));
  assert.ok(started.ref);

  const snapshot = await workflows.inspect(started.ref);

  assert.equal(snapshot.phase, "succeeded");
  assert.deepEqual(snapshot.progress, { label: "Test completed", completed: 8 });
  assert.deepEqual(snapshot.evidenceRefs, [{ kind: "run", id: "run-9" }]);
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
});

test("malformed adapter output is rejected by canonical parsing and fails closed", async () => {
  const scripted = createScriptedRelayClient([
    { id: "app-map.test.compile", output: { plan: {} } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ revision: { exact: 3 } }));

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "operation-unavailable");
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile"],
  );
});

test("a mutation transport failure is never retried implicitly", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(3),
    { id: "app-map.test.run", error: new Error("response lost after dispatch") },
    runStep(3),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ revision: { exact: 3 } }));

  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
  assert.equal(snapshot.problems[0]?.retryable, false);
  assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.equal(scripted.remaining(), 1);
});

function authorIntent(overrides: Partial<AuthorTestIntent> = {}): AuthorTestIntent {
  return {
    kind: "author-test",
    title: "Data Controls path",
    appMapId: "settings",
    target,
    leaseId: "lease-1",
    ...overrides,
  };
}

function authoringSession(input: {
  state: "recording" | "reviewing" | "committed" | "cancelled";
  updatedAt: number;
  actions?: Array<{ id: string; label?: string }>;
  revision?: number;
  replay?: { id: string; takeRevision: number; outcome: "passed" | "failed"; error?: string };
  committedConnectionId?: string;
}) {
  const revision = input.revision ?? 1;
  const actions = (input.actions ?? []).map((action, index) => ({
    id: action.id,
    source: "captured",
    recordedAt: 100 + index,
    startedAt: 100 + index,
    finishedAt: 101 + index,
    steps: [{ id: `step-${action.id}`, kind: "key", key: "back" }],
    evidenceIds: [`evidence-${action.id}`],
    ...(action.label ? { label: action.label } : {}),
  }));
  const replay = input.replay
    ? [
        {
          ...input.replay,
          takeId: "take-1",
          startedAt: input.updatedAt - 2,
          finishedAt: input.updatedAt - 1,
          evidence: [
            {
              id: `evidence-${input.replay.id}`,
              kind: "screenshot",
              capturedAt: input.updatedAt,
              uri: `relay://evidence/${input.replay.id}`,
            },
          ],
        },
      ]
    : [];
  return {
    schemaVersion: 1,
    id: "authoring-1",
    organizationId: "local",
    projectId: "default",
    actorId: "human:local",
    actorKind: "human",
    appMapId: "settings",
    state: input.state,
    target,
    leaseId: "lease-1",
    expectedAppMapRevision: 7,
    createdAt: 90,
    updatedAt: input.updatedAt,
    ...(input.committedConnectionId ? { committedConnectionId: input.committedConnectionId } : {}),
    take: {
      id: "take-1",
      state:
        input.state === "recording"
          ? "recording"
          : input.state === "committed"
            ? "committed"
            : input.state === "cancelled"
              ? "discarded"
              : "reviewing",
      createdAt: 90,
      updatedAt: input.updatedAt,
      currentRevision: revision,
      revisions: [
        {
          id: `take-1:revision:${revision}`,
          takeId: "take-1",
          revision,
          createdAt: input.updatedAt,
          createdBy: "human:local",
          reason: revision === 1 ? "recording" : "replace",
          actions,
          evidence: actions.map((action) => ({
            id: action.evidenceIds[0],
            kind: "screenshot",
            capturedAt: action.recordedAt,
            uri: `relay://evidence/${action.evidenceIds[0]}`,
          })),
        },
      ],
      replayAttempts: replay,
    },
  };
}

function authoringStep(
  id: ScriptedRelayStep["id"],
  session: ReturnType<typeof authoringSession>,
  checkInput?: (input: unknown) => void,
): ScriptedRelayStep {
  return { id, output: { session }, ...(checkInput ? { checkInput } : {}) };
}

test("authoring starts recording against one frozen App Map revision", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    authoringStep("authoring.session.begin", recording, (input) =>
      assert.deepEqual(input, {
        appMapId: "settings",
        target,
        leaseId: "lease-1",
        expectedAppMapRevision: 7,
        sourceScreenId: "home",
        group: "Settings",
      }),
    ),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(
    authorIntent({ revision: "current", sourceScreenId: "home", group: "Settings" }),
  );

  assert.equal(snapshot.kind, "author-test");
  assert.equal(snapshot.stage, "recording");
  assert.equal(snapshot.frozen?.appMapRevision, 7);
  assert.ok(snapshot.ref);
  assert.deepEqual(snapshot.allowedNextActions, [
    "inspect",
    "record",
    "checkpoint",
    "stop",
    "cancel",
  ]);
  assert.equal(scripted.remaining(), 0);
});

test("record, checkpoint, compile-review, replay proof, and approval compose canonical operations", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const withTap = authoringSession({
    state: "recording",
    updatedAt: 110,
    actions: [{ id: "tap-settings" }],
  });
  const withCheckpoint = authoringSession({
    state: "recording",
    updatedAt: 120,
    actions: [{ id: "tap-settings" }, { id: "checkpoint", label: "Data Controls" }],
  });
  const reviewing = authoringSession({
    state: "reviewing",
    updatedAt: 130,
    actions: [{ id: "tap-settings" }, { id: "checkpoint", label: "Data Controls" }],
    replay: { id: "live-demonstration", takeRevision: 1, outcome: "passed" },
  });
  const committed = authoringSession({
    state: "committed",
    updatedAt: 140,
    actions: [{ id: "tap-settings" }, { id: "checkpoint", label: "Data Controls" }],
    replay: { id: "live-demonstration", takeRevision: 1, outcome: "passed" },
    committedConnectionId: "connection-1",
  });
  const scripted = createScriptedRelayClient([
    authoringStep("authoring.session.begin", recording),
    authoringStep("authoring.session.get", recording),
    authoringStep("authoring.session.interact", withTap),
    authoringStep("authoring.session.get", withTap),
    authoringStep("authoring.session.interact", withCheckpoint, (input) =>
      assert.deepEqual(input, {
        sessionId: "authoring-1",
        interaction: { kind: "screenshot", label: "Data Controls" },
      }),
    ),
    authoringStep("authoring.session.get", withCheckpoint),
    authoringStep("authoring.session.stop", reviewing),
    authoringStep("authoring.session.get", reviewing),
    authoringStep("authoring.session.commit", committed),
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  let snapshot: AuthorTestSnapshot = await workflows.start(
    authorIntent({ revision: { exact: 7 } }),
  );
  assert.ok(snapshot.ref);

  snapshot = (await workflows.advance({
    action: "record",
    ref: snapshot.ref,
    expectedVersion: snapshot.version,
    interaction: { kind: "tap", target: { label: "Settings" } },
  })) as AuthorTestSnapshot;
  snapshot = (await workflows.advance({
    action: "checkpoint",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
    label: "Data Controls",
  })) as AuthorTestSnapshot;
  snapshot = (await workflows.advance({
    action: "stop",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
  })) as AuthorTestSnapshot;

  assert.equal(snapshot.stage, "reviewing");
  assert.equal(snapshot.review?.actionCount, 2);
  assert.equal(snapshot.review?.replayRequired, false);
  assert.ok(snapshot.allowedNextActions.includes("approve"));
  assert.deepEqual(snapshot.evidenceRefs.map(({ id }) => id).sort(), [
    "evidence-checkpoint",
    "evidence-live-demonstration",
    "evidence-tap-settings",
  ]);

  snapshot = (await workflows.advance({
    action: "approve",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
    destination: { kind: "new-screen", title: "Data Controls" },
  })) as AuthorTestSnapshot;
  assert.equal(snapshot.phase, "succeeded");
  assert.equal(snapshot.authoring?.committedConnectionId, "connection-1");
  assert.equal(scripted.remaining(), 0);
});

test("an edited review cannot be approved until its exact revision replays", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const reviewing = authoringSession({
    state: "reviewing",
    updatedAt: 110,
    actions: [{ id: "tap-settings" }],
    replay: { id: "live-demonstration", takeRevision: 1, outcome: "passed" },
  });
  const edited = authoringSession({
    state: "reviewing",
    updatedAt: 120,
    revision: 2,
    actions: [{ id: "tap-settings" }],
    replay: { id: "live-demonstration", takeRevision: 1, outcome: "passed" },
  });
  const replayed = authoringSession({
    state: "reviewing",
    updatedAt: 130,
    revision: 2,
    actions: [{ id: "tap-settings" }],
    replay: { id: "replay-2", takeRevision: 2, outcome: "passed" },
  });
  const scripted = createScriptedRelayClient([
    authoringStep("authoring.session.begin", recording),
    authoringStep("authoring.session.get", recording),
    authoringStep("authoring.session.stop", reviewing),
    authoringStep("authoring.session.get", reviewing),
    authoringStep("authoring.take.replace", edited),
    authoringStep("authoring.session.get", edited),
    authoringStep("authoring.session.get", edited),
    authoringStep("authoring.take.replay", replayed),
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  let snapshot = await workflows.start(authorIntent({ revision: { exact: 7 } }));
  snapshot = (await workflows.advance({
    action: "stop",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
  })) as AuthorTestSnapshot;
  snapshot = (await workflows.advance({
    action: "replace",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
    actionId: "tap-settings",
    interaction: { kind: "tap", target: { label: "Preferences" } },
  })) as AuthorTestSnapshot;

  assert.equal(snapshot.review?.replayRequired, true);
  assert.equal(snapshot.allowedNextActions.includes("approve"), false);
  const rejected = (await workflows.advance({
    action: "approve",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
  })) as AuthorTestSnapshot;
  assert.equal(rejected.problems.at(-1)?.code, "unexpected-authoring-state");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "authoring.session.commit").length,
    0,
  );

  snapshot = (await workflows.advance({
    action: "replay",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
  })) as AuthorTestSnapshot;
  assert.equal(snapshot.review?.replayRequired, false);
  assert.ok(snapshot.allowedNextActions.includes("approve"));
  assert.equal(scripted.remaining(), 0);
});

test("an uncertain authoring mutation is not retried and permits inspection only", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const canonicalAfterDispatch = authoringSession({
    state: "recording",
    updatedAt: 110,
    actions: [{ id: "back" }],
  });
  const scripted = createScriptedRelayClient([
    authoringStep("authoring.session.begin", recording),
    authoringStep("authoring.session.get", recording),
    { id: "authoring.session.interact", error: new Error("response lost after dispatch") },
    authoringStep("authoring.session.get", canonicalAfterDispatch),
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(authorIntent({ revision: { exact: 7 } }));
  const snapshot = (await workflows.advance({
    action: "record",
    ref: started.ref!,
    expectedVersion: started.version,
    interaction: { kind: "key", key: "back" },
  })) as AuthorTestSnapshot;

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
  assert.equal(snapshot.problems.at(-1)?.code, "mutation-outcome-unknown");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "authoring.session.interact").length,
    1,
  );
  assert.equal(scripted.remaining(), 1);

  const inspected = await workflows.inspect(started.ref!);
  assert.equal(inspected.kind, "author-test");
  assert.equal(inspected.kind === "author-test" ? inspected.review?.actionCount : undefined, 1);
  assert.equal(scripted.remaining(), 0);
});
