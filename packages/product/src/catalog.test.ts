import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapScenarioTest, RunSummary } from "@relay/protocol";
import { createScriptedRelayClient } from "@relay/workflows/testing";
import {
  createProductCatalog,
  productRunDetail,
  productTestStatusLabel,
  projectProductRuns,
  projectProductTests,
  isFlaky,
} from "./catalog.js";

function app(id: string, name: string, tests: Record<string, AppMapScenarioTest>): AppMap {
  return {
    schemaVersion: 1,
    id,
    organizationId: "org",
    projectId: "project",
    name,
    revision: 4,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests,
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 4,
  };
}

function scenario(id: string, name: string, unresolved = false): AppMapScenarioTest {
  return {
    id,
    appMapId: "map",
    organizationId: "org",
    projectId: "project",
    createdAt: 1,
    updatedAt: 3,
    name,
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: `${id}-step`,
        intent: "Open settings",
        kind: "instruction",
        binding: unresolved
          ? { status: "unresolved", reason: "Needs a reviewed destination" }
          : {
              status: "resolved",
              kind: "connections",
              connectionIds: ["connection-1"],
            },
      },
    ],
  };
}

function run(
  input: Partial<RunSummary> & Pick<RunSummary, "id" | "action" | "status" | "queuedAt">,
): RunSummary {
  return {
    frameCount: 0,
    writtenAt: input.queuedAt,
    artifactCount: 0,
    artifactBytes: 0,
    storageBytes: 0,
    pinned: false,
    retentionClass: "standard",
    ...input,
  };
}

test("projects production app Maps into app-scoped tests with recent run links", () => {
  const first = app("app-one", "Shopping", { ready: scenario("ready", "Checkout") });
  const second = app("app-two", "Admin", { attention: scenario("attention", "Users", true) });
  const summaries = projectProductTests(
    [first, second],
    [
      run({ id: "run-old", action: "app-map:app-one:test:ready:run", status: "ok", queuedAt: 1 }),
      run({
        id: "run-new",
        action: "app-map:app-one:test:ready:run",
        status: "running",
        queuedAt: 8,
      }),
    ],
  );
  assert.deepEqual(
    summaries.map((item) => [item.appName, item.name, item.status]),
    [
      ["Shopping", "Checkout", "ready"],
      ["Admin", "Users", "needs-review"],
    ],
  );
  assert.equal(summaries[0]?.recentRun?.id, "run-new");
  assert.equal(summaries[0]?.recentRun?.links.test, "/tests/ready");
  assert.equal(summaries[1]?.href, "/tests/attention");
});

test("a test not yet confirmed by a run stays runnable; running it confirms it", () => {
  const valid = scenario("validated", "Validated");
  valid.validation = {
    status: "passed",
    appMapRevision: 4,
    testUpdatedAt: valid.updatedAt,
    validatedAt: 5,
  };
  const failed = scenario("failed-validation", "Failed validation");
  failed.validation = { ...valid.validation, status: "needs-validation" };
  const edited = scenario("edited", "Edited");
  edited.validation = { ...valid.validation, testUpdatedAt: edited.updatedAt - 1 };
  const legacy = scenario("legacy", "Legacy");
  const map = app("app-one", "Shopping", {
    validated: valid,
    "failed-validation": failed,
    edited,
    legacy,
  });
  const tests = projectProductTests([map]);
  assert.equal(tests.find((test) => test.id === "validated")?.status, "ready");
  assert.equal(tests.find((test) => test.id === "failed-validation")?.status, "ready");
  assert.equal(tests.find((test) => test.id === "edited")?.status, "ready");
  assert.equal(tests.find((test) => test.id === "edited")?.setupIssue, undefined);
  assert.equal(tests.find((test) => test.id === "legacy")?.status, "ready");
  assert.equal(
    projectProductTests([{ ...map, revision: 5 }]).find((test) => test.id === "validated")?.status,
    "ready",
  );
});

