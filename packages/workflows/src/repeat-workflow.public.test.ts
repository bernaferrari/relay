import assert from "node:assert/strict";
import test from "node:test";
import type {
  CombineCampaign,
  DurableWorkflowRead,
  ExecutionRisk,
  RepeatSpec,
} from "@relay/protocol";
import { createRelayWorkflows, type RepeatTestIntent } from "./index.js";
import { createScriptedRelayClient, type ScriptedRelayStep } from "./testing.js";

const target = { kind: "device", platform: "android", targetId: "pixel-9" } as const;
const values = ["en", "it", "fr"] as const;
const resultIds = ["result-en", "result-it", "result-fr"] as const;
const repeat: RepeatSpec = {
  dimensions: [{ id: "language", values: [...values] }],
  strategy: "zip",
  pilot: { mode: "representative" },
  resume: "untouched",
};

function intent(overrides: Partial<RepeatTestIntent> = {}): RepeatTestIntent {
  return {
    kind: "repeat-test",
    appMapId: "settings",
    testId: "data-controls",
    target,
    repeat,
    ...overrides,
  };
}

function mapStep(revision = 7): ScriptedRelayStep {
  return {
    id: "app-map.get",
    output: {
      appMap: {
        revision,
        variables: {
          language: {
            id: "language",
            name: "Language",
            kind: "language",
            apply: { kind: "appLocale", app: "com.example.app" },
            options: values.map((id) => ({ id })),
          },
        },
      },
    },
  };
}

function preflight(
  revision = 7,
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
      resolvedSelectors: 1,
      unknownCursorTransitions: 0,
      reviewRequiredReturns: 0,
      blockers: 0,
      warnings: 0,
    },
    selectors: [],
    cursorTimeline: [],
    returns: [],
    findings: [],
  };
}

function compileStep(
  revision = 7,
  executionRisk?: Parameters<typeof preflight>[1],
): ScriptedRelayStep {
  return {
    id: "app-map.test.compile",
    output: { plan: { rootRecipeId: "base-test" }, preflight: preflight(revision, executionRisk) },
  };
}

function job(id = "pilot-job") {
  return { id, action: "app-map.test.run", status: "queued", queuedAt: 100 };
}

function runStep(checkInput?: (input: unknown) => void): ScriptedRelayStep {
  return {
    id: "app-map.test.run",
    checkInput,
    output: {
      planIdentity: {
        appMapId: "settings",
        appMapRevision: 8,
        testId: "data-controls",
        rootRecipeId: "repeat-root",
      },
      plan: { rootRecipeId: "repeat-root" },
      job: job(),
      jobs: [job()],
      combine: { id: "generated-repeat", revision: 8 },
      campaign: { id: "repeat-1", selectedCellIds: resultIds },
    },
  };
}

type ResultStatus =
  | "pending"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";
type RepeatStatus =
  | "pilot-running"
  | "ready-to-resume"
  | "needs-review"
  | "running"
  | "completed"
  | "completed-with-problems"
  | "cancelled";

function durableResult(input: {
  id: string;
  value: string;
  index: number;
  phase: "pilot" | "coverage";
  status: ResultStatus;
  selected?: boolean;
}) {
  const terminal =
    input.status === "passed" ||
    input.status === "failed" ||
    input.status === "blocked" ||
    input.status === "cancelled";
  return {
    index: input.index,
    cellId: input.id,
    testId: "data-controls",
    world: `language=${input.value}`,
    values: { language: input.value },
    targetProfileId: "pixel-profile",
    childIntentDigest: `child-${input.value}`,
    outerIntentDigest: `outer-${input.value}`,
    wrapperGraphDigest: `wrapper-${input.value}`,
    staticInputDigest: `input-${input.value}`,
    phase: input.phase,
    status: input.status,
    ...(input.phase === "pilot"
      ? {
          jobId: "pilot-job",
        }
      : {}),
    ...(terminal ? { runId: input.phase === "pilot" ? "pilot-run" : `${input.id}-run` } : {}),
  };
}

