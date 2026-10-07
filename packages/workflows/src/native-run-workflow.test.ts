import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionRisk } from "@relay/protocol";
import { createRelayWorkflows, type RunTestIntent } from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";

const target = { kind: "device", platform: "ios", targetId: "ipad" } as const;
const profiles = [
  { id: "old", targetId: "ipad", platform: "ios", viewport: { width: 834, height: 1112 } },
  { id: "current", targetId: "ipad", platform: "ios", viewport: { width: 1112, height: 834 } },
] as const;
const safe: ExecutionRisk = {
  schemaVersion: 1,
  level: "safe",
  reasons: [],
  externalEffects: [],
  confirmation: "none",
  expectedAppBoundaries: [],
  maximumActions: 1,
  maximumDurationMs: 1_000,
  cleanupRequired: false,
};
const selectionBlocker = {
  code: "raw-evidence-variant-selection-required",
  message: "Select a current runtime profile before proving this selector.",
};

function intent(overrides: Partial<RunTestIntent> = {}): RunTestIntent {
  return {
    kind: "run-test",
    appMapId: "settings",
    testId: "smoke",
    revision: { exact: 7 },
    target,
    workflowRequestId: "native-request",
    ...overrides,
  };
}

function compile(blockers = [selectionBlocker], executionRisk = safe): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: {
      plan: { rootRecipeId: "root", rawAccessibilityTargetProfiles: profiles },
      preflight: {
        schemaVersion: 1,
        mode: "offline-test-preflight",
        appMapId: "settings",
        appMapRevision: 7,
        testId: "smoke",
        planDigest: "preliminary-plan",
        executionRisk,
        summary: { blockers: blockers.length },
        findings: blockers.map((finding) => ({
          severity: "blocker",
          recipeId: "root",
          ...finding,
        })),
      },
    },
  };
}

function canonicalJob(
  input: {
    profile?: (typeof profiles)[number];
    targetId?: string;
    omitProfile?: boolean;
  } = {},
) {
  const profile = input.omitProfile ? undefined : (input.profile ?? profiles[1]);
  const plan = {
    appMapId: "settings",
    appMapRevision: 7,
    test: { id: "smoke" },
    rootRecipeId: "root",
    rawAccessibilityTargetProfiles: profiles,
    ...(profile ? { runtimeTargetProfile: profile } : {}),
  };
  const report = {
    schemaVersion: 1,
    mode: "offline-test-preflight",
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    planDigest: "canonical-plan",
    executionRisk: safe,
    summary: { blockers: 0 },
    findings: [],
  };
  return {
    id: "job-1",
    action: "app-map.test.run",
    status: "queued",
    queuedAt: 100,
    frameCount: 0,
    serial: input.targetId ?? target.targetId,
    platform: target.platform,
    artifacts: [
      {
        kind: "app-map-test-workflow-request",
        data: { schemaVersion: 1, requestId: "native-request" },
      },
      {
        kind: "app-map-test-execution-intent",
        data: {
          sourcePlan: {
            appMapId: "settings",
            appMapRevision: 7,
            testId: "smoke",
            rootRecipeId: "root",
            digest: "canonical-plan",
          },
          plan,
          ...(profile ? { selectedRuntimeTargetProfile: profile } : {}),
        },
      },
      { kind: "app-map-test-plan", data: plan },
      {
        kind: "app-map-test-preflight",
        data: {
          schemaVersion: 1,
          ...(profile ? { runtimeTargetProfile: profile } : {}),
          report,
        },
      },
    ],
  };
}

function run(job: unknown = canonicalJob()): ScriptedRelayStep {
  return {
    id: "app-map.test.run",
    output: {
      planIdentity: {
        appMapId: "settings",
        appMapRevision: 7,
        testId: "smoke",
        rootRecipeId: "root",
      },
      plan: { rootRecipeId: "root", runtimeTargetProfile: profiles[1] },
      job,
    },
  };
}

test("a provisional native profile-selection blocker reaches canonical Run without inventory or a chosen profile", async () => {
  const scripted = createScriptedRelayClient([compile(), run()]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.phase, "queued");
  assert.equal(snapshot.frozen?.targetProfileId, "current");
  assert.equal(snapshot.frozen?.planDigest, "canonical-plan");
  assert.equal(snapshot.compiled?.plan.runtimeTargetProfile?.id, "current");
  assert.equal(snapshot.compiled?.preflight.planDigest, "canonical-plan");
  assert.equal(snapshot.compiled?.preflight.summary.blockers, 0);
  assert.deepEqual(snapshot.compiled?.preflight.findings, []);
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "app-map.test.run"],
  );
  const input = scripted.invocations[1]?.input as Record<string, unknown>;
  assert.equal(input.targetProfileId, undefined);
  assert.equal(input.workflowRequestId, "native-request");
  assert.equal(scripted.remaining(), 0);
});

