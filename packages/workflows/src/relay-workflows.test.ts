import assert from "node:assert/strict";
import test from "node:test";
import { createRelayWorkflows, type RunTestIntent } from "./index.js";
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