function durableRepeat(input: {
  status: RepeatStatus;
  pilot: ResultStatus;
  remaining: ResultStatus;
  updatedAt?: number;
  sourceRevision?: number;
  includeExtra?: boolean;
}): CombineCampaign {
  return {
    schemaVersion: 1,
    id: "repeat-1",
    projectId: "default",
    appMapId: "settings",
    combineId: "generated-repeat",
    sourceRevision: input.sourceRevision ?? 8,
    latestRevision: input.sourceRevision ?? 8,
    target: { kind: "device", id: "pixel-9", platform: "android" },
    status: input.status,
    createdAt: 100,
    updatedAt: input.updatedAt ?? 110,
    cases: [
      durableResult({
        id: "result-en",
        value: "en",
        index: 0,
        phase: "pilot",
        status: input.pilot,
      }),
      durableResult({
        id: "result-it",
        value: "it",
        index: 1,
        phase: "coverage",
        status: input.remaining,
      }),
      durableResult({
        id: "result-fr",
        value: "fr",
        index: 2,
        phase: "coverage",
        status: input.remaining,
      }),
      ...(input.includeExtra
        ? [
            durableResult({
              id: "result-de",
              value: "de",
              index: 3,
              phase: "coverage",
              status: "failed",
            }),
          ]
        : []),
    ],
    lineage: [{ kind: "created", at: 100, appMapRevision: 8 }],
    execution: {
      selected: { language: [...values] },
      selectedCellIds: [...resultIds],
      strategy: "zip",
      seed: 1,
      repeat: {
        schemaVersion: 1,
        requestedAppMapRevision: 7,
        executionAppMapRevision: input.sourceRevision ?? 8,
        testId: "data-controls",
        testPlanDigest: "plan-7",
        rootRecipeId: "repeat-root",
        target,
        spec: structuredClone(repeat),
        resolved: {
          dimensions: [{ id: "language", valueIds: [...values] }],
          strategy: "zip",
          pilot: { mode: "representative" },
          resume: "untouched",
        },
        evidence: "visual",
        pilotJobId: "pilot-job",
        selectedCaseIds: [...resultIds],
      },
    },
  };
}

function inspectStep(record: ReturnType<typeof durableRepeat>): ScriptedRelayStep {
  return { id: "job.combine.campaign.get", output: { campaign: record } };
}

function recoverableRepeat() {
  const record = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  record.execution!.repeat = {
    schemaVersion: 1,
    requestedAppMapRevision: 7,
    executionAppMapRevision: 8,
    testId: "data-controls",
    testPlanDigest: "plan-7",
    rootRecipeId: "repeat-root",
    target,
    spec: structuredClone(repeat),
    resolved: {
      dimensions: [{ id: "language", valueIds: [...values] }],
      strategy: "zip",
      pilot: { mode: "representative" },
      resume: "untouched",
    },
    evidence: "visual",
    sourceRevision: { vcs: "git", sha: "abc1234" },
    capture: { fullSurfaceScreenIds: ["data-controls"] },
    pilotJobId: "pilot-job",
    selectedCaseIds: [...resultIds],
  };
  return record;
}

function adoptedRepeatWorkflow(
  record: CombineCampaign,
  version = 1,
  transition = "legacy-v1-adopted",
  status: DurableWorkflowRead["record"]["status"] = "active",
): DurableWorkflowRead {
  const identity = record.execution!.repeat!;
  return {
    record: {
      schemaVersion: 1,
      workflowId: "adopted-repeat",
      organizationId: "local",
      projectId: "default",
      kind: "repeat-test",
      version,
      status,
      frozenIdentity: {
        actorId: "agent:test",
        appMapId: record.appMapId,
        requestedAppMapRevision: identity.requestedAppMapRevision,
        executionAppMapRevision: identity.executionAppMapRevision,
        testId: identity.testId,
        testPlanDigest: identity.testPlanDigest,
        rootRecipeId: identity.rootRecipeId,
        target: identity.target,
        repeat: identity.spec,
        resolved: identity.resolved,
        evidence: identity.evidence,
        ...(identity.sourceRevision ? { sourceRevision: identity.sourceRevision } : {}),
        ...(identity.capture ? { capture: identity.capture } : {}),
      },
      resource: { kind: "campaign", id: record.id },
      createdBy: "agent:test",
      lastActorId: "agent:test",
      createdAt: 1,
      updatedAt: version,
      expiresAt: 100_000,
      lastTransition: transition,
      adoptedLegacyRefDigest: "sha256:legacy",
    },
    audit: [],
  };
}

function adoptionStep(record: CombineCampaign): ScriptedRelayStep {
  return {
    id: "workflow.create",
    checkInput: (input) => {
      assert.equal(typeof (input as { legacyRef?: unknown }).legacyRef, "string");
      assert.deepEqual(Object.keys(input as object), ["legacyRef"]);
    },
    output: {
      disposition: "created",
      workflow: adoptedRepeatWorkflow(record),
      campaign: record,
    },
  };
}

function reservedRepeatStep(
  record: CombineCampaign,
  action: "repeat-resume" | "repeat-cancel",
  reviewed = false,
): ScriptedRelayStep {
  return {
    id: "workflow.transition",
    checkInput: (input) =>
      assert.deepEqual(input, {
        workflowId: "adopted-repeat",
        expectedVersion: 1,
        action: action === "repeat-resume" ? "reserve-repeat-resume" : "reserve-repeat-cancel",
        ...(reviewed ? { reviewed: true } : {}),
      }),
    output: {
      workflow: adoptedRepeatWorkflow(record, 2, `${action}-requested`),
      campaign: record,
    },
  };
}