test("native profile deferral preserves unrelated blockers and explicit profile review", async () => {
  const unrelated = { code: "selector-absent", message: "The control is absent." };
  const mixed = createScriptedRelayClient([compile([selectionBlocker, unrelated])]);
  const blocked = await createRelayWorkflows(mixed.client).start(intent());
  assert.equal(blocked.phase, "blocked");
  assert.equal(blocked.problems[0]?.sourceCode, "selector-absent");
  assert.equal(blocked.problems[0]?.title, "The Test has 1 compile blocker");
  assert.deepEqual(
    mixed.invocations.map(({ id }) => id),
    ["app-map.test.compile"],
  );

  const explicit = createScriptedRelayClient([compile()]);
  const reviewed = await createRelayWorkflows(explicit.client).start(
    intent({ targetProfileId: "old" }),
  );
  assert.equal(reviewed.phase, "blocked");
  assert.equal(reviewed.problems[0]?.sourceCode, selectionBlocker.code);
  assert.deepEqual(
    explicit.invocations.map(({ id }) => id),
    ["app-map.test.compile"],
  );
});

test("native profile deferral preserves confirmation and prohibited-risk gates", async () => {
  for (const risk of [
    { ...safe, level: "guarded", confirmation: "once-per-run" },
    { ...safe, level: "prohibited", confirmation: "human-only" },
  ] as ExecutionRisk[]) {
    const scripted = createScriptedRelayClient([compile([selectionBlocker], risk)]);
    const snapshot = await createRelayWorkflows(scripted.client).start(intent());
    assert.equal(snapshot.phase, "blocked");
    assert.equal(
      snapshot.problems[0]?.code,
      risk.level === "prohibited" ? "compile-blocked" : "risk-confirmation-required",
    );
    assert.deepEqual(
      scripted.invocations.map(({ id }) => id),
      ["app-map.test.compile"],
    );
  }
});

test("deferred native selection cannot complete from a missing or unselected queued identity", async () => {
  for (const job of [
    { id: "job-1", action: "app-map.test.run", status: "queued", queuedAt: 100 },
    canonicalJob({ omitProfile: true }),
  ]) {
    const scripted = createScriptedRelayClient([compile(), run(job)]);
    const snapshot = await createRelayWorkflows(scripted.client).start(intent());
    assert.equal(snapshot.phase, "needs-attention");
    assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
    assert.equal(snapshot.frozen?.targetProfileId, undefined);
    assert.equal(snapshot.frozen?.planDigest, "preliminary-plan");
    assert.equal(snapshot.problems[0]?.retryable, false);
    assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  }
});

test("queued identities reject another physical target and an explicit profile mismatch", async () => {
  const foreign = createScriptedRelayClient([
    compile(),
    run(canonicalJob({ targetId: "other-ipad" })),
  ]);
  const wrongTarget = await createRelayWorkflows(foreign.client).start(intent());
  assert.equal(wrongTarget.phase, "needs-attention");
  assert.equal(wrongTarget.frozen?.targetProfileId, undefined);

  const explicit = createScriptedRelayClient([compile([]), run()]);
  const wrongProfile = await createRelayWorkflows(explicit.client).start(
    intent({ targetProfileId: "old" }),
  );
  assert.equal(wrongProfile.phase, "needs-attention");
  assert.equal(wrongProfile.frozen?.targetProfileId, "old");
  assert.equal(wrongProfile.frozen?.planDigest, "preliminary-plan");
});

test("native Run completion requires its matching canonical plan and unblocked preflight report", async () => {
  const missing = canonicalJob();
  missing.artifacts = missing.artifacts.filter(({ kind }) => kind !== "app-map-test-preflight");
  const mismatched = canonicalJob();
  const preflight = mismatched.artifacts.find(({ kind }) => kind === "app-map-test-preflight")!;
  (preflight.data as { report: { planDigest: string } }).report.planDigest = "another-plan";
  for (const job of [missing, mismatched]) {
    const scripted = createScriptedRelayClient([compile(), run(job)]);
    const snapshot = await createRelayWorkflows(scripted.client).start(intent());
    assert.equal(snapshot.phase, "needs-attention");
    assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
    assert.equal(snapshot.frozen?.targetProfileId, undefined);
    assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  }
});