test("share-menu with no origin variant is not Ready", () => {
  const share = scenario("test-grok-ios-share-menu", "Share Conversation and Delete menu");
  const map: AppMap = {
    ...app("grok-ios", "Grok iOS daily", { "test-grok-ios-share-menu": share }),
    screens: {
      "screen-grok-ios-signed-in-home": {
        organizationId: "org",
        projectId: "project",
        appMapId: "grok-ios",
        id: "screen-grok-ios-signed-in-home",
        title: "Signed-in SuperGrok home",
        variantIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    connections: {
      "connection-1": {
        organizationId: "org",
        projectId: "project",
        appMapId: "grok-ios",
        id: "connection-1",
        fromScreenId: "screen-grok-ios-signed-in-home",
        destination: { kind: "end" },
        label: "Share",
        state: "ready",
        actions: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
  const tests = projectProductTests([map]);
  assert.equal(tests[0]?.status, "needs-review");
  assert.equal(productTestStatusLabel(tests[0]!.status, share.name), "Needs setup");
});

test("explicitly unrecorded names stay blocked while generation names reflect setup", () => {
  const thread = scenario("thread", "Header More on existing chat (Start Thread still absent)");
  const older = scenario(
    "older",
    "UNRECORDED — Older conversation then 2+2 (banner-only; number-equals 4 failed)",
  );
  const imagine = scenario("imagine", "Imagine Speed image generation signed-in");
  const map = app("grok-web", "Grok.com daily", { thread, older, imagine });
  const tests = projectProductTests([map]);
  assert.equal(tests.find((test) => test.id === "thread")?.status, "needs-review");
  assert.equal(tests.find((test) => test.id === "older")?.status, "needs-review");
  assert.equal(tests.find((test) => test.id === "imagine")?.status, "ready");
  assert.equal(productTestStatusLabel("needs-review", thread.name), "Unrecorded");
  assert.equal(
    productTestStatusLabel("needs-review", "Imagine Speed image generation signed-in"),
    "Needs setup",
  );
  assert.equal(
    productTestStatusLabel("ready", "Imagine Speed image generation signed-in"),
    "Ready",
  );
  assert.equal(productTestStatusLabel("ready", "Header More on existing chat"), "Ready");
});

test("projects run views with durable identity, human joins, phases, and filters", () => {
  const maps = [app("app-one", "Shopping", { ready: scenario("ready", "Checkout") })];
  const runs = projectProductRuns(
    [
      run({
        id: "run-failed",
        action: "app-map:app-one:test:ready:run",
        status: "error",
        queuedAt: 4,
        outcome: "product-failure",
        title: "Checkout",
        platform: "android",
        review: {
          schemaVersion: 1,
          status: "pending",
          capability: "visual",
          reason: "Review frame",
          requestedAt: 4,
        },
      }),
      run({ id: "run-active", action: "test.run", status: "running", queuedAt: 5 }),
    ],
    maps,
  );
  assert.equal(runs[0]?.phase, "failed");
  assert.deepEqual(runs[0]?.identity, {
    runId: "run-failed",
    appMapId: "app-one",
    testId: "ready",
  });
  assert.deepEqual(runs[0]?.links, {
    self: "/runs/run-failed",
    test: "/tests/ready",
    app: "/apps/app-one",
  });
  assert.equal(runs[1]?.phase, "running");
  assert.equal(runs[1]?.title, "Saved test");
  assert.doesNotMatch(JSON.stringify(runs[1]), /ready/u);
  assert.equal(runs[0]?.review?.status, "pending");
});

test("Run summaries preserve only the exact saved plan attribution of their canonical matrix case", () => {
  const matrixCase = {
    kind: "combine" as const,
    appMapId: "grok",
    testId: "speed",
    combineId: "prompts",
    world: "one",
    values: { prompts: "value-1" },
  };
  const projected = projectProductRuns([
    run({ id: "plan", action: "test.run", status: "ok", queuedAt: 1, matrixCase }),
    run({ id: "standalone", action: "app-map:grok:test:speed:run", status: "error", queuedAt: 2 }),
    run({
      id: "legacy",
      action: "test.run",
      title: "prompts",
      status: "error",
      queuedAt: 3,
      matrixCase: { ...matrixCase, combineId: undefined },
    }),
    run({
      id: "conflict",
      action: "test.run",
      status: "error",
      queuedAt: 4,
      matrixCase,
      sourceTest: { appMapId: "different-app", testId: "speed" },
    }),
    run({
      id: "test-conflict",
      action: "test.run",
      status: "error",
      queuedAt: 5,
      matrixCase,
      sourceTest: { appMapId: "grok", testId: "fast" },
    }),
  ]);
  assert.equal(projected[0]?.combineId, "prompts");
  for (const item of projected.slice(1)) assert.equal(item.combineId, undefined);
});

test("catalog calls canonical operations and fails closed on ambiguous test identity", async () => {
  const one = app("app-one", "Shopping", { duplicate: scenario("duplicate", "One") });
  const two = app("app-two", "Admin", { duplicate: scenario("duplicate", "Two") });
  const scripted = createScriptedRelayClient([
    { id: "app-map.list", output: { appMaps: [one, two] } },
  ]);
  const catalog = createProductCatalog(scripted.client);
  await assert.rejects(
    () => catalog.getTest("duplicate"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "product-test-identity-ambiguous");
      return true;
    },
  );
  assert.deepEqual(
    scripted.invocations.map((item) => item.id),
    ["app-map.list"],
  );
});

test("Run list applies public views after the server-scoped query", async () => {
  const map = app("app-one", "Shopping", { ready: scenario("ready", "Checkout") });
  const scripted = createScriptedRelayClient([
    {
      id: "run.list",
      output: {
        runs: [
          run({
            id: "active",
            action: "app-map:app-one:test:ready:run",
            status: "running",
            queuedAt: 3,
          }),
          run({
            id: "failed",
            action: "app-map:app-one:test:ready:run",
            status: "error",
            queuedAt: 2,
            outcome: "product-failure",
          }),
        ],
      },
    },
    { id: "app-map.get", output: { appMap: map } },
  ]);
  const runs = await createProductCatalog(scripted.client).listRuns({
    appMapId: "app-one",
    view: "failed",
  });
  assert.deepEqual(
    runs.map((item) => item.id),
    ["failed"],
  );
  assert.deepEqual(
    scripted.invocations.map((item) => item.id),
    ["run.list", "app-map.get"],
  );
  assert.deepEqual(scripted.invocations[0]?.input, { appMapId: "app-one" });
});

test("Complete run history follows the canonical opaque cursor", async () => {
  const map = app("app-one", "Shopping", { ready: scenario("ready", "Checkout") });
  const scripted = createScriptedRelayClient([
    {
      id: "run.list",
      output: {
        runs: [
          run({ id: "new", action: "app-map:app-one:test:ready:run", status: "ok", queuedAt: 3 }),
        ],
        totalCount: 2,
        nextCursor: "cursor-page-2",
      },
    },
    {
      id: "run.list",
      output: {
        runs: [
          run({ id: "old", action: "app-map:app-one:test:ready:run", status: "ok", queuedAt: 2 }),
        ],
        totalCount: 2,
      },
    },
    { id: "app-map.get", output: { appMap: map } },
  ]);

  const runs = await createProductCatalog(scripted.client).listRunsComplete!({
    appMapId: "app-one",
  });

  assert.deepEqual(
    runs.map((item) => item.id),
    ["new", "old"],
  );
  assert.deepEqual(
    scripted.invocations.slice(0, 2).map((item) => item.input),
    [
      { appMapId: "app-one", limit: 200 },
      { appMapId: "app-one", cursor: "cursor-page-2" },
    ],
  );
});

test("latest run view keeps one newest durable run per test", async () => {
  const map = app("app-one", "Shopping", { ready: scenario("ready", "Checkout") });
  const scripted = createScriptedRelayClient([
    {
      id: "run.list",
      output: {
        runs: [
          run({ id: "old", action: "app-map:app-one:test:ready:run", status: "ok", queuedAt: 2 }),
          run({ id: "new", action: "app-map:app-one:test:ready:run", status: "ok", queuedAt: 8 }),
        ],
      },
    },
    { id: "app-map.list", output: { appMaps: [map] } },
  ]);
  const latest = await createProductCatalog(scripted.client).listRuns({ view: "latest" });
  assert.deepEqual(
    latest.map((item) => item.id),
    ["new"],
  );
});

test("run details expose inspectable steps/evidence while retaining the canonical run identity", () => {
  const detail = productRunDetail(
    run({
      id: "run-1",
      action: "test.run",
      status: "ok",
      queuedAt: 1,
      frameCount: 2,
      artifacts: [{ kind: "screenshot" }, { kind: "log" }],
      steps: [{ id: "step-1", title: "Open settings", status: "ok", frames: [{}, {}] }],
    } as never),
  );
  assert.equal(detail.id, "run-1");
  assert.equal(detail.steps[0]?.frameCount, 2);
  assert.deepEqual(detail.evidence, { available: true, frameCount: 2, artifactCount: 2 });
  assert.equal(detail.links.self, "/runs/run-1");
});

test("Run detail recovers test identity from the immutable execution artifact", () => {
  const detail = productRunDetail(
    run({
      id: "run-2",
      action: "test.run",
      status: "ok",
      queuedAt: 1,
      artifacts: [
        {
          kind: "app-map-test-execution-intent",
          data: { sourcePlan: { appMapId: "app-one", testId: "ready" } },
        },
      ],
    } as never),
    [app("app-one", "Shopping", { ready: scenario("ready", "Checkout") })],
  );
  assert.deepEqual(detail.identity, { runId: "run-2", appMapId: "app-one", testId: "ready" });
  assert.deepEqual(detail.links, {
    self: "/runs/run-2",
    test: "/tests/ready",
    app: "/apps/app-one",
  });
  assert.equal(detail.testName, "Checkout");
});

test("Run execution identity keeps warm and cold start states and leaves unknown start out", () => {
  const warm = productRunDetail(
    run({
      id: "run-warm",
      action: "test.run",
      status: "ok",
      queuedAt: 1,
      artifacts: [
        {
          kind: "app-map-test-execution-intent",
          data: {
            sourcePlan: { appMapId: "app-one", testId: "ready", appMapRevision: 12 },
            plan: { startup: { mode: "warm" } },
          },
        },
      ],
    } as never),
  );
  assert.equal(warm.executionIdentity?.startupMode, "warm");
  assert.equal(warm.executionIdentity?.appMapRevision, 12);

  const unknown = productRunDetail(
    run({
      id: "run-unknown",
      action: "test.run",
      status: "ok",
      queuedAt: 1,
      artifacts: [
        {
          kind: "app-map-test-execution-intent",
          data: { sourcePlan: { appMapId: "app-one", testId: "ready", appMapRevision: 12 } },
        },
      ],
    } as never),
  );
  assert.equal(unknown.executionIdentity?.startupMode, undefined);
});

test("Run detail exposes stable authored-step evidence and keeps legacy runs empty", () => {
  const detail = productRunDetail(
    run({
      id: "run-provenance",
      action: "test.run",
      status: "ok",
      queuedAt: 1,
      testStepEvidence: [
        {
          schemaVersion: 1,
          testStepId: "checkout-step",
          recipeId: "test:root",
          recipeStepId: "recipe-step",
          traceStepId: "generated-trace-id",
          traceStepIndex: 0,
          occurrence: 2,
          evidence: {
            framePaths: ["frames/002.png"],
            eventSequences: [7],
            artifactKinds: ["command-attempt"],
          },
        },
      ],
    } as never),
  );
  assert.equal(detail.stepEvidence[0]?.testStepId, "checkout-step");
  assert.equal(detail.stepEvidence[0]?.occurrence, 2);
  assert.deepEqual(
    productRunDetail(run({ id: "legacy", action: "test.run", status: "ok", queuedAt: 1 }))
      .stepEvidence,
    [],
  );
});

test("a test is flaky when recent runs keep flipping between passing and failing", () => {
  const runs = (...outcomes: string[]) => outcomes.map((outcome) => ({ outcome })) as never;
  assert.equal(isFlaky(runs("passed", "product-failure", "passed")), true);
  assert.equal(isFlaky(runs("passed", "passed", "passed", "product-failure")), false);
  assert.equal(isFlaky(runs("product-failure", "harness-failure", "passed", "passed")), false);
  assert.equal(isFlaky(runs("passed", "cancelled", "passed")), false);
});