function completedRepeatStep(
  record: CombineCampaign,
  action: "repeat-resume" | "repeat-cancel",
): ScriptedRelayStep {
  return {
    id: "workflow.transition",
    checkInput: (input) =>
      assert.deepEqual(input, {
        workflowId: "adopted-repeat",
        expectedVersion: 2,
        action: action === "repeat-resume" ? "complete-repeat-resume" : "complete-repeat-cancel",
      }),
    output: {
      workflow: adoptedRepeatWorkflow(record, 3, `${action}-reconciled`),
      campaign: record,
    },
  };
}

async function startReadyRef() {
  const record = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    runStep(),
    inspectStep(record),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ revision: { exact: 7 } }),
  );
  assert.ok(snapshot.ref);
  assert.equal(snapshot.frozen?.evidence, "visual");
  const runInvocation = scripted.invocations[2];
  assert.ok(runInvocation);
  assert.equal((runInvocation.input as { lens?: unknown }).lens, "visual");
  return { ref: snapshot.ref, snapshot };
}

test("invalid Repeat values fail before any canonical operation", async () => {
  const scripted = createScriptedRelayClient([compileStep()]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ repeat: { dimensions: [{ id: "language", values: ["en", "en"] }] } }),
  );

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "invalid-intent");
  assert.equal(scripted.invocations.length, 0);
  assert.equal(scripted.remaining(), 1);
});

test("recover adopts one canonical unfinished Repeat without starting another pilot", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "job.combine.campaign.repeat.active",
      output: { campaign: recoverableRepeat() },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).recover({
    kind: "repeat-test",
    appMapId: "settings",
    testId: "data-controls",
  });

  assert.ok(snapshot.ref);
  assert.equal(snapshot.phase, "paused");
  assert.equal(snapshot.frozen?.requestedAppMapRevision, 7);
  assert.equal(snapshot.frozen?.evidence, "visual");
  assert.deepEqual(snapshot.frozen?.capture?.fullSurfaceScreenIds, ["data-controls"]);
  assert.equal(snapshot.frozen?.sourceRevision?.sha, "abc1234");
  assert.deepEqual(snapshot.frozen?.resolved.dimensions[0]?.valueIds, values);
  assert.deepEqual(
    scripted.invocations.map((invocation) => invocation.id),
    ["job.combine.campaign.repeat.active"],
  );
});

test("a lost Repeat start response is recovered explicitly without retrying the mutation", async () => {
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    { id: "app-map.test.run", error: new Error("response lost") },
    {
      id: "job.combine.campaign.repeat.active",
      output: { campaign: recoverableRepeat() },
    },
  ]);
  const workflows = createRelayWorkflows(scripted.client);

  const unknown = await workflows.start(intent({ revision: { exact: 7 } }));
  assert.equal(unknown.phase, "needs-attention");
  assert.equal(unknown.ref, undefined);

  const recovered = await workflows.recover({
    kind: "repeat-test",
    appMapId: "settings",
    testId: "data-controls",
  });
  assert.ok(recovered.ref);
  assert.equal(recovered.phase, "paused");
  assert.equal(
    scripted.invocations.filter((invocation) => invocation.id === "app-map.test.run").length,
    1,
  );
});

