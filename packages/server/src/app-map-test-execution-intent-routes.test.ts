import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapCompiledTest } from "@relay/protocol";
import {
  createAppMapTestExecutionIntent,
  parseAppMapTestExecutionIntentArtifact,
  preflightCompiledAppMapTestOffline,
  persistRun,
  resetControlDatabaseCache,
  type Recipe,
  type TestJob,
} from "@relay/core";
import { startServer } from "./index.js";

function headers(operationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "local",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:intent-gate-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

function legacyTestJob(id: string, status: TestJob["status"] = "error"): TestJob {
  const at = 1;
  const root: Recipe = {
    id: "app-map:settings:test:smoke:root",
    title: "Smoke",
    source: "custom",
    steps: [],
    createdAt: at,
    updatedAt: at,
  };
  const plan = {
    schemaVersion: 1,
    appMapId: "settings",
    appMapRevision: 7,
    test: { id: "smoke", name: "Smoke", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: root.id,
    recipes: {
      [root.id]: { id: root.id, title: root.title, parameters: [], steps: [] },
    },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  } satisfies AppMapCompiledTest;
  return {
    id,
    action: root.id,
    recipeId: root.id,
    title: root.title,
    targetContext: { kind: "device", platform: "android", serial: "android-1" },
    serial: "android-1",
    platform: "android",
    targetKind: "device",
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
    recipeSnapshot: root,
    recipeGraph: { [root.id]: root },
    artifacts: [{ kind: "app-map-test-plan", capturedAt: at, data: plan }],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

function scopedRepairJob(id: string): TestJob {
  const at = 1;
  const recovery: Recipe = {
    id: "usage:recover",
    title: "Usage recovery",
    source: "custom",
    steps: [
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint: "a".repeat(64),
        observations: [
          {
            fingerprint: "a".repeat(64),
            nodes: [{ role: "button", label: "Usage" }],
            volatileSignals: [],
          },
        ],
      },
      {
        kind: "tap",
        target: { label: "Usage" },
        navigationContract: {
          connectionId: "open-usage",
          expectedScreenId: "usage",
          expectedFingerprint: "b".repeat(64),
          evidenceIds: ["usage-evidence"],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const warm: Recipe = {
    id: "usage:warm",
    title: "Usage warm",
    source: "custom",
    steps: [{ kind: "module", recipeId: recovery.id }],
    createdAt: at,
    updatedAt: at,
  };
  const root: Recipe = {
    id: "settings",
    title: "Settings",
    source: "custom",
    steps: [
      {
        kind: "module",
        recipeId: warm.id,
        check: {
          id: "usage",
          title: "Usage",
          transitionDependencies: [
            {
              connectionId: "open-usage",
              originScreenId: "settings",
              destination: { kind: "screen", screenId: "usage" },
            },
          ],
        },
      },
    ],
    createdAt: at,
    updatedAt: at,
  };
  const graph = { [root.id]: root, [warm.id]: warm, [recovery.id]: recovery };
  const recipeProjection = (recipe: Recipe) => ({
    id: recipe.id,
    title: recipe.title,
    parameters: [],
    steps: recipe.steps,
  });
  const plan = {
    schemaVersion: 1,
    appMapId: "settings",
    appMapRevision: 7,
    test: { id: "smoke", name: "Smoke", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: root.id,
    recipes: Object.fromEntries(
      Object.values(graph).map((recipe) => [recipe.id, recipeProjection(recipe)]),
    ),
    stepProvenance: [],
    performance: {
      executableOperations: 4,
      moduleCalls: 2,
      operationCounts: { module: 2, "expect-screen": 1, tap: 1 },
      screenshotCount: 0,
      destinationProofCount: 1,
    },
    startup: { mode: "cold" },
  } satisfies AppMapCompiledTest;
  const preflight = preflightCompiledAppMapTestOffline(plan);
  assert.equal(preflight.summary.blockers, 0);
  const executionIntent = createAppMapTestExecutionIntent({ plan, recipeGraph: graph, preflight });
  return {
    id,
    action: root.id,
    recipeId: root.id,
    title: root.title,
    targetContext: { kind: "device", platform: "android", serial: "android-1" },
    serial: "android-1",
    platform: "android",
    targetKind: "device",
    status: "error",
    queuedAt: at,
    startedAt: at,
    finishedAt: at + 1,
    logs: [],
    attempts: 1,
    steps: [],
    frames: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    recipeSnapshot: root,
    recipeGraph: graph,
    artifacts: [
      { kind: "app-map-test-execution-intent", capturedAt: at, data: executionIntent },
      { kind: "app-map-test-plan", capturedAt: at, data: plan },
      {
        kind: "campaign-check-evidence",
        capturedAt: at,
        data: { checkId: "usage", error: "Usage moved", attempts: [], nodes: [] },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at,
        data: {
          id: "usage",
          title: "Usage",
          status: "failed",
          error: "Usage moved",
          startedAt: at,
          finishedAt: at + 1,
        },
      },
    ],
    resolvedInputs: {},
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

async function assertReviewRequired(response: Response): Promise<void> {
  assert.equal(response.status, 409);
  const body = (await response.json()) as { code?: string; error?: string };
  assert.equal(body.code, "APP_MAP_TEST_EXECUTION_INTENT_REVIEW_REQUIRED");
  assert.match(body.error ?? "", /needs review/i);
}

test("legacy parser-valid Test retries, replay, resume, and repair stop before target control", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-intent-routes-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_RUNS_DIR = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const retrySource = legacyTestJob("legacy-job");
  const pausedSource = legacyTestJob("legacy-paused", "paused");
  const persisted = legacyTestJob("legacy-run");
  await persistRun(persisted);
  let controls = 0;
  let retried = 0;
  let resumed = 0;
  let replayed = 0;
  let enqueued = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob: (id) => (id === "legacy-paused" ? pausedSource : retrySource),
      assertTargetControl: async () => {
        controls += 1;
        throw new Error("target control must not run");
      },
      retryJob: () => {
        retried += 1;
        return retrySource;
      },
      resumeJob: () => {
        resumed += 1;
        return pausedSource;
      },
      replayPersistedRun: () => {
        replayed += 1;
        return retrySource;
      },
    },
    runRouteRuntime: {
      assertTargetControl: async () => {
        controls += 1;
        throw new Error("target control must not run");
      },
      enqueueJob: () => {
        enqueued += 1;
        return retrySource;
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await assertReviewRequired(
      await fetch(`${base}/jobs/legacy-job/retry`, {
        method: "POST",
        headers: headers("job.retry"),
        body: "{}",
      }),
    );
    await assertReviewRequired(
      await fetch(`${base}/jobs/legacy-paused/resume`, {
        method: "POST",
        headers: headers("job.resume"),
        body: "{}",
      }),
    );
    await assertReviewRequired(
      await fetch(`${base}/jobs`, {
        method: "POST",
        headers: headers("job.start"),
        body: JSON.stringify({ recipe: "ignored-by-retry", retryOf: "legacy-job" }),
      }),
    );
    await assertReviewRequired(
      await fetch(`${base}/runs/legacy-run/replay`, {
        method: "POST",
        headers: headers("run.replay"),
        body: "{}",
      }),
    );
    await assertReviewRequired(
      await fetch(`${base}/runs/legacy-run/checks/missing/retry`, {
        method: "POST",
        headers: headers("run.repair.retry"),
        body: "{}",
      }),
    );
    assert.equal(controls, 0);
    assert.equal(retried, 0);
    assert.equal(resumed, 0);
    assert.equal(replayed, 0);
    assert.equal(enqueued, 0);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("a scoped Test repair mints a new immutable repair intent before enqueue", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-scoped-repair-intent-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_RUNS_DIR = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const source = scopedRepairJob("scoped-run");
  await persistRun(source);
  let controls = 0;
  let enqueued = false;
  let queuedArtifacts: Array<{ kind: string; data: unknown }> | undefined;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    runRouteRuntime: {
      assertTargetControl: async () => {
        controls += 1;
        return {
          id: "lease",
          projectId: "local",
          poolId: "local",
          deviceSerial: "android-1",
          ownerId: "agent:intent-gate-test",
          status: "leased" as const,
          leasedAt: 1,
          expiresAt: Date.now() + 60_000,
        };
      },
      enqueueJob: (input) => {
        enqueued = true;
        queuedArtifacts = input.artifacts;
        return source;
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const response = await fetch(`${base}/runs/scoped-run/checks/usage/retry`, {
      method: "POST",
      headers: headers("run.repair.retry"),
      body: "{}",
    });
    assert.equal(response.status, 202);
    assert.equal(controls, 1);
    assert.ok(enqueued);
    const intentArtifact = queuedArtifacts?.[0];
    assert.equal(intentArtifact?.kind, "app-map-test-execution-intent");
    const intent = parseAppMapTestExecutionIntentArtifact(intentArtifact);
    assert.ok(intent);
    assert.equal(intent.plan.rootRecipeId, "repair:scoped-run:usage");
    assert.equal(intent.plan.startup.mode, "verified-checkpoint");
    assert.equal(queuedArtifacts?.[1]?.kind, "app-map-test-plan");
    assert.deepEqual(queuedArtifacts?.[1]?.data, intent.plan);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("a valid scoped Test crosses every retry and replay entry point", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-scoped-intent-routes-"));
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_RUNS_DIR = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const retriable = scopedRepairJob("scoped-job");
  const resumable = structuredClone(retriable);
  resumable.id = "scoped-paused";
  resumable.status = "paused";
  delete resumable.finishedAt;
  await persistRun({ ...scopedRepairJob("scoped-replay"), id: "scoped-replay" });
  let controls = 0;
  let retried = 0;
  let resumed = 0;
  let replayed = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob: (id) => (id === "scoped-paused" ? resumable : retriable),
      assertTargetControl: async () => {
        controls += 1;
        return {
          id: `lease-${controls}`,
          projectId: "local",
          poolId: "local",
          deviceSerial: "android-1",
          ownerId: "agent:intent-gate-test",
          status: "leased" as const,
          leasedAt: 1,
          expiresAt: Date.now() + 60_000,
        };
      },
      retryJob: () => {
        retried += 1;
        return retriable;
      },
      resumeJob: () => {
        resumed += 1;
        return resumable;
      },
      replayPersistedRun: () => {
        replayed += 1;
        return retriable;
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    assert.equal(
      (
        await fetch(`${base}/jobs/scoped-job/retry`, {
          method: "POST",
          headers: headers("job.retry"),
          body: "{}",
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await fetch(`${base}/jobs/scoped-paused/resume`, {
          method: "POST",
          headers: headers("job.resume"),
          body: "{}",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/jobs`, {
          method: "POST",
          headers: headers("job.start"),
          body: JSON.stringify({ recipe: retriable.action, retryOf: "scoped-job" }),
        })
      ).status,
      202,
    );
    assert.equal(
      (
        await fetch(`${base}/runs/scoped-replay/replay`, {
          method: "POST",
          headers: headers("run.replay"),
          body: "{}",
        })
      ).status,
      202,
    );
    assert.equal(
      controls,
      3,
      "resume keeps its existing job control rather than taking a new lease",
    );
    assert.equal(retried, 2);
    assert.equal(resumed, 1);
    assert.equal(replayed, 1);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