test("lost native Run response recovers its actual profile and digest using the stable request", async () => {
  const canonical = canonicalJob();
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "app-map.test.run", error: new Error("response lost after dispatch") },
    { id: "job.list", output: { jobs: [canonical] } },
    { id: "job.get", output: { job: canonical } },
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const uncertain = await workflows.start(intent());
  assert.equal(uncertain.phase, "needs-attention");
  assert.equal(uncertain.frozen?.planDigest, "preliminary-plan");

  const recovered = await workflows.recover({
    kind: "run-test",
    frozen: uncertain.frozen!,
    startedAfter: 99,
  });
  assert.equal(recovered.phase, "queued");
  assert.equal(recovered.frozen?.targetProfileId, "current");
  assert.equal(recovered.frozen?.planDigest, "canonical-plan");
  assert.equal(recovered.frozen?.rootRecipeId, "root");
  assert.equal(recovered.compiled?.preflight.planDigest, "canonical-plan");
  assert.equal(recovered.compiled?.preflight.summary.blockers, 0);
  assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.equal(scripted.remaining(), 0);
});

test("an existing durable native Run returns its canonical report without another dispatch", async () => {
  const frozen = {
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    rootRecipeId: "root",
    planDigest: "canonical-plan",
    targetProfileId: "current",
    workflowRequestId: "native-request",
    target,
  };
  const workflow = {
    record: {
      schemaVersion: 1,
      workflowId: "workflow-1",
      organizationId: "local",
      projectId: "default",
      kind: "run-test",
      version: 2,
      status: "active",
      frozenIdentity: frozen,
      resource: { kind: "job", id: "job-1" },
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: 2,
      expiresAt: 100_000,
      lastTransition: "run-attached",
    },
    audit: [],
  };
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "workflow.create", output: { disposition: "existing", workflow } },
    { id: "workflow.get", output: { workflow, job: canonicalJob() } },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ continuation: "durable" }),
  );

  assert.equal(snapshot.phase, "queued");
  assert.equal(snapshot.compiled?.plan.runtimeTargetProfile?.id, "current");
  assert.equal(snapshot.compiled?.preflight.planDigest, snapshot.frozen?.planDigest);
  assert.equal(snapshot.compiled?.preflight.summary.blockers, 0);
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.test.compile", "workflow.create", "workflow.get"],
  );
});

test("unavailable canonical viewport has reconnect guidance after durable reservation is abandoned", async () => {
  const frozen = {
    appMapId: "settings",
    appMapRevision: 7,
    testId: "smoke",
    planDigest: "preliminary-plan",
    workflowRequestId: "native-request",
    target,
  };
  const record = {
    schemaVersion: 1,
    workflowId: "workflow-1",
    organizationId: "local",
    projectId: "default",
    kind: "run-test",
    version: 1,
    status: "active",
    frozenIdentity: frozen,
    createdBy: "agent:test",
    lastActorId: "agent:test",
    createdAt: 1,
    updatedAt: 1,
    expiresAt: 100_000,
    lastTransition: "created",
  };
  const scripted = createScriptedRelayClient([
    compile(),
    { id: "workflow.create", output: { disposition: "created", workflow: { record, audit: [] } } },
    {
      id: "app-map.test.run",
      error: Object.assign(new Error("device:ipad-profile raw error"), {
        status: 409,
        body: { details: { code: "TARGET_VIEWPORT_UNAVAILABLE" } },
      }),
    },
    {
      id: "workflow.transition",
      output: {
        workflow: {
          record: {
            ...record,
            version: 2,
            status: "terminal",
            lastTransition: "run-abandoned",
            resolution: { kind: "abandoned", reason: "Screen size unavailable", at: 2 },
          },
          audit: [],
        },
      },
    },
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ continuation: "durable" }),
  );
  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.title, "Relay couldn’t check this device’s screen size");
  assert.match(snapshot.problems[0]?.recovery ?? "", /Reconnect.*choose a saved setup/u);
  assert.match(snapshot.problems[0]?.recovery ?? "", /Devices.*Run settings.*start a new Run/u);
  assert.equal(snapshot.problems[0]?.sourceCode, "TARGET_VIEWPORT_UNAVAILABLE");
  assert.equal(JSON.stringify(snapshot.problems).includes("device:ipad-profile"), false);
  assert.deepEqual(snapshot.workflow, { workflowId: "workflow-1", expectedVersion: 2 });
});