test("recover refuses malformed durable Repeat identity without mutating anything", async () => {
  const record = recoverableRepeat();
  record.execution!.repeat!.selectedCaseIds = ["result-en"];
  const scripted = createScriptedRelayClient([
    {
      id: "job.combine.campaign.repeat.active",
      output: { campaign: record },
    },
  ]);

  const snapshot = await createRelayWorkflows(scripted.client).recover({
    kind: "repeat-test",
    appMapId: "settings",
    testId: "data-controls",
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.ref, undefined);
  assert.equal(snapshot.problems[0]?.code, "malformed-response");
  assert.equal(scripted.invocations.length, 1);
});

test("Repeat freezes the Test, starts exactly one pilot, then projects durable state", async () => {
  const record = durableRepeat({ status: "pilot-running", pilot: "queued", remaining: "pending" });
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    runStep((input) =>
      assert.deepEqual(input, {
        appMapId: "settings",
        testId: "data-controls",
        expectedRevision: 7,
        target,
        in: { language: values },
        strategy: "zip",
        lens: "visual",
        executionMode: "pilot",
        repeatRecovery: {
          schemaVersion: 1,
          testPlanDigest: "plan-7",
          spec: repeat,
          resolved: {
            dimensions: [{ id: "language", valueIds: values }],
            strategy: "zip",
            pilot: { mode: "representative" },
            resume: "untouched",
          },
        },
        sourceRevision: { vcs: "git", sha: "abcdef1" },
        surfaceCapture: { forceRecaptureScreenIds: ["data-controls"] },
      }),
    ),
    inspectStep(record),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({
      revision: "current",
      evidence: "visual",
      sourceRevision: { vcs: "git", sha: "abcdef1" },
      capture: { fullSurfaceScreenIds: ["data-controls"] },
    }),
  );

  assert.equal(snapshot.stage, "pilot");
  assert.equal(snapshot.frozen?.requestedAppMapRevision, 7);
  assert.equal(snapshot.frozen?.executionAppMapRevision, 8);
  assert.equal(snapshot.frozen?.testPlanDigest, "plan-7");
  assert.equal(snapshot.frozen?.rootRecipeId, "repeat-root");
  assert.deepEqual(snapshot.outcomes, {
    selected: 3,
    observed: 1,
    untouched: 2,
    running: 1,
    passed: 0,
    failed: 0,
    needsReview: 0,
    cancelled: 0,
  });
  assert.deepEqual(
    snapshot.results.map(({ values: selected, phase, status }) => ({ selected, phase, status })),
    [
      { selected: { language: "en" }, phase: "pilot", status: "running" },
      { selected: { language: "it" }, phase: "remaining", status: "untouched" },
      { selected: { language: "fr" }, phase: "remaining", status: "untouched" },
    ],
  );
  assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.equal(scripted.remaining(), 0);
});

test("Repeat risk preflight blocks before starting the representative pilot", async () => {
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
  const scripted = createScriptedRelayClient([mapStep(), compileStep(7, guarded)]);

  const snapshot = await createRelayWorkflows(scripted.client).start(intent());

  assert.equal(snapshot.phase, "blocked");
  assert.equal(snapshot.problems[0]?.code, "risk-confirmation-required");
  assert.deepEqual(
    scripted.invocations.map(({ id }) => id),
    ["app-map.get", "app-map.test.compile"],
  );
});

test("multi-dimensional recovery preserves exact case tuples and rejects tuple drift", async () => {
  const spec: RepeatSpec = {
    dimensions: [
      { id: "language", values: ["en", "it"] },
      { id: "theme", values: ["light", "dark"] },
    ],
    strategy: "cartesian",
    pilot: { mode: "specified", case: { language: "it", theme: "dark" } },
    resume: "untouched",
  };
  const ids = ["case-it-dark", "case-en-light", "case-en-dark", "case-it-light"];
  const tuples = [
    { language: "it", theme: "dark" },
    { language: "en", theme: "light" },
    { language: "en", theme: "dark" },
    { language: "it", theme: "light" },
  ];
  const cases = tuples.map((selected, index) => ({
    index,
    cellId: ids[index]!,
    testId: "data-controls",
    world: Object.values(selected).join(" × "),
    values: selected,
    targetProfileId: "pixel-profile",
    childIntentDigest: `child-${index}`,
    outerIntentDigest: `outer-${index}`,
    wrapperGraphDigest: `wrapper-${index}`,
    staticInputDigest: `input-${index}`,
    phase: index === 0 ? ("pilot" as const) : ("coverage" as const),
    status: index === 0 ? ("queued" as const) : ("pending" as const),
    ...(index === 0 ? { jobId: "pilot-job" } : {}),
  }));
  const record: CombineCampaign = {
    schemaVersion: 1,
    id: "repeat-multi",
    projectId: "default",
    appMapId: "settings",
    combineId: "generated-repeat",
    sourceRevision: 8,
    latestRevision: 8,
    target: { kind: "device", id: "pixel-9", platform: "android" },
    status: "pilot-running",
    createdAt: 100,
    updatedAt: 110,
    cases,
    lineage: [{ kind: "created", at: 100, appMapRevision: 8 }],
    execution: {
      selected: { language: ["en", "it"], theme: ["light", "dark"] },
      selectedCellIds: ids,
      strategy: "cartesian",
      seed: 1,
    },
  };
  const scripted = createScriptedRelayClient([
    {
      id: "app-map.get",
      output: {
        appMap: {
          revision: 7,
          variables: {
            language: {
              id: "language",
              name: "Language",
              kind: "language",
              apply: { kind: "appLocale", app: "com.example.app" },
              options: [{ id: "en" }, { id: "it" }],
            },
            theme: {
              id: "theme",
              name: "Theme",
              kind: "theme",
              apply: { kind: "appLocale", app: "com.example.app" },
              options: [{ id: "light" }, { id: "dark" }],
            },
          },
        },
      },
    },
    compileStep(),
    {
      id: "app-map.test.run",
      checkInput: (input) =>
        assert.deepEqual((input as { pilotCase?: unknown }).pilotCase, {
          language: "it",
          theme: "dark",
        }),
      output: {
        planIdentity: {
          appMapId: "settings",
          appMapRevision: 8,
          testId: "data-controls",
          rootRecipeId: "repeat-root",
        },
        plan: { rootRecipeId: "repeat-root" },
        job: job(),
        jobs: [job()],
        combine: { id: "generated-repeat", revision: 8 },
        campaign: { id: "repeat-multi", selectedCellIds: ids },
      },
    },
    inspectStep(record),
  ]);
  const started = await createRelayWorkflows(scripted.client).start(
    intent({ revision: { exact: 7 }, repeat: structuredClone(spec) }),
  );
  assert.deepEqual(
    started.results.map((result) => result.values),
    tuples,
  );
  assert.ok(started.ref);

  const tampered = structuredClone(record);
  tampered.cases[1]!.values.theme = "solarized";
  const inspection = createScriptedRelayClient([inspectStep(tampered)]);
  const rejected = await createRelayWorkflows(inspection.client).inspect(started.ref!);
  assert.equal(rejected.kind, "repeat-test");
  assert.equal(rejected.phase, "needs-attention");
  assert.deepEqual(rejected.allowedNextActions, ["inspect"]);
});

