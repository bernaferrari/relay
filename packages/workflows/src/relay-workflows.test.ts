import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRisk } from "@relay/protocol";
import {
  createRelayWorkflows,
  type AuthorTestIntent,
  type AuthorTestSnapshot,
  type RunTestIntent,
} from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";
import { parseCanonicalJob } from "./job-projection.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const browserTarget = { kind: "browser", platform: "browser", targetId: "browser-golden" } as const;
const browserCaseProfile = {
  schemaVersion: 1 as const,
  engine: "chromium" as const,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  mobile: false,
  touch: false,
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light" as const,
  reducedMotion: "no-preference" as const,
  permissions: [],
  offline: false,
  environmentRevision: "relay.browser-environment.v1",
};

function browserProfile(id = "browser-profile-1") {
  return {
    id,
    targetId: browserTarget.targetId,
    platform: "browser" as const,
    viewport: browserCaseProfile.viewport,
    browserCaseProfile,
  };
}

const registeredBrowserTarget = {
  id: browserTarget.targetId,
  name: "Golden browser",
  kind: "browser" as const,
  createdAt: 1,
  updatedAt: 1,
  browser: {
    startUrl: "http://127.0.0.1:1234",
    environment: browserCaseProfile,
  },
};

function intent(overrides: Partial<RunTestIntent> = {}): RunTestIntent {
  return {
    kind: "run-test",
    appMapId: "settings",
    testId: "data-controls",
    target,
    ...overrides,
  };
}

function preflight(
  revision: number,
  blockers: Array<{ code: string; message: string }> = [],
  executionRisk: ExecutionRisk = {
    schemaVersion: 1 as const,
    level: "safe" as const,
    reasons: [],
    externalEffects: [],
    confirmation: "none" as const,
    expectedAppBoundaries: [],
    maximumActions: 0,
    maximumDurationMs: 0,
    cleanupRequired: false,
  },
) {
  return {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "settings",
    appMapRevision: revision,
    testId: "data-controls",
    planDigest: `plan-${revision}`,
    executionRisk,
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
  executionRisk?: Parameters<typeof preflight>[2],
  startup: { mode: "warm" | "cold" } = { mode: "warm" },
): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: {
      plan: { rootRecipeId: "open-settings", startup },
      preflight: preflight(revision, blockers, executionRisk),
    },
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

function runStep(
  revision: number,
  status = "queued",
  startup: { mode: "warm" | "cold" } = { mode: "warm" },
): ScriptedRelayStep {
  return {
    id: "app-map.test.run",
    output: {
      planIdentity: {
        appMapId: "settings",
        appMapRevision: revision,
        testId: "data-controls",
        rootRecipeId: "open-settings",
      },
      plan: { rootRecipeId: "open-settings", startup },
      job: job(status),
    },
  };
}

function browserCompileStep(profiles: ReturnType<typeof browserProfile>[]): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: {
      plan: { rootRecipeId: "open-settings", rawAccessibilityTargetProfiles: profiles },
      preflight: preflight(7),
    },
  };
}

function deviceCompileStep(selectedProfileId?: string): ScriptedRelayStep {
  const profiles = ["device:pixel-9-old", "device:pixel-9-current"].map((id) => ({
    id,
    targetId: target.targetId,
    platform: target.platform,
    viewport: { width: 1080, height: 2400 },
    capabilities: [],
  }));
  return {
    id: "app-map.test.compile",
    output: {
      plan: {
        rootRecipeId: "open-settings",
        rawAccessibilityTargetProfiles: profiles,
        rawAccessibilityVariantsByScreenId: {
          "screen-current": [
            {
              id: "variant-current",
              targetProfileId: "device:pixel-9-current",
              targetId: target.targetId,
              platform: target.platform,
              viewport: { width: 1080, height: 2400 },
              capabilities: [],
            },
          ],
        },
        recipes: {
          "open-settings": {
            id: "open-settings",
            title: "Open Settings",
            parameters: [],
            steps: [
              {
                id: "expect-current",
                kind: "expect-screen",
                screenId: "screen-current",
                screenTitle: "Settings",
                fingerprint: "fingerprint-current",
                timeoutMs: 5_000,
              },
            ],
          },
        },
      },
      preflight: preflight(7),
    },
    ...(selectedProfileId
      ? {
          checkInput(input: unknown) {
            assert.equal(
              (input as { targetProfileId?: string }).targetProfileId,
              selectedProfileId,
            );
          },
        }
      : {}),
  };
}

