import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileBrowserEnvironment,
  type AppMapCompiledTest,
  type BrowserCaseProfile,
  type TargetDefinition,
  type TargetProfile,
} from "@relay/protocol";
import {
  AppMapTestExecutionReviewRequiredError,
  appMapTestExecutionSourceFromJob,
  createAppMapTestExecutionIntent,
  persistRun,
  preflightCompiledAppMapTestOffline,
  revalidateAppMapTestExecutionSource,
  replayInputFromPersistedRun,
  resetControlDatabaseCache,
  type Recipe,
  type TestJob,
} from "@relay/core";
import { startServer } from "./index.js";

const rootRecipeId = "app-map:transport:test:root";

type TestTarget =
  | { kind: "device"; targetId: string; platform: "android" | "ios" }
  | { kind: "browser"; targetId: string; platform: "browser" };

function headers(operationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "local",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:intent-transport-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

async function post(
  base: string,
  path: string,
  operationId: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(operationId),
    body: JSON.stringify(body),
  });
}

async function withIsolatedRunState(run: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "relay-test-intent-transport-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_RUNS_DIR = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  try {
    await run();
  } finally {
    resetControlDatabaseCache();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}

function lease(targetId: string, id = "lease") {
  return {
    id,
    projectId: "local",
    poolId: "local",
    deviceSerial: targetId,
    ownerId: "agent:intent-transport-test",
    status: "leased" as const,
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
}

function browserTarget(profile: BrowserCaseProfile, id = "browser-chat"): TargetDefinition {
  return {
    id,
    name: `Browser ${id}`,
    kind: "browser",
    createdAt: 1,
    updatedAt: 1,
    browser: {
      startUrl: "https://relay.invalid",
      environment: profile,
    },
  };
}

function recipe(id: string, steps: Recipe["steps"] = []): Recipe {
  return {
    id,
    title: id,
    source: "custom",
    steps,
    createdAt: 1,
    updatedAt: 1,
  };
}

function recipeProjection(value: Recipe) {
  return {
    id: value.id,
    title: value.title,
    parameters: [],
    steps: structuredClone(value.steps),
  };
}

function recipeGraph(kind: "simple" | "branch-repeat"): Record<string, Recipe> {
  if (kind === "simple") return { [rootRecipeId]: recipe(rootRecipeId) };
  const thenRecipeId = "app-map:transport:test:then";
  const elseRecipeId = "app-map:transport:test:else";
  const repeatedRecipeId = "app-map:transport:test:repeated";
  return {
    [rootRecipeId]: recipe(rootRecipeId, [
      {
        kind: "branch",
        input: "transport_mode",
        operator: "exists",
        thenRecipeId,
        elseRecipeId,
      },
    ]),
    [thenRecipeId]: recipe(thenRecipeId, [
      { kind: "repeat", count: 1, recipeId: repeatedRecipeId },
    ]),
    [elseRecipeId]: recipe(elseRecipeId),
    [repeatedRecipeId]: recipe(repeatedRecipeId),
  };
}

function scopedTestJob(input: {
  id: string;
  status?: TestJob["status"];
  target?: TestTarget;
  profile?: boolean;
  graph?: "simple" | "branch-repeat";
}): TestJob {
  const at = 1;
  const target = input.target ?? { kind: "device", targetId: "android-1", platform: "android" };
  const graph = recipeGraph(input.graph ?? "simple");
  const root = graph[rootRecipeId]!;
  const browserCaseProfile =
    target.kind === "browser"
      ? compileBrowserEnvironment({
          engine: "webkit",
          viewport: { width: 1_280, height: 2_400 },
          locale: "pt-BR",
          timezoneId: "America/Maceio",
          networkProfile: "wifi-slow",
          authenticationFixtureId: "member-session",
        })
      : undefined;
  const runtimeTargetProfile = input.profile
    ? {
        id: `${target.targetId}-profile`,
        targetId: target.targetId,
        platform: target.platform,
        viewport: { width: target.kind === "browser" ? 1280 : 1080, height: 2400 },
        ...(browserCaseProfile ? { browserCaseProfile } : {}),
      }
    : undefined;
  const plan = {
    schemaVersion: 1,
    appMapId: "transport-settings",
    appMapRevision: 7,
    test: { id: "transport", name: "Transport", kind: "scenario", intentSchemaVersion: 1 },
    ...(runtimeTargetProfile ? { runtimeTargetProfile } : {}),
    rootRecipeId,
    recipes: Object.fromEntries(
      Object.values(graph).map((value) => [value.id, recipeProjection(value)]),
    ),
    stepProvenance: [],
    performance: {
      executableOperations: Object.values(graph).reduce(
        (count, value) => count + value.steps.length,
        0,
      ),
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  } satisfies AppMapCompiledTest;
  const preflight = preflightCompiledAppMapTestOffline(
    plan,
    undefined,
    runtimeTargetProfile ? { targetProfileId: runtimeTargetProfile.id } : {},
  );
  assert.equal(preflight.summary.blockers, 0, "transport fixture must be preflight-valid");
  const intent = createAppMapTestExecutionIntent({ plan, recipeGraph: graph, preflight });
  const targetProfile = runtimeTargetProfile
    ? ({
        ...runtimeTargetProfile,
        ...(runtimeTargetProfile.viewport
          ? { viewport: { ...runtimeTargetProfile.viewport } }
          : {}),
        source: target.kind === "browser" ? "browser" : "device",
        name: `Target ${target.targetId}`,
        capabilities: [],
        observedAt: at,
      } satisfies TargetProfile)
    : undefined;
  const targetContext: TestJob["targetContext"] =
    target.kind === "browser"
      ? { kind: "browser", platform: "browser", targetId: target.targetId }
      : { kind: "device", platform: target.platform, serial: target.targetId };
  const status = input.status ?? "error";
  return {
    id: input.id,
    action: rootRecipeId,
    recipeId: rootRecipeId,
    title: "Transport Test",
    targetContext,
    ...(target.kind === "browser"
      ? { browserTargetId: target.targetId }
      : { serial: target.targetId }),
    // Browser jobs intentionally use Android as their legacy in-memory
    // DevicePlatform placeholder; persistence derives the real browser
    // platform from targetKind/targetContext.
    platform: target.kind === "browser" ? "android" : target.platform,
    targetKind: target.kind,
    ...(targetProfile ? { targetProfile } : {}),
    ...(browserCaseProfile ? { browserCaseProfile } : {}),
    status,
    queuedAt: at,
    ...(status === "error" ? { startedAt: at, finishedAt: at + 1 } : {}),
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    recipeSnapshot: structuredClone(root),
    recipeGraph: structuredClone(graph),
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt: at, data: intent },
      { kind: "app-map-test-plan", capturedAt: at, data: plan },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

function malformedTypedTestJob(id: string, status: TestJob["status"] = "error"): TestJob {
  const job = scopedTestJob({ id, status });
  job.artifacts = [
    null,
    {
      kind: "app-map-test-execution-intent",
      capturedAt: 1,
      data: { schemaVersion: 1 },
    },
  ] as unknown as TestJob["artifacts"];
  return job;
}

function malformedHistoricalPlanTestJob(id: string, status: TestJob["status"] = "error"): TestJob {
  const job = scopedTestJob({ id, status });
  const planArtifact = job.artifacts.find((artifact) => artifact.kind === "app-map-test-plan")!;
  job.artifacts = [null, planArtifact] as unknown as TestJob["artifacts"];
  return job;
}

function stalePreflightTestJob(id: string): TestJob {
  const job = scopedTestJob({ id });
  const intent = job.artifacts[0]!.data as { preflight: { findings: unknown[] } };
  intent.preflight.findings.push({ code: "stale-frozen-preflight" });
  return job;
}

function ordinaryTestJob(id: string, status: TestJob["status"] = "error"): TestJob {
  const job = scopedTestJob({ id, status });
  const ordinaryRecipe = recipe("ordinary:transport:recipe");
  job.action = ordinaryRecipe.id;
  job.recipeId = ordinaryRecipe.id;
  job.recipeSnapshot = ordinaryRecipe;
  job.recipeGraph = { [ordinaryRecipe.id]: structuredClone(ordinaryRecipe) };
  job.artifacts = [
    null,
    { kind: "ordinary-run-artifact", capturedAt: 1, data: { source: "legacy" } },
  ] as unknown as TestJob["artifacts"];
  return job;
}

async function assertReviewRequired(response: Response, reason?: RegExp): Promise<void> {
  assert.equal(response.status, 409);
  const body = (await response.json()) as { code?: string; error?: string; reason?: string };
  assert.equal(body.code, "APP_MAP_TEST_EXECUTION_INTENT_REVIEW_REQUIRED");
  assert.match(body.error ?? "", /needs review/i);
  if (reason) assert.match(body.reason ?? "", reason);
}

test("malformed typed Test artifacts fail closed across retry, replay, resume, and repair routes", async () => {
  await withIsolatedRunState(async () => {
    const retry = malformedTypedTestJob("malformed-retry");
    const paused = malformedTypedTestJob("malformed-paused", "paused");
    await persistRun(malformedTypedTestJob("malformed-run"));
    let controls = 0;
    let retried = 0;
    let resumed = 0;
    let replayed = 0;
    let enqueued = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: (id) => (id === paused.id ? paused : retry),
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("malformed intent must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return retry;
        },
        resumeJob: () => {
          resumed += 1;
          return paused;
        },
        replayPersistedRun: () => {
          replayed += 1;
          return retry;
        },
      },
      runRouteRuntime: {
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("malformed intent must stop before target control");
        },
        enqueueJob: () => {
          enqueued += 1;
          return retry;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await assertReviewRequired(await post(base, `/jobs/${retry.id}/retry`, "job.retry"));
      await assertReviewRequired(
        await post(base, "/jobs", "job.start", { recipe: "ignored", retryOf: retry.id }),
      );
      await assertReviewRequired(await post(base, `/jobs/${paused.id}/resume`, "job.resume"));
      await assertReviewRequired(await post(base, "/runs/malformed-run/replay", "run.replay"));
      await assertReviewRequired(
        await post(base, "/runs/malformed-run/checks/missing/retry", "run.repair.retry"),
      );
      assert.equal(controls, 0);
      assert.equal(retried, 0);
      assert.equal(resumed, 0);
      assert.equal(replayed, 0);
      assert.equal(enqueued, 0);
    } finally {
      await server.close();
    }
  });
});

test("malformed canonical historical Test plans fail closed across retry, replay, resume, and repair routes", async () => {
  await withIsolatedRunState(async () => {
    const retry = malformedHistoricalPlanTestJob("malformed-plan-retry");
    const paused = malformedHistoricalPlanTestJob("malformed-plan-paused", "paused");
    await persistRun(malformedHistoricalPlanTestJob("malformed-plan-run"));
    let controls = 0;
    let retried = 0;
    let resumed = 0;
    let replayed = 0;
    let enqueued = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: (id) => (id === paused.id ? paused : retry),
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("historical Test plan must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return retry;
        },
        resumeJob: () => {
          resumed += 1;
          return paused;
        },
        replayPersistedRun: () => {
          replayed += 1;
          return retry;
        },
      },
      runRouteRuntime: {
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("historical Test plan must stop before target control");
        },
        enqueueJob: () => {
          enqueued += 1;
          return retry;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await assertReviewRequired(
        await post(base, `/jobs/${retry.id}/retry`, "job.retry"),
        /historical App Map Test has no scoped execution intent/i,
      );
      await assertReviewRequired(
        await post(base, "/jobs", "job.start", { recipe: "ignored", retryOf: retry.id }),
        /historical App Map Test has no scoped execution intent/i,
      );
      await assertReviewRequired(
        await post(base, `/jobs/${paused.id}/resume`, "job.resume"),
        /historical App Map Test has no scoped execution intent/i,
      );
      await assertReviewRequired(
        await post(base, "/runs/malformed-plan-run/replay", "run.replay"),
        /historical App Map Test has no scoped execution intent/i,
      );
      await assertReviewRequired(
        await post(base, "/runs/malformed-plan-run/checks/missing/retry", "run.repair.retry"),
        /historical App Map Test has no scoped execution intent/i,
      );
      assert.equal(controls, 0);
      assert.equal(retried, 0);
      assert.equal(resumed, 0);
      assert.equal(replayed, 0);
      assert.equal(enqueued, 0);
    } finally {
      await server.close();
    }
  });
});

test("stale frozen preflight proof returns review-required before retry or replay control", async () => {
  await withIsolatedRunState(async () => {
    const retry = stalePreflightTestJob("stale-retry");
    await persistRun(stalePreflightTestJob("stale-run"));
    let controls = 0;
    let retried = 0;
    let replayed = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => retry,
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("stale proof must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return retry;
        },
        replayPersistedRun: () => {
          replayed += 1;
          return retry;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await assertReviewRequired(
        await post(base, `/jobs/${retry.id}/retry`, "job.retry"),
        /frozen offline preflight no longer proves/i,
      );
      await assertReviewRequired(
        await post(base, "/runs/stale-run/replay", "run.replay"),
        /frozen offline preflight no longer proves/i,
      );
      assert.equal(controls, 0);
      assert.equal(retried, 0);
      assert.equal(replayed, 0);
    } finally {
      await server.close();
    }
  });
});

test("resume maps a second stale-proof validation to the canonical review-needed 409", async () => {
  await withIsolatedRunState(async () => {
    const paused = scopedTestJob({ id: "resume-stale-after-route-check", status: "paused" });
    let resumed = 0;
    let snapshots = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => paused,
        captureSnapshot: async () => {
          snapshots += 1;
          throw new Error("a non-intervened resume must not snapshot");
        },
        resumeJob: async () => {
          resumed += 1;
          // This is the core resume boundary after the route's first frozen
          // proof; a deletion or evidence mutation in between must not become
          // a generic 500 transport failure.
          const intent = paused.artifacts[0]!.data as { preflight: { findings: unknown[] } };
          intent.preflight.findings.push({ code: "stale-between-resume-validations" });
          const assessment = await revalidateAppMapTestExecutionSource(
            appMapTestExecutionSourceFromJob(paused),
          );
          assert.equal(assessment.status, "review-required");
          throw new AppMapTestExecutionReviewRequiredError(assessment.reason);
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await assertReviewRequired(
        await post(base, `/jobs/${paused.id}/resume`, "job.resume"),
        /frozen offline preflight no longer proves/i,
      );
      assert.equal(resumed, 1);
      assert.equal(snapshots, 0);
      assert.equal(paused.status, "paused");
    } finally {
      await server.close();
    }
  });
});

test("ordinary non-Test retries, resume, and replay retain their legacy transport behavior", async () => {
  await withIsolatedRunState(async () => {
    const retry = ordinaryTestJob("ordinary-retry");
    const paused = ordinaryTestJob("ordinary-paused", "paused");
    await persistRun(ordinaryTestJob("ordinary-run"));
    let controls = 0;
    let retried = 0;
    let resumed = 0;
    let replayed = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: (id) => (id === paused.id ? paused : retry),
        assertTargetControl: async (_scope, targetId) => {
          controls += 1;
          return lease(targetId ?? "missing", `ordinary-${controls}`);
        },
        retryJob: () => {
          retried += 1;
          return retry;
        },
        resumeJob: () => {
          resumed += 1;
          return paused;
        },
        replayPersistedRun: () => {
          replayed += 1;
          return retry;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      assert.equal((await post(base, `/jobs/${retry.id}/retry`, "job.retry")).status, 202);
      assert.equal(
        (await post(base, "/jobs", "job.start", { recipe: "ignored", retryOf: retry.id })).status,
        202,
      );
      assert.equal((await post(base, `/jobs/${paused.id}/resume`, "job.resume")).status, 200);
      assert.equal((await post(base, "/runs/ordinary-run/replay", "run.replay")).status, 202);
      assert.equal(controls, 3);
      assert.equal(retried, 2);
      assert.equal(resumed, 1);
      assert.equal(replayed, 1);
    } finally {
      await server.close();
    }
  });
});

test("profile fields and frozen root snapshots cannot drift at the retry transport boundary", async () => {
  await withIsolatedRunState(async () => {
    let current = scopedTestJob({ id: "profile-drift", profile: true });
    let controls = 0;
    let retried = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => current,
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("drift must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return current;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const cases: Array<{
      name: string;
      mutate: (job: TestJob) => void;
      reason: RegExp;
    }> = [
      {
        name: "profile id",
        mutate: (job) => {
          job.targetProfile!.id = "different-profile";
        },
        reason: /queued target profile no longer matches/i,
      },
      {
        name: "profile target id",
        mutate: (job) => {
          job.targetProfile!.targetId = "different-target";
        },
        reason: /queued target profile no longer matches/i,
      },
      {
        name: "profile platform",
        mutate: (job) => {
          job.targetProfile!.platform = "ios";
        },
        reason: /queued target profile no longer matches/i,
      },
      {
        name: "profile viewport width",
        mutate: (job) => {
          job.targetProfile!.viewport!.width = 1079;
        },
        reason: /queued target profile no longer matches/i,
      },
      {
        name: "profile viewport height",
        mutate: (job) => {
          job.targetProfile!.viewport!.height = 2399;
        },
        reason: /queued target profile no longer matches/i,
      },
      {
        name: "frozen root snapshot",
        mutate: (job) => {
          job.recipeSnapshot = { ...job.recipeSnapshot!, title: "Mutated snapshot" };
        },
        reason: /queued Test recipe no longer matches/i,
      },
    ];
    try {
      for (const drift of cases) {
        current = scopedTestJob({ id: `profile-drift-${drift.name}`, profile: true });
        drift.mutate(current);
        await assertReviewRequired(
          await post(base, `/jobs/${current.id}/retry`, "job.retry"),
          drift.reason,
        );
      }
      assert.equal(controls, 0);
      assert.equal(retried, 0);
    } finally {
      await server.close();
    }
  });
});

test("branch and repeat references cannot escape the frozen graph at the retry transport boundary", async () => {
  await withIsolatedRunState(async () => {
    let current = scopedTestJob({ id: "closure-drift", graph: "branch-repeat" });
    let controls = 0;
    let retried = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => current,
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("mutable graph fallback must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return current;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    const cases: Array<{ name: string; mutate: (job: TestJob) => void }> = [
      {
        name: "branch",
        mutate: (job) => {
          const root = job.recipeGraph![rootRecipeId]!;
          const branch = root.steps[0] as Extract<Recipe["steps"][number], { kind: "branch" }>;
          root.steps[0] = { ...branch, thenRecipeId: "mutable-branch-recipe" };
        },
      },
      {
        name: "repeat",
        mutate: (job) => {
          const repeated = job.recipeGraph!["app-map:transport:test:then"]!;
          const repeat = repeated.steps[0] as Extract<Recipe["steps"][number], { kind: "repeat" }>;
          repeated.steps[0] = { ...repeat, recipeId: "mutable-repeat-recipe" };
        },
      },
    ];
    try {
      for (const drift of cases) {
        current = scopedTestJob({ id: `closure-${drift.name}`, graph: "branch-repeat" });
        drift.mutate(current);
        await assertReviewRequired(
          await post(base, `/jobs/${current.id}/retry`, "job.retry"),
          /frozen Test recipe graph is missing or malformed/i,
        );
      }
      assert.equal(controls, 0);
      assert.equal(retried, 0);
    } finally {
      await server.close();
    }
  });
});

test("browser Test profile and target identity persist exactly through replay transport", async () => {
  await withIsolatedRunState(async () => {
    const browser = scopedTestJob({
      id: "browser-typed-run",
      target: { kind: "browser", targetId: "browser-chat", platform: "browser" },
      profile: true,
    });
    const persisted = await persistRun(browser);
    assert.equal(persisted.platform, "browser");
    assert.equal(persisted.serial, "browser-chat");
    assert.deepEqual(persisted.targetProfile, browser.targetProfile);
    let controlledTarget: string | undefined;
    let replayInput: ReturnType<typeof replayInputFromPersistedRun> | undefined;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        readTarget: async () => browserTarget(browser.browserCaseProfile!),
        assertTargetControl: async (_scope, targetId) => {
          controlledTarget = targetId;
          return lease(targetId ?? "missing", "browser-lease");
        },
        replayPersistedRun: (run) => {
          replayInput = replayInputFromPersistedRun(run);
          return browser;
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      assert.equal((await post(base, `/runs/${browser.id}/replay`, "run.replay")).status, 202);
      assert.equal(controlledTarget, "browser-chat");
      assert.equal(replayInput?.targetKind, "browser");
      assert.equal(replayInput?.browserTargetId, "browser-chat");
      assert.equal(replayInput?.serial, undefined);
      assert.equal(replayInput?.platform, undefined);
      assert.deepEqual(replayInput?.targetProfile, browser.targetProfile);
      assert.deepEqual(replayInput?.artifacts, persisted.artifacts);
      assert.notEqual(replayInput?.artifacts, persisted.artifacts);
    } finally {
      await server.close();
    }
  });
});

test("browser environment drift stops retry before target control", async () => {
  await withIsolatedRunState(async () => {
    const current = scopedTestJob({
      id: "browser-profile-drift",
      target: { kind: "browser", targetId: "browser-chat", platform: "browser" },
      profile: true,
    });
    await persistRun(current);
    let controls = 0;
    let retried = 0;
    let replayed = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => current,
        readTarget: async () => browserTarget({ ...current.browserCaseProfile!, locale: "en-US" }),
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("browser profile drift must stop before target control");
        },
        retryJob: () => {
          retried += 1;
          return current;
        },
        replayPersistedRun: () => {
          replayed += 1;
          return current;
        },
      },
    });
    try {
      for (const [path, operation] of [
        [`/jobs/${current.id}/retry`, "job.retry"],
        [`/runs/${current.id}/replay`, "run.replay"],
      ] as const) {
        const response = await post(`http://127.0.0.1:${server.port}`, path, operation);
        assert.equal(response.status, 409);
        const body = (await response.json()) as { code?: string; error?: string };
        assert.equal(body.code, "TARGET_PROFILE_TARGET_MISMATCH");
        assert.match(body.error ?? "", /has drifted since this Run/i);
      }
      assert.equal(controls, 0);
      assert.equal(retried, 0);
      assert.equal(replayed, 0);
    } finally {
      await server.close();
    }
  });
});

test("a divergent executable browser profile stops retry before target control", async () => {
  await withIsolatedRunState(async () => {
    const current = scopedTestJob({
      id: "browser-executable-profile-drift",
      target: { kind: "browser", targetId: "browser-chat", platform: "browser" },
      profile: true,
    });
    current.browserCaseProfile = { ...current.browserCaseProfile!, timezoneId: "Europe/Rome" };
    let controls = 0;
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        getJob: () => current,
        assertTargetControl: async () => {
          controls += 1;
          throw new Error("executable profile drift must stop before target control");
        },
        retryJob: () => current,
      },
    });
    try {
      const response = await post(
        `http://127.0.0.1:${server.port}`,
        `/jobs/${current.id}/retry`,
        "job.retry",
      );
      await assertReviewRequired(response, /queued browser case profile no longer matches/i);
      assert.equal(controls, 0);
    } finally {
      await server.close();
    }
  });
});