test("a lost pilot-start response is terminal and is never retried", async () => {
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    { id: "app-map.test.run", error: new Error("response lost after dispatch") },
    runStep(),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ revision: { exact: 7 } }),
  );

  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.ref, undefined);
  assert.equal(snapshot.problems[0]?.code, "mutation-outcome-unknown");
  assert.equal(scripted.invocations.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.equal(scripted.remaining(), 1);
});

test("a post-start inspection failure retains a usable opaque reference", async () => {
  const record = durableRepeat({ status: "pilot-running", pilot: "queued", remaining: "pending" });
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    runStep(),
    { id: "job.combine.campaign.get", error: new Error("temporarily unavailable") },
    inspectStep(record),
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const started = await workflows.start(intent({ revision: { exact: 7 } }));

  assert.equal(started.phase, "needs-attention");
  assert.ok(started.ref);
  assert.deepEqual(started.allowedNextActions, ["inspect"]);
  const inspected = await workflows.inspect(started.ref);
  assert.equal(inspected.kind, "repeat-test");
  assert.equal(inspected.kind === "repeat-test" ? inspected.stage : undefined, "pilot");
  assert.equal(scripted.remaining(), 0);
});

test("durable identity drift fails closed", async () => {
  const record = durableRepeat({
    status: "pilot-running",
    pilot: "queued",
    remaining: "pending",
    sourceRevision: 9,
  });
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    runStep(),
    inspectStep(record),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).start(
    intent({ revision: { exact: 7 } }),
  );

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
  assert.match(snapshot.problems[0]?.detail ?? "", /identity/u);
});

test("every durable Repeat status projects to an outcome-level phase", async () => {
  const { ref } = await startReadyRef();
  const rows = [
    ["pilot-running", "queued", "pending", "running", "pilot", ["inspect", "cancel"]],
    [
      "ready-to-resume",
      "passed",
      "pending",
      "paused",
      "awaiting-continuation",
      ["inspect", "continue", "cancel"],
    ],
    ["ready-to-resume", "pending", "pending", "needs-attention", "unknown", ["inspect", "cancel"]],
    [
      "needs-review",
      "blocked",
      "pending",
      "needs-attention",
      "awaiting-continuation",
      ["inspect", "confirm-and-continue", "cancel"],
    ],
    ["running", "passed", "running", "running", "remaining", ["inspect", "cancel"]],
    ["completed", "passed", "passed", "succeeded", "complete", ["inspect"]],
    ["completed-with-problems", "passed", "failed", "failed", "complete", ["inspect"]],
    ["cancelled", "cancelled", "cancelled", "cancelled", "complete", ["inspect"]],
  ] as const;

  for (const [status, pilot, remaining, phase, stage, actions] of rows) {
    const scripted = createScriptedRelayClient([
      inspectStep(durableRepeat({ status, pilot, remaining })),
    ]);
    const snapshot = await createRelayWorkflows(scripted.client).inspect(ref);
    assert.equal(snapshot.kind, "repeat-test");
    if (snapshot.kind !== "repeat-test") continue;
    assert.equal(snapshot.phase, phase);
    assert.equal(snapshot.stage, stage);
    assert.deepEqual(snapshot.allowedNextActions, actions);
  }
});