test("automatically binds the device profile referenced by the reviewed Test", async () => {
  const scripted = createScriptedRelayClient([
    deviceCompileStep(),
    deviceCompileStep("device:pixel-9-current"),
    runStep(7),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ revision: { exact: 7 } }));

  assert.equal(snapshot.phase, "queued");
  assert.equal(snapshot.frozen?.targetProfileId, "device:pixel-9-current");
  const runInvocation = scripted.invocations.find(({ id }) => id === "app-map.test.run");
  assert.ok(runInvocation);
  assert.equal(
    (runInvocation.input as { targetProfileId?: string }).targetProfileId,
    "device:pixel-9-current",
  );
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "app-map.test.compile", "app-map.test.run"],
  );
});

test("Member v7 cannot enqueue a Test against a saved Member v4 profile", async () => {
  const savedV4 = {
    ...browserCaseProfile,
    authenticationFixtureId: "authfx:member:4",
  };
  const scripted = createScriptedRelayClient([
    {
      id: "app-map.test.compile",
      output: {
        plan: {
          rootRecipeId: "open-settings",
          rawAccessibilityTargetProfiles: [
            {
              id: "browser-profile-1",
              targetId: browserTarget.targetId,
              platform: "browser",
              viewport: savedV4.viewport,
              browserCaseProfile: savedV4,
            },
          ],
        },
        preflight: preflight(7),
      },
    },
    { id: "target.browser-auth.list", output: { fixtures: [] } },
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({
      target: browserTarget,
      revision: { exact: 7 },
      targetProfileId: "browser-profile-1",
      engine: "chromium",
      account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
    }),
  );
  assert.equal(snapshot.phase, "blocked");
  assert.match(snapshot.problems[0]?.detail ?? "", /revision 7.*revision 4/i);
  assert.equal(
    scripted.invocations.some(({ id }) => id === "app-map.test.run"),
    false,
  );
});

test("automatically binds the unique browser profile matching the registered environment", async () => {
  const scripted = createScriptedRelayClient([
    browserCompileStep([browserProfile()]),
    { id: "target.list", output: { targets: [registeredBrowserTarget] } },
    browserCompileStep([browserProfile()]),
    runStep(7),
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const snapshot = await workflows.start(intent({ target: browserTarget, revision: { exact: 7 } }));

  assert.equal(snapshot.phase, "queued");
  assert.equal(snapshot.frozen?.targetProfileId, "browser-profile-1");
  const runInvocation = scripted.invocations.find(({ id }) => id === "app-map.test.run");
  assert.ok(runInvocation);
  assert.equal(
    (runInvocation.input as { targetProfileId?: string }).targetProfileId,
    "browser-profile-1",
  );
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "target.list", "app-map.test.compile", "app-map.test.run"],
  );
});

for (const [label, profiles] of [
  ["no matching", []],
  ["ambiguous", [browserProfile("browser-profile-1"), browserProfile("browser-profile-2")]],
] as const) {
  test(`browser target profile selection fails closed when ${label}`, async () => {
    const scripted = createScriptedRelayClient([
      browserCompileStep([...profiles]),
      { id: "target.list", output: { targets: [registeredBrowserTarget] } },
    ]);
    const workflows = createRelayWorkflows(scripted.client);

    const snapshot = await workflows.start(
      intent({
        target: browserTarget,
        revision: { exact: 7 },
        continuation: "durable",
        workflowRequestId: "browser-profile-selection",
      }),
    );

    assert.equal(snapshot.phase, "blocked");
    assert.equal(snapshot.problems[0]?.code, "compile-blocked");
    assert.equal(snapshot.problems[0]?.sourceCode, "browser-target-profile-selection-required");
    assert.equal(
      scripted.invocations.some(({ id }) => id === "workflow.create"),
      false,
    );
    assert.equal(
      scripted.invocations.some(({ id }) => id === "app-map.test.run"),
      false,
    );
  });
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
      startup: { mode: "cold" },
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
  assert.deepEqual(scripted.invocations[1]?.input, {
    appMapId: "settings",
    testId: "data-controls",
    startupMode: "cold",
    forceRecaptureScreenIds: ["data-controls"],
  });
  assert.deepEqual(scripted.invocations[2]?.input, {
    appMapId: "settings",
    testId: "data-controls",
    expectedRevision: 7,
    target,
    startup: { mode: "cold" },
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

test("risk preflight is conditional and always runs before the exact-once mutation", async () => {
  const guarded = {
    schemaVersion: 1 as const,
    level: "guarded" as const,
    reasons: [{ code: "reviewed-effect.external-app", explanation: "The Test opens another app." }],
    externalEffects: ["external-app" as const],
    confirmation: "once-per-run" as const,
    expectedAppBoundaries: ["external-app"],
    maximumActions: 1,
    maximumDurationMs: 0,
    cleanupRequired: false,
  };
  const blockedClient = createScriptedRelayClient([compileStep(4, [], guarded)]);
  const blocked = await createRelayWorkflows(blockedClient.client).start(
    intent({ revision: { exact: 4 } }),
  );
  assert.equal(blocked.problems[0]?.code, "risk-confirmation-required");
  assert.deepEqual(
    blockedClient.invocations.map(({ id }) => id),
    ["app-map.test.compile"],
  );

  const confirmedClient = createScriptedRelayClient([compileStep(4, [], guarded), runStep(4)]);
  const confirmed = await createRelayWorkflows(confirmedClient.client).start(
    intent({ revision: { exact: 4 }, confirmRisk: true }),
  );
  assert.equal(confirmed.phase, "queued");
  assert.deepEqual(
    confirmedClient.invocations.map(({ id }) => id),
    ["app-map.test.compile", "app-map.test.run"],
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

test("projects authored Test progress instead of counting internal trace steps", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(5),
    runStep(5),
    {
      id: "job.get",
      output: {
        job: job("running", {
          steps: [
            { recipeStepId: "relay-test-step-a-1", status: "ok" },
            { recipeStepId: "relay-test-step-a-2", status: "ok" },
            { recipeStepId: "relay-test-step-b-1", status: "running" },
          ],
          artifacts: [{ kind: "campaign-check-result", data: { id: "a", status: "passed" } }],
          recipeSnapshot: {
            steps: [
              { kind: "module", id: "relay-test-step-a-1", check: { id: "a", title: "Observe" } },
              { kind: "screenshot", id: "relay-test-step-a-2" },
              {
                kind: "module",
                id: "relay-test-step-b-1",
                check: { id: "b", title: "Tap Network" },
              },
              { kind: "screenshot", id: "relay-test-step-b-2" },
              { kind: "sleep", id: "internal" },
            ],
          },
        }),
      },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 5 } }));
  assert.ok(started.ref);
  const snapshot = await workflows.inspect(started.ref);
  assert.deepEqual(snapshot.progress, {
    label: "Running test · Tap Network",
    completed: 1,
    total: 2,
  });
});

test("rejects malformed nested progress metadata without throwing", () => {
  assert.equal(parseCanonicalJob({ ...job("running"), recipeSnapshot: null }), undefined);
  assert.equal(
    parseCanonicalJob({
      ...job("running"),
      recipeSnapshot: { steps: [{ kind: "module", check: null }] },
    }),
    undefined,
  );
});

test("uses the canonical job id as the Run id when the adapter omits a redundant runId", async () => {
  const scripted = createScriptedRelayClient([
    compileStep(5),
    runStep(5),
    {
      id: "job.get",
      output: { job: job("ok", { startedAt: 110, finishedAt: 140 }) },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 5 } }));
  assert.ok(started.ref);

  const snapshot = await workflows.inspect(started.ref);

  assert.equal(snapshot.kind, "run-test");
  if (snapshot.kind !== "run-test") throw new Error("Expected a Run snapshot");
  assert.deepEqual(snapshot.execution, { jobId: "job-1", runId: "job-1" });
  assert.deepEqual(snapshot.evidenceRefs, [{ kind: "run", id: "job-1" }]);
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

test("an authoritative 4xx Run rejection is terminal to the attempt, not mutation-unknown", async () => {
  const rejection = Object.assign(new Error("TARGET_PROFILE_SELECTION_REQUIRED"), { status: 409 });
  const scripted = createScriptedRelayClient([
    compileStep(3),
    { id: "app-map.test.run", error: rejection },
    runStep(3),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ revision: { exact: 3 } }),
  );

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "operation-unavailable");
  assert.equal(snapshot.problems[0]?.retryable, false);
  assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.equal(scripted.remaining(), 1);
});

test("an uncertain Run is recovered from its immutable execution intent", async () => {
  const canonical = job("running", {
    action: "open-settings",
    serial: "pixel-9",
    platform: "android",
    artifacts: [
      {
        kind: "app-map-test-execution-intent",
        data: {
          sourcePlan: {
            appMapId: "settings",
            appMapRevision: 3,
            testId: "data-controls",
            rootRecipeId: "open-settings",
            digest: "plan-3",
          },
        },
      },
    ],
  });
  const scripted = createScriptedRelayClient([
    { id: "job.list", output: { jobs: [{ ...canonical, frameCount: 0 }] } },
    { id: "job.get", output: { job: canonical } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).recover({
    kind: "run-test",
    startedAfter: 99,
    frozen: {
      appMapId: "settings",
      appMapRevision: 3,
      testId: "data-controls",
      planDigest: "plan-3",
      target,
    },
  });

  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.execution?.jobId, "job-1");
  assert.equal(snapshot.frozen?.rootRecipeId, "open-settings");
  assert.ok(snapshot.ref);
  assert.equal(scripted.remaining(), 0);
});

test("fresh-capture recovery adopts by its pre-dispatch request identity", async () => {
  const requestId = "workflow-request-1";
  const canonical = job("running", {
    action: "recaptured-root",
    serial: "pixel-9",
    platform: "android",
    artifacts: [
      {
        kind: "app-map-test-workflow-request",
        data: { schemaVersion: 1, requestId },
      },
      {
        kind: "app-map-test-execution-intent",
        data: {
          sourcePlan: {
            appMapId: "settings",
            appMapRevision: 3,
            testId: "data-controls",
            rootRecipeId: "recaptured-root",
            digest: "server-recapture-digest",
          },
        },
      },
    ],
  });
  const scripted = createScriptedRelayClient([
    compileStep(3),
    { id: "app-map.test.run", error: new Error("response lost after dispatch") },
    { id: "job.list", output: { jobs: [{ ...canonical, frameCount: 0 }] } },
    { id: "job.get", output: { job: canonical } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const uncertain = await workflows.start(
    intent({
      revision: { exact: 3 },
      workflowRequestId: requestId,
      capture: { fullSurfaceScreenIds: ["data-controls"] },
    }),
  );
  assert.equal(uncertain.phase, "needs-attention");
  assert.equal(uncertain.frozen?.workflowRequestId, requestId);
  assert.deepEqual(scripted.invocations[0]?.input, {
    appMapId: "settings",
    testId: "data-controls",
    forceRecaptureScreenIds: ["data-controls"],
  });

  const recovered = await workflows.recover({
    kind: "run-test",
    frozen: uncertain.frozen!,
    startedAfter: 99,
  });
  assert.equal(recovered.phase, "running");
  assert.equal(recovered.frozen?.rootRecipeId, "recaptured-root");
  assert.equal(scripted.remaining(), 0);
});

function authorIntent(overrides: Partial<AuthorTestIntent> = {}): AuthorTestIntent {
  return {
    kind: "author-test",
    actorId: "human:local",
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
  committedTestId?: string;
  actorId?: string;
  sourceScreenId?: string;
  pendingConnectionId?: string;
  group?: string;
  testName?: string;
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
    actorId: input.actorId ?? "human:local",
    actorKind: "human",
    appMapId: "settings",
    testName: input.testName ?? "Data Controls path",
    ...(input.sourceScreenId ? { sourceScreenId: input.sourceScreenId } : {}),
    ...(input.pendingConnectionId ? { pendingConnectionId: input.pendingConnectionId } : {}),
    ...(input.group ? { group: input.group } : {}),
    state: input.state,
    target,
    leaseId: "lease-1",
    expectedAppMapRevision: 7,
    createdAt: 90,
    updatedAt: input.updatedAt,
    ...(input.committedConnectionId ? { committedConnectionId: input.committedConnectionId } : {}),
    ...(input.committedTestId ? { committedTestId: input.committedTestId } : {}),
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
  const recording = authoringSession({
    state: "recording",
    updatedAt: 100,
    sourceScreenId: "home",
    group: "Settings",
  });
  const scripted = createScriptedRelayClient([
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    authoringStep("authoring.session.begin", recording, (input) =>
      assert.deepEqual(input, {
        appMapId: "settings",
        testName: "Data Controls path",
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

test("a lost begin response adopts the one matching canonical recording session", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const scripted = createScriptedRelayClient([
    { id: "authoring.session.begin", error: new Error("response lost after dispatch") },
    { id: "authoring.session.list", output: { sessions: [recording] } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const recovered = await workflows.start(authorIntent({ revision: { exact: 7 } }));

  assert.equal(recovered.stage, "recording");
  assert.equal(recovered.phase, "running");
  assert.equal(recovered.title, "Data Controls path");
  assert.ok(recovered.ref);
  assert.equal(scripted.invocations.filter(({ id }) => id === "authoring.session.begin").length, 1);
  assert.equal(scripted.remaining(), 0);
});

test("a lost begin response never adopts another actor or authoring path", async () => {
  const otherActor = authoringSession({
    state: "recording",
    updatedAt: 100,
    actorId: "agent:other",
  });
  const otherPath = authoringSession({
    state: "recording",
    updatedAt: 101,
    testName: "Another path",
  });
  const scripted = createScriptedRelayClient([
    { id: "authoring.session.begin", error: new Error("response lost after dispatch") },
    { id: "authoring.session.list", output: { sessions: [otherActor, otherPath] } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(
    authorIntent({ revision: { exact: 7 } }),
  );

  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.ref, undefined);
  assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
  assert.equal(scripted.remaining(), 0);
});

test("authoring recovery reconstructs an opaque reference from canonical state", async () => {
  const recording = authoringSession({ state: "recording", updatedAt: 100 });
  const scripted = createScriptedRelayClient([authoringStep("authoring.session.get", recording)]);
  const workflows = createRelayWorkflows(scripted.client);

  const recovered = await workflows.recover({
    kind: "author-test",
    sessionId: "authoring-1",
  });

  assert.equal(recovered.stage, "recording");
  assert.ok(recovered.ref);
  assert.equal(recovered.authoring?.sessionId, "authoring-1");
  assert.equal(recovered.title, "Data Controls path");
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
    committedTestId: "test-authoring-1",
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
    authoringStep("authoring.session.commit", committed, (input) =>
      assert.deepEqual(input, {
        sessionId: "authoring-1",
        destination: { kind: "new-screen", title: "Data Controls" },
        createTest: true,
      }),
    ),
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
  assert.deepEqual(
    snapshot.review?.actions.map(({ id, intent }) => ({ id, intent })),
    [
      { id: "tap-settings", intent: "Press back" },
      { id: "checkpoint", intent: "Data Controls" },
    ],
  );
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
  assert.equal(snapshot.authoring?.committedTestId, "test-authoring-1");
  assert.equal(scripted.remaining(), 0);
});

test("a committed recording without its generated Test fails closed", async () => {
  const incomplete = authoringSession({
    state: "committed",
    updatedAt: 140,
    actions: [{ id: "tap-settings" }],
    replay: { id: "live-demonstration", takeRevision: 1, outcome: "passed" },
    committedConnectionId: "connection-1",
  });
  const scripted = createScriptedRelayClient([authoringStep("authoring.session.get", incomplete)]);

  const snapshot = await createRelayWorkflows(scripted.client).recover({
    kind: "author-test",
    sessionId: "authoring-1",
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.authoring?.committedConnectionId, "connection-1");
  assert.equal(snapshot.authoring?.committedTestId, undefined);
  assert.equal(snapshot.problems[0]?.code, "malformed-response");
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
    authoringStep("authoring.take.edit", edited),
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
    action: "edit",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
    edit: {
      kind: "replace",
      actionId: "tap-settings",
      interaction: { kind: "tap", target: { label: "Preferences" } },
    },
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
  assert.equal(inspected.title, "Data Controls path");
  assert.equal(inspected.kind === "author-test" ? inspected.review?.actionCount : undefined, 1);
  assert.equal(scripted.remaining(), 0);
});