test("an unproved pilot cannot continue", async () => {
  const { ref } = await startReadyRef();
  const record = durableRepeat({
    status: "ready-to-resume",
    pilot: "pending",
    remaining: "pending",
  });
  const first = createScriptedRelayClient([inspectStep(record)]);
  const current = await createRelayWorkflows(first.client).inspect(ref);
  assert.equal(current.kind, "repeat-test");
  const scripted = createScriptedRelayClient([adoptionStep(record)]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: current.version,
  });

  assert.equal(snapshot.problems.at(-1)?.code, "unexpected-authoring-state");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    0,
  );
});

test("a persisted representative result exposes immutable Run evidence", async () => {
  const { ref } = await startReadyRef();
  const scripted = createScriptedRelayClient([
    inspectStep(
      durableRepeat({
        status: "ready-to-resume",
        pilot: "passed",
        remaining: "pending",
      }),
    ),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).inspect(ref);
  assert.equal(snapshot.kind, "repeat-test");
  if (snapshot.kind !== "repeat-test") return;
  assert.deepEqual(snapshot.evidenceRefs, [{ kind: "run", id: "pilot-run" }]);
  assert.deepEqual(snapshot.repeat, { id: "repeat-1" });
});

test("a terminal representative result without immutable Run evidence cannot pass or continue", async () => {
  const { ref } = await startReadyRef();
  const record = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  delete record.cases[0]!.runId;
  const scripted = createScriptedRelayClient([inspectStep(record)]);
  const snapshot = await createRelayWorkflows(scripted.client).inspect(ref);
  assert.equal(snapshot.kind, "repeat-test");
  if (snapshot.kind !== "repeat-test") return;
  assert.equal(snapshot.phase, "running");
  assert.equal(snapshot.results[0]?.status, "running");
  assert.equal(snapshot.allowedNextActions.includes("continue"), false);
  assert.equal(snapshot.allowedNextActions.includes("confirm-and-continue"), false);
  assert.deepEqual(snapshot.evidenceRefs, []);
});

test("failed and cancelled representative results remain nonterminal without immutable evidence", async () => {
  const { ref } = await startReadyRef();
  for (const [recordStatus, resultStatus] of [
    ["needs-review", "failed"],
    ["cancelled", "cancelled"],
  ] as const) {
    const record = durableRepeat({
      status: recordStatus,
      pilot: resultStatus,
      remaining: "pending",
    });
    delete record.cases[0]!.runId;
    const scripted = createScriptedRelayClient([inspectStep(record)]);
    const snapshot = await createRelayWorkflows(scripted.client).inspect(ref);
    assert.equal(snapshot.kind, "repeat-test");
    if (snapshot.kind !== "repeat-test") continue;
    assert.equal(snapshot.phase, "running");
    assert.equal(snapshot.results[0]?.status, "running");
    assert.deepEqual(snapshot.allowedNextActions, ["inspect", "cancel"]);
    assert.deepEqual(snapshot.evidenceRefs, []);
  }
});

test("a stale decision returns current state without mutation", async () => {
  const { ref, snapshot: old } = await startReadyRef();
  const newer = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
    updatedAt: 999,
  });
  const scripted = createScriptedRelayClient([adoptionStep(newer)]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: old.version,
  });

  assert.equal(snapshot.problems.at(-1)?.code, "stale-workflow-version");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    0,
  );
});

test("a copied legacy Repeat ref cannot bypass owner authorization or durable CAS", async () => {
  const { ref, snapshot } = await startReadyRef();
  const scripted = createScriptedRelayClient([
    { id: "workflow.create", error: new Error("Workflow not found") },
    {
      id: "job.combine.campaign.resume",
      output: { campaign: recoverableRepeat(), jobs: [], cells: [] },
    },
  ]);

  const denied = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: snapshot.version,
  });

  assert.equal(denied.phase, "needs-attention");
  assert.equal(denied.problems.at(-1)?.code, "operation-unavailable");
  assert.equal(
    scripted.invocations.some(({ id }) => id === "job.combine.campaign.resume"),
    false,
  );
  assert.equal(scripted.remaining(), 1);
});

test("continue resumes once against the frozen execution revision", async () => {
  const { ref, snapshot: ready } = await startReadyRef();
  const before = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  const after = durableRepeat({
    status: "running",
    pilot: "passed",
    remaining: "queued",
    updatedAt: 120,
  });
  const scripted = createScriptedRelayClient([
    adoptionStep(before),
    reservedRepeatStep(before, "repeat-resume"),
    {
      id: "job.combine.campaign.resume",
      checkInput: (input) => {
        const value = input as Record<string, unknown>;
        assert.equal(value.batchId, "repeat-1");
        assert.equal(value.expectedAppMapRevision, 8);
        assert.deepEqual(
          { ...(value.workflowMutation as object), completedAt: 0 },
          {
            schemaVersion: 1,
            workflowId: "adopted-repeat",
            transitionVersion: 2,
            action: "repeat-resume",
            completedAt: 0,
          },
        );
      },
      output: { campaign: after, jobs: [], cells: [] },
    },
    completedRepeatStep(after, "repeat-resume"),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: ready.version,
  });

  assert.equal(snapshot.kind === "repeat-test" ? snapshot.stage : undefined, "remaining");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    1,
  );
});

test("confirm-and-continue sends explicit review exactly once", async () => {
  const { ref } = await startReadyRef();
  const before = durableRepeat({ status: "needs-review", pilot: "blocked", remaining: "pending" });
  const after = durableRepeat({
    status: "running",
    pilot: "blocked",
    remaining: "queued",
    updatedAt: 120,
  });
  const inspection = createScriptedRelayClient([inspectStep(before)]);
  const current = await createRelayWorkflows(inspection.client).inspect(ref);
  const scripted = createScriptedRelayClient([
    adoptionStep(before),
    reservedRepeatStep(before, "repeat-resume", true),
    {
      id: "job.combine.campaign.resume",
      checkInput: (input) => {
        const value = input as Record<string, unknown>;
        assert.equal(value.batchId, "repeat-1");
        assert.equal(value.expectedAppMapRevision, 8);
        assert.equal(value.reviewed, true);
        assert.equal((value.workflowMutation as { action?: unknown }).action, "repeat-resume");
      },
      output: { campaign: after, jobs: [], cells: [] },
    },
    completedRepeatStep(after, "repeat-resume"),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "confirm-and-continue",
    ref,
    expectedVersion: current.version,
  });

  assert.equal(snapshot.kind === "repeat-test" ? snapshot.stage : undefined, "remaining");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    1,
  );
});

test("continuation transport failure is not retried", async () => {
  const { ref, snapshot: ready } = await startReadyRef();
  const before = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  const scripted = createScriptedRelayClient([
    adoptionStep(before),
    reservedRepeatStep(before, "repeat-resume"),
    { id: "job.combine.campaign.resume", error: new Error("response lost") },
    {
      id: "workflow.get",
      output: {
        workflow: adoptedRepeatWorkflow(
          before,
          3,
          "repeat-resume-outcome-unknown",
          "needs-attention",
        ),
        campaign: before,
      },
    },
    { id: "job.combine.campaign.resume", output: { campaign: before, jobs: [], cells: [] } },
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: ready.version,
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
  assert.equal(snapshot.problems.at(-1)?.code, "mutation-outcome-unknown");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    1,
  );
  assert.equal(scripted.remaining(), 1);
});

test("a malformed continuation response is inspect-only and is not retried", async () => {
  const { ref, snapshot: ready } = await startReadyRef();
  const before = durableRepeat({
    status: "ready-to-resume",
    pilot: "passed",
    remaining: "pending",
  });
  const mismatched = durableRepeat({
    status: "running",
    pilot: "passed",
    remaining: "queued",
    sourceRevision: 9,
  });
  const scripted = createScriptedRelayClient([
    adoptionStep(before),
    reservedRepeatStep(before, "repeat-resume"),
    {
      id: "job.combine.campaign.resume",
      output: { campaign: mismatched, jobs: [], cells: [] },
    },
    {
      id: "workflow.transition",
      output: {
        workflow: {
          ...adoptedRepeatWorkflow(mismatched, 3, "repeat-resume-reconciled"),
          record: {
            ...adoptedRepeatWorkflow(mismatched, 3, "repeat-resume-reconciled").record,
            resource: { kind: "campaign", id: "other-campaign" },
          },
        },
        campaign: mismatched,
      },
    },
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "continue",
    ref,
    expectedVersion: ready.version,
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
  assert.equal(snapshot.problems.at(-1)?.code, "malformed-response");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.resume").length,
    1,
  );
  assert.equal(scripted.remaining(), 0);
});

test("cancel is canonical and terminal", async () => {
  const { ref } = await startReadyRef();
  const running = durableRepeat({ status: "running", pilot: "passed", remaining: "running" });
  const cancelled = durableRepeat({
    status: "cancelled",
    pilot: "cancelled",
    remaining: "cancelled",
    updatedAt: 120,
  });
  const inspection = createScriptedRelayClient([inspectStep(running)]);
  const current = await createRelayWorkflows(inspection.client).inspect(ref);
  const scripted = createScriptedRelayClient([
    adoptionStep(running),
    reservedRepeatStep(running, "repeat-cancel"),
    {
      id: "job.combine.campaign.cancel",
      checkInput: (input) => {
        const value = input as Record<string, unknown>;
        assert.equal(value.batchId, "repeat-1");
        assert.equal((value.workflowMutation as { action?: unknown }).action, "repeat-cancel");
      },
      output: { campaign: cancelled },
    },
    completedRepeatStep(cancelled, "repeat-cancel"),
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "cancel",
    ref,
    expectedVersion: current.version,
  });

  assert.equal(snapshot.phase, "cancelled");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
});

test("an uncertain cancel is inspect-only and is not retried", async () => {
  const { ref } = await startReadyRef();
  const running = durableRepeat({ status: "running", pilot: "passed", remaining: "running" });
  const inspection = createScriptedRelayClient([inspectStep(running)]);
  const current = await createRelayWorkflows(inspection.client).inspect(ref);
  const scripted = createScriptedRelayClient([
    adoptionStep(running),
    reservedRepeatStep(running, "repeat-cancel"),
    { id: "job.combine.campaign.cancel", error: new Error("response lost") },
    {
      id: "workflow.get",
      output: {
        workflow: adoptedRepeatWorkflow(
          running,
          3,
          "repeat-cancel-outcome-unknown",
          "needs-attention",
        ),
        campaign: running,
      },
    },
    { id: "job.combine.campaign.cancel", output: { campaign: running } },
  ]);
  const snapshot = await createRelayWorkflows(scripted.client).advance({
    action: "cancel",
    ref,
    expectedVersion: current.version,
  });

  assert.equal(snapshot.phase, "needs-attention");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect"]);
  assert.equal(snapshot.problems.at(-1)?.code, "mutation-outcome-unknown");
  assert.equal(
    scripted.invocations.filter(({ id }) => id === "job.combine.campaign.cancel").length,
    1,
  );
  assert.equal(scripted.remaining(), 1);
});

test("public projection counts only selected values and exposes no internal product vocabulary", async () => {
  const { ref } = await startReadyRef();
  const record = durableRepeat({
    status: "completed-with-problems",
    pilot: "passed",
    remaining: "failed",
    includeExtra: true,
  });
  const scripted = createScriptedRelayClient([inspectStep(record)]);
  const snapshot = await createRelayWorkflows(scripted.client).inspect(ref);
  assert.equal(snapshot.kind, "repeat-test");
  if (snapshot.kind !== "repeat-test") return;

  assert.deepEqual(snapshot.outcomes, {
    selected: 3,
    observed: 3,
    untouched: 0,
    running: 0,
    passed: 1,
    failed: 2,
    needsReview: 0,
    cancelled: 0,
  });
  const serialized = JSON.stringify(snapshot).toLowerCase();
  for (const banned of ["variable", "combine", "campaign", "cell", "batch"]) {
    assert.equal(
      new RegExp(`\\b${banned}s?\\b`, "u").test(serialized),
      false,
      `public snapshot leaked ${banned}`,
    );
  }
});

test("failed resume policy requires review and continues through the canonical campaign", async () => {
  const retrySpec: RepeatSpec = { ...structuredClone(repeat), resume: "failed" };
  const failed = durableRepeat({
    status: "completed-with-problems",
    pilot: "passed",
    remaining: "failed",
  });
  failed.execution!.repeat!.spec = structuredClone(retrySpec);
  failed.execution!.repeat!.resolved.resume = "failed";
  const scripted = createScriptedRelayClient([
    mapStep(),
    compileStep(),
    runStep(),
    inspectStep(failed),
  ]);
  const workflows = createRelayWorkflows(scripted.client);
  const snapshot = await workflows.start(intent({ revision: { exact: 7 }, repeat: retrySpec }));
  assert.equal(snapshot.phase, "needs-attention");
  assert.equal(snapshot.stage, "awaiting-continuation");
  assert.deepEqual(snapshot.allowedNextActions, ["inspect", "confirm-and-continue", "cancel"]);
  assert.ok(snapshot.ref);

  const running = durableRepeat({ status: "running", pilot: "passed", remaining: "running" });
  const continuation = createScriptedRelayClient([
    adoptionStep(failed),
    reservedRepeatStep(failed, "repeat-resume", true),
    {
      id: "job.combine.campaign.resume",
      checkInput: (input) => {
        const value = input as Record<string, unknown>;
        assert.equal(value.batchId, "repeat-1");
        assert.equal(value.expectedAppMapRevision, 8);
        assert.equal(value.reviewed, true);
        assert.equal((value.workflowMutation as { action?: unknown }).action, "repeat-resume");
      },
      output: { campaign: running, jobs: [], cells: [] },
    },
    completedRepeatStep(running, "repeat-resume"),
  ]);
  const continued = await createRelayWorkflows(continuation.client).advance({
    action: "confirm-and-continue",
    ref: snapshot.ref!,
    expectedVersion: snapshot.version,
  });
  assert.equal(continued.phase, "running");
});
