import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  cancelJob,
  createAppMap,
  enqueueJob,
  getJob,
  mutateStoredAppMap,
  persistRun,
  prepareJobBatch,
  listJobs,
  readAppMap,
  replayPersistedRun,
  resetControlDatabaseCache,
  resumeJob,
  retryJob,
  runWithOperationContext,
  saveBrowserAuthenticationFixture,
  saveBrowserTarget,
  saveCompatibilityMatrix,
  saveRecipe,
  waitForJobCompletion,
  type Recipe,
  type TestJob,
} from "@relay/core";
import {
  compileBrowserEnvironment,
  LOCAL_BROWSER_PROVIDER_KEY,
  type DeviceLease,
} from "@relay/protocol";
import { startServer } from "./index.js";
import { enqueueCompatibilityBatch } from "./compatibility-jobs.js";
import { defaultSchedulerRuntime, runDueSchedules } from "./scheduler.js";
import type { RequestContext } from "./security.js";

function lease(targetId: string): DeviceLease {
  return {
    id: `lease:${targetId}`,
    organizationId: "acme",
    projectId: "mobile",
    poolId: "local",
    deviceSerial: targetId,
    ownerId: "human:designer",
    controlScope: "local-project",
    status: "leased",
    leasedAt: 1,
    expiresAt: Date.now() + 60_000,
  };
}

const unsignedEnvironment = compileBrowserEnvironment({ engine: "chromium" });

const shopScope: RequestContext = {
  subject: "human:designer",
  organizationId: "acme",
  projectId: "mobile",
  allowedProjects: ["mobile"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

const shopOperation = {
  schemaVersion: 1 as const,
  actorId: "human:designer",
  actorKind: "human" as const,
  organizationId: "acme",
  projectId: "mobile",
  operationId: "job.soak.start",
  requestId: "soak-auth-health",
  idempotencyKey: "soak-auth-health",
  issuedAt: 1,
};

async function rememberHealth(
  root: string,
  reference: string,
  health: { status: string; checkedAt: number; detail: string; signedIn?: boolean },
): Promise<void> {
  await mkdir(join(root, ".relay"), { recursive: true });
  await writeFile(
    join(root, ".relay", "browser-auth-health.json"),
    `${JSON.stringify({ schemaVersion: 1, entries: { [reference]: health } })}\n`,
  );
}

async function saveShopMap(
  client: RelayClient,
  input: { memberProfileId: string; fixtureId?: string },
): Promise<{ revision: number }> {
  await saveBrowserTarget({
    id: "shop-web",
    name: "Shop",
    startUrl: "https://example.test/",
    environment: unsignedEnvironment,
  });
  await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
  await client.invoke("app-map.screen.add", {
    appMapId: "store",
    expectedRevision: 0,
    screen: {
      id: "home",
      title: "Home",
      identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
    },
  });
  const created = await client.invoke("app-map.test.save", {
    appMapId: "store",
    testId: "script-only",
    expectedRevision: 1,
    test: {
      name: "Prepare once",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [
        {
          id: "prepare",
          kind: "script",
          intent: "Prepare without a selector",
          binding: { status: "resolved", kind: "script", source: "return true" },
        },
      ],
    } as never,
  });
  const variableSaved = await client.invoke("app-map.variable.save", {
    appMapId: "store",
    variableId: "language",
    expectedRevision: created.appMap.revision,
    variable: {
      name: "Language",
      kind: "language",
      apply: { kind: "appLocale", app: "com.example" },
      options: [{ id: "en", label: "English" }],
    } as never,
  });
  await mutateStoredAppMap("mobile", "store", (current) => {
    const next = structuredClone(current);
    next.screenVariants["home-web"] = {
      id: "home-web",
      organizationId: next.organizationId,
      projectId: next.projectId,
      appMapId: next.id,
      screenId: "home",
      targetProfile: {
        id: "browser:shop-web",
        targetId: "shop-web",
        source: "browser",
        platform: "browser",
        name: "Shop unsigned",
        capabilities: ["snapshot"],
        observedAt: 1,
        browserCaseProfile: unsignedEnvironment,
      },
      observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      evidenceIds: [],
      evidenceUris: [],
      createdAt: 1,
      updatedAt: 1,
    };
    next.screenVariants["home-member"] = {
      id: "home-member",
      organizationId: next.organizationId,
      projectId: next.projectId,
      appMapId: next.id,
      screenId: "home",
      targetProfile: {
        id: input.memberProfileId,
        targetId: "shop-web",
        source: "browser",
        platform: "browser",
        name: "Shop member",
        capabilities: ["snapshot"],
        observedAt: 1,
        browserCaseProfile: compileBrowserEnvironment({
          engine: "chromium",
          ...(input.fixtureId ? { authenticationFixtureId: input.fixtureId } : {}),
        }),
      },
      observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      evidenceIds: [],
      evidenceUris: [],
      createdAt: 1,
      updatedAt: 1,
    };
    next.screens.home!.variantIds = ["home-web", "home-member"];
    next.revision = variableSaved.appMap.revision + 1;
    next.updatedAt += 1;
    return next;
  });
  const map = await readAppMap("mobile", "store");
  if (!map) throw new Error("expected store App Map");
  await client.invoke("app-map.combine.save", {
    appMapId: "store",
    combineId: "daily",
    expectedRevision: map.revision,
    combine: {
      name: "Daily",
      variableIds: ["language"],
      testIds: ["script-only"],
      selected: { language: ["en"] },
      strategy: "zip",
      cellRuntimeProfiles: [
        { testId: "script-only", values: { language: "en" }, targetProfileId: "browser:shop-web" },
      ],
    } as never,
  });
  await client.invoke("lane.save", {
    id: "shop-daily",
    appMapId: "store",
    target: { kind: "browser", browserTargetId: "shop-web" },
    targetProfileId: "browser:shop-web",
    actorId: "human:designer",
  });
  return { revision: (await readAppMap("mobile", "store"))!.revision };
}

function isAccountNeedsRelogin(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    (error.body as { code?: unknown }).code === "ACCOUNT_NEEDS_RELOGIN" &&
    /lab probe failed/u.test(error.message)
  );
}

async function drainJob(id: string): Promise<void> {
  cancelJob(id);
  await waitForJobCompletion(id);
}

async function saveShopNav(client: RelayClient): Promise<void> {
  const map = await readAppMap("mobile", "store");
  if (!map) throw new Error("expected store App Map");
  const next = await client.invoke("app-map.screen.add", {
    appMapId: "store",
    expectedRevision: map.revision,
    screen: {
      id: "next",
      title: "Next",
      identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
    },
  });
  const connected = await client.invoke("app-map.connection.create", {
    appMapId: "store",
    expectedRevision: next.appMap.revision,
    connection: {
      id: "open-next",
      fromScreenId: "home",
      destination: { kind: "screen", screenId: "next" },
      state: "ready",
      actions: [{ id: "go", kind: "tap", target: { label: "Next" } }],
    },
  });
  await client.invoke("app-map.flow.save", {
    appMapId: "store",
    flowId: "main",
    expectedRevision: connected.appMap.revision,
    flow: {
      name: "Main",
      startScreenId: "home",
      connectionIds: ["open-next"],
    },
  });
}

async function saveSleepRecipe(): Promise<{ id: string }> {
  return saveRecipe({
    id: "sleep-once",
    expectedRevision: 0,
    title: "Sleep once",
    steps: [{ kind: "sleep", ms: 1 }],
  });
}

async function persistSuperGrokRun(input: {
  fixtureReference: string;
  environment: ReturnType<typeof compileBrowserEnvironment>;
  health: { status: "error" | "ready"; checkedAt: number; detail: string; signedIn?: boolean };
}): Promise<{ id: string }> {
  const at = Date.now();
  const recipe = {
    id: "sleep-once",
    title: "Sleep once",
    source: "custom" as const,
    steps: [{ kind: "sleep" as const, ms: 1 }],
    createdAt: at,
    updatedAt: at,
  };
  const targetProfile = {
    id: "browser:shop-web",
    targetId: "shop-web",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Shop",
    capabilities: ["snapshot" as const],
    observedAt: 1,
    browserCaseProfile: input.environment,
  };
  const persisted = await persistRun({
    id: crypto.randomUUID(),
    action: recipe.id,
    recipeId: recipe.id,
    recipeSnapshot: recipe,
    recipeGraph: { [recipe.id]: recipe },
    platform: "android",
    targetKind: "browser",
    browserTargetId: "shop-web",
    browserCaseProfile: input.environment,
    targetProfile,
    targetContext: { kind: "browser", platform: "browser", targetId: "shop-web" },
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" },
      targetId: "shop-web",
      platform: "browser",
      identity: { kind: "browser-target", value: "shop-web" },
    },
    authenticationHealth: input.health,
    status: "error",
    error: input.health.detail,
    queuedAt: at - 20,
    startedAt: at - 10,
    finishedAt: at,
    logs: ["fail"],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Sleep once",
    resolvedInputs: {},
    projectId: "mobile",
    ownerId: "human:designer",
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob);
  return { id: persisted.id };
}

function pausedShopBrowserJob(input: {
  environment: ReturnType<typeof compileBrowserEnvironment>;
  health?: { status: "error" | "ready"; checkedAt: number; detail: string; signedIn?: boolean };
}): TestJob {
  const at = Date.now();
  const recipe = {
    id: "sleep-once",
    title: "Sleep once",
    source: "custom" as const,
    steps: [{ kind: "sleep" as const, ms: 1 }],
    createdAt: at,
    updatedAt: at,
  };
  const targetProfile = {
    id: "browser:shop-web",
    targetId: "shop-web",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Shop",
    capabilities: ["snapshot" as const],
    observedAt: 1,
    browserCaseProfile: input.environment,
  };
  return {
    id: crypto.randomUUID(),
    action: recipe.id,
    recipeId: recipe.id,
    recipeSnapshot: recipe,
    recipeGraph: { [recipe.id]: recipe },
    platform: "android",
    targetKind: "browser",
    browserTargetId: "shop-web",
    browserCaseProfile: input.environment,
    targetProfile,
    targetContext: { kind: "browser", platform: "browser", targetId: "shop-web" },
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" },
      targetId: "shop-web",
      platform: "browser",
      identity: { kind: "browser-target", value: "shop-web" },
    },
    ...(input.health ? { authenticationHealth: input.health } : {}),
    status: "paused",
    queuedAt: at - 20,
    startedAt: at - 10,
    logs: ["paused"],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Sleep once",
    resolvedInputs: {},
    projectId: "mobile",
    ownerId: "human:designer",
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as TestJob;
}

async function withAuthHealthServer(
  root: string,
  run: (input: {
    client: RelayClient;
    calls: {
      enqueue: number;
      retry: number;
      replay: number;
      prepare: number;
      resume: number;
      step: number;
    };
    pausedJobs: Map<string, TestJob>;
  }) => Promise<void>,
): Promise<void> {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const previousRecipes = process.env.RELAY_RECIPES_DIR;
  const previousTests = process.env.RELAY_TESTS_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  const calls = { enqueue: 0, retry: 0, replay: 0, prepare: 0, resume: 0, step: 0 };
  const pausedJobs = new Map<string, TestJob>();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      getJob(id) {
        return pausedJobs.get(id) ?? getJob(id);
      },
      async listDevices() {
        return [];
      },
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return lease(targetId);
      },
      async admitTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return { lease: lease(targetId), createdByThisCall: true };
      },
      enqueueJob(input) {
        calls.enqueue += 1;
        return enqueueJob(input);
      },
      prepareJobBatch(inputs) {
        calls.prepare += 1;
        return prepareJobBatch(inputs);
      },
      retryJob(id, options) {
        calls.retry += 1;
        return retryJob(id, options);
      },
      replayPersistedRun(runRecord, mode, options) {
        calls.replay += 1;
        return replayPersistedRun(runRecord, mode, options);
      },
      async resumeJob(id) {
        calls.resume += 1;
        const paused = pausedJobs.get(id);
        if (paused) {
          if (paused.status !== "paused") {
            throw new Error(`Cannot resume job in status ${paused.status}`);
          }
          paused.status = "running";
          return paused;
        }
        return resumeJob(id);
      },
    },
    stepRunRuntime: {
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return lease(targetId);
      },
      async listDevices() {
        return [
          {
            id: "ipad-1",
            serial: "ipad-1",
            name: "iPad",
            kind: "iPad",
            booted: true,
            platform: "ios",
          },
          {
            id: "shop-web",
            serial: "shop-web",
            name: "Shop",
            kind: "iPad",
            booted: true,
            platform: "ios",
          },
        ];
      },
      async devicePlatformForSerial() {
        return "ios";
      },
      async executeStep() {
        calls.step += 1;
      },
    },
    runRouteRuntime: {
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return lease(targetId);
      },
      enqueueJob(input) {
        calls.enqueue += 1;
        return enqueueJob(input);
      },
    },
    appMapTestRunRuntime: {
      async listDevices() {
        return [];
      },
      async assertTargetControl(_scope, targetId) {
        if (!targetId) throw new Error("target id is required");
        return lease(targetId);
      },
      enqueueJob(input) {
        calls.enqueue += 1;
        return enqueueJob(input);
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await run({ client, calls, pausedJobs });
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (previousRecipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previousRecipes;
    if (previousTests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previousTests;
  }
}

test("Test.run does not enqueue a claimed fixture with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-run-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 1,
        detail: "lab probe failed",
      });
      const { revision } = await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      await assert.rejects(
        () =>
          client.invoke("app-map.test.run", {
            appMapId: "store",
            testId: "script-only",
            expectedRevision: revision,
            target: { kind: "browser", targetId: "shop-web", platform: "browser" },
            targetProfileId: "browser:shop-member",
            engine: "chromium",
            account: {
              kind: "fixture",
              accountId: saved.id,
              accountRevision: String(saved.revision),
              reference: saved.reference,
            },
          }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 409 &&
          (error.body as { code?: unknown }).code === "ACCOUNT_NEEDS_RELOGIN" &&
          /lab probe failed/u.test(error.message),
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned grok-daily Test.run still enqueues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-run-unsigned-health-"));
  try {
    await withAuthHealthServer(root, async ({ client }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 1,
        detail: "lab probe failed",
      });
      await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      const queued = await client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "script-only",
        laneId: "shop-daily",
      });
      assert.ok(typeof queued.job.id === "string");
      assert.ok(queued.job.status === "queued" || queued.job.status === "running");
      assert.equal(queued.job.authenticationHealth, undefined);
      cancelJob(queued.job.id);
      await waitForJobCompletion(queued.job.id);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Combine-cell start does not enqueue a signed-in profile with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-cell-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 1,
        detail: "lab probe failed",
      });
      await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      const map = await readAppMap("mobile", "store");
      if (!map) throw new Error("expected store App Map");
      await client.invoke("app-map.combine.save", {
        appMapId: "store",
        combineId: "lab",
        expectedRevision: map.revision,
        combine: {
          name: "Lab",
          variableIds: ["language"],
          testIds: ["script-only"],
          selected: { language: ["en"] },
          strategy: "zip",
          cellRuntimeProfiles: [
            {
              testId: "script-only",
              values: { language: "en" },
              targetProfileId: "browser:shop-member",
            },
          ],
        } as never,
      });
      await assert.rejects(
        () =>
          client.invoke("job.combine.start", {
            appMapId: "store",
            combineId: "lab",
            executionMode: "all",
            browserTargetId: "shop-web",
            targetKind: "browser",
            defaultTargetProfileId: "browser:shop-member",
          }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 409 &&
          (error.body as { code?: unknown }).code === "ACCOUNT_NEEDS_RELOGIN" &&
          /lab probe failed/u.test(error.message),
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned Combine start still queues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 1,
        detail: "lab probe failed",
      });
      await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      const started = await client.invoke("job.combine.start", {
        appMapId: "store",
        combineId: "daily",
        executionMode: "all",
        laneId: "shop-daily",
      });
      assert.ok((started.jobs as Array<{ id?: string }>).length >= 1);
      for (const job of (started.jobs as Array<{ id?: string }>) ?? []) {
        if (!job.id) continue;
        cancelJob(job.id);
        await waitForJobCompletion(job.id);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function saveBlockedSuperGrok(root: string): Promise<{
  id: string;
  reference: string;
  revision: number;
}> {
  const saved = await saveBrowserAuthenticationFixture({
    projectId: "mobile",
    targetId: "shop-web",
    name: "SuperGrok",
    createdBy: "human:qa",
    storageState: {
      cookies: [],
      origins: [{ origin: "https://example.test", localStorage: [] }],
    },
  });
  await rememberHealth(root, saved.reference, {
    status: "error",
    checkedAt: 1,
    detail: "lab probe failed",
  });
  return saved;
}

test("flow.run and connection.run do not enqueue a signed-in target with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-flow-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      await saveShopNav(client);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      await assert.rejects(
        () =>
          client.invoke("app-map.flow.run", {
            appMapId: "store",
            flowId: "main",
            browserTargetId: "shop-web",
            targetKind: "browser",
          }),
        isAccountNeedsRelogin,
      );
      await assert.rejects(
        () =>
          client.invoke("app-map.connection.run", {
            appMapId: "store",
            connectionId: "open-next",
            browserTargetId: "shop-web",
            targetKind: "browser",
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned grok-daily flow.run still enqueues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-flow-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveShopMap(client, {
        memberProfileId: "browser:shop-member",
        fixtureId: saved.reference,
      });
      await saveShopNav(client);
      const queued = await client.invoke("app-map.flow.run", {
        appMapId: "store",
        flowId: "main",
        browserTargetId: "shop-web",
        targetKind: "browser",
      });
      assert.ok(typeof queued.job.id === "string");
      for (const job of (queued.jobs as Array<{ id?: string }>) ?? [queued.job]) {
        if (!job.id) continue;
        await drainJob(job.id);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job.start and job.matrix.start do not enqueue a signed-in target with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-start-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      const recipe = await saveSleepRecipe();
      await assert.rejects(
        () =>
          client.invoke("job.start", {
            recipe: recipe.id,
            browserTargetId: "shop-web",
            targetKind: "browser",
          }),
        isAccountNeedsRelogin,
      );
      await assert.rejects(
        () =>
          client.invoke("job.matrix.start", {
            action: recipe.id,
            recipe: recipe.id,
            browserTargetId: "shop-web",
            targetKind: "browser",
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned job.start still queues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-start-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const recipe = await saveSleepRecipe();
      const queued = await client.invoke("job.start", {
        recipe: recipe.id,
        browserTargetId: "shop-web",
        targetKind: "browser",
      });
      assert.ok(typeof queued.job.id === "string");
      assert.equal(queued.job.authenticationHealth, undefined);
      assert.ok(typeof queued.job.id === "string");
      await drainJob(queued.job.id);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job.retry does not re-enqueue SuperGrok when parent or remembered health is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-retry-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "ready",
        checkedAt: 1,
        signedIn: true,
        detail: "SuperGrok is signed in.",
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      const recipe = await saveSleepRecipe();
      const queued = await client.invoke("job.start", {
        recipe: recipe.id,
        browserTargetId: "shop-web",
        targetKind: "browser",
      });
      assert.ok(typeof queued.job.id === "string");
      await drainJob(queued.job.id);
      await rememberHealth(root, saved.reference, {
        status: "error",
        checkedAt: 2,
        detail: "lab probe failed",
      });
      const enqueueAfterStart = calls.enqueue;
      const queuedJobId = queued.job.id;
      await assert.rejects(
        () => client.invoke("job.retry", { jobId: queuedJobId }),
        isAccountNeedsRelogin,
      );
      await assert.rejects(
        () =>
          client.invoke("job.start", {
            recipe: "ignored",
            retryOf: queued.job.id,
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.retry, 0);
      assert.equal(calls.enqueue, enqueueAfterStart);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job.retry of an actually-ready fixture proceeds and stamps remembered health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-retry-ready-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "ready",
        checkedAt: 1,
        signedIn: true,
        detail: "SuperGrok is signed in.",
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      const recipe = await saveSleepRecipe();
      const queued = await client.invoke("job.start", {
        recipe: recipe.id,
        browserTargetId: "shop-web",
        targetKind: "browser",
      });
      assert.ok(typeof queued.job.id === "string");
      await drainJob(queued.job.id);
      const retried = await client.invoke("job.retry", { jobId: queued.job.id });
      assert.ok(typeof retried.job.id === "string");
      const health = retried.job.authenticationHealth;
      assert.ok(health && typeof health === "object" && "status" in health);
      assert.equal(health.status, "ready");
      assert.equal(calls.retry, 1);
      await drainJob(retried.job.id);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned job.retry still proceeds while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-retry-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const recipe = await saveSleepRecipe();
      const queued = await client.invoke("job.start", {
        recipe: recipe.id,
        browserTargetId: "shop-web",
        targetKind: "browser",
      });
      assert.ok(typeof queued.job.id === "string");
      await drainJob(queued.job.id);
      const retried = await client.invoke("job.retry", { jobId: queued.job.id });
      assert.ok(typeof retried.job.id === "string");
      await drainJob(retried.job.id);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run.replay does not re-enqueue SuperGrok when remembered health is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-replay-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      const environment = compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: saved.reference,
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment,
      });
      const run = await persistSuperGrokRun({
        fixtureReference: saved.reference,
        environment,
        health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
      });
      await assert.rejects(
        () => client.invoke("run.replay", { runId: run.id, mode: "saved-steps" }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.replay, 0);
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function saveShopBrowserMatrix(): Promise<void> {
  await saveCompatibilityMatrix({
    id: "shop-browsers",
    projectId: "mobile",
    name: "Shop browsers",
    selectors: [{ targetIds: ["shop-web"] }],
  });
}

async function persistShopRepairRun(input: {
  environment: ReturnType<typeof compileBrowserEnvironment>;
  health?: { status: "error" | "ready"; checkedAt: number; detail: string; signedIn?: boolean };
}): Promise<{ id: string; checkId: string }> {
  const at = Date.now();
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
  const recipe: Recipe = {
    id: "settings",
    title: "Settings",
    source: "custom",
    steps: [
      {
        kind: "module",
        recipeId: "usage:warm",
        check: {
          id: "usage",
          title: "Usage",
          recovery: {
            groupId: "settings:usage",
            recipeId: recovery.id,
            transitionId: "open-usage",
            mode: "warm-transition",
          },
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
  const targetProfile = {
    id: "browser:shop-web",
    targetId: "shop-web",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Shop",
    capabilities: ["snapshot" as const],
    observedAt: 1,
    browserCaseProfile: input.environment,
  };
  const id = crypto.randomUUID();
  await persistRun({
    id,
    action: recipe.id,
    recipeId: recipe.id,
    recipeSnapshot: recipe,
    recipeGraph: {
      [recipe.id]: recipe,
      [recovery.id]: recovery,
      "usage:warm": {
        id: "usage:warm",
        title: "Usage warm",
        source: "custom",
        steps: [{ kind: "module", recipeId: recovery.id }],
        createdAt: at,
        updatedAt: at,
      },
    },
    targetContext: { kind: "browser", platform: "browser", targetId: "shop-web" },
    targetKind: "browser",
    platform: "android",
    browserTargetId: "shop-web",
    browserCaseProfile: input.environment,
    targetProfile,
    executionTarget: {
      schemaVersion: 1,
      kind: "local-browser",
      provider: { key: LOCAL_BROWSER_PROVIDER_KEY, scope: "local" },
      targetId: "shop-web",
      platform: "browser",
      identity: { kind: "browser-target", value: "shop-web" },
    },
    ...(input.health ? { authenticationHealth: input.health } : {}),
    status: "error",
    error: input.health?.detail ?? "Usage moved",
    queuedAt: at - 20,
    startedAt: at - 10,
    finishedAt: at,
    logs: ["fail"],
    attempts: 1,
    steps: [],
    frames: [{ path: `runs/${id}/usage.png`, caption: "failed:usage", capturedAt: at }],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: recipe.title,
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: at - 10,
        data: { appMapId: "repair-map", appMapRevision: 1, test: { id: "smoke" } },
      },
      {
        kind: "campaign-check-evidence",
        capturedAt: at,
        data: {
          checkId: "usage",
          error: "Usage moved",
          screenIdentity: { fingerprint: "c".repeat(64) },
          attempts: [],
          nodes: [],
        },
      },
      {
        kind: "campaign-check-result",
        capturedAt: at,
        data: {
          id: "usage",
          title: "Usage",
          status: "failed",
          error: "Usage moved",
          startedAt: at - 5,
          finishedAt: at,
          selectiveRepair: { status: "pending", recipeId: recovery.id },
        },
      },
    ],
    resolvedInputs: {},
    projectId: "mobile",
    ownerId: "human:designer",
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  } as unknown as TestJob);
  await createAppMap({
    organizationId: "acme",
    projectId: "mobile",
    appMapId: "repair-map",
    name: "Repair map",
    at,
  });
  await mutateStoredAppMap("mobile", "repair-map", (map) => ({
    ...map,
    revision: 1,
    screens: {
      settings: {
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "repair-map",
        id: "settings",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
      usage: {
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "repair-map",
        id: "usage",
        title: "Usage",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
        variantIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      "open-usage": {
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "repair-map",
        id: "open-usage",
        fromScreenId: "settings",
        destination: { kind: "screen", screenId: "usage" },
        label: "Usage",
        state: "ready",
        actions: [{ id: "tap-usage", kind: "tap", target: { label: "Usage" } }],
        navigation: {
          targetAlternatives: [{ kind: "accessibility", label: "Usage" }],
          expectedDestination: {
            screenId: "usage",
            identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
            evidenceIds: ["usage-tree"],
          },
        },
        createdAt: at,
        updatedAt: at,
      },
    },
    tests: {
      smoke: {
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "repair-map",
        id: "smoke",
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "usage",
            kind: "instruction",
            intent: "Visit Usage",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["open-usage"],
            },
          },
        ],
        createdAt: at,
        updatedAt: at,
      },
    },
    updatedAt: at,
  }));
  return { id, checkId: "usage" };
}

test("job.soak.start and job.compatibility-matrix.start do not enqueue a signed-in target with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-soak-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      const recipe = await saveSleepRecipe();
      await saveShopBrowserMatrix();
      await assert.rejects(
        () =>
          client.invoke("job.compatibility-matrix.start", {
            action: recipe.id,
            recipe: recipe.id,
            matrixId: "shop-browsers",
          }),
        isAccountNeedsRelogin,
      );
      await assert.rejects(
        () =>
          client.invoke("job.soak.start", {
            recipe: recipe.id,
            matrixId: "shop-browsers",
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.prepare, 0);
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned soak still queues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-soak-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ calls }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const recipe = await saveSleepRecipe();
      await saveShopBrowserMatrix();
      const started = await runWithOperationContext(shopOperation, () =>
        enqueueCompatibilityBatch(
          shopScope,
          { recipe: recipe.id, matrixId: "shop-browsers" },
          { kind: "soak", maxRepetitions: 3, maxJobs: 20 },
          {
            async listDevices() {
              return [];
            },
            async admitTargetControl(_scope, targetId) {
              if (!targetId) throw new Error("target id is required");
              return { lease: lease(targetId), createdByThisCall: true };
            },
            async releaseDeviceLease() {
              return lease("released");
            },
            prepareJobBatch(inputs) {
              calls.prepare += 1;
              const jobs = inputs.map((item, index) => ({
                id: `soak:${index}`,
                browserTargetId: item.input.browserTargetId,
                authenticationHealth: item.input.authenticationHealth,
              }));
              return {
                jobs,
                activate: () => jobs,
                dispatch: () => jobs,
                commit: () => jobs,
                rollback() {},
              } as ReturnType<typeof prepareJobBatch>;
            },
          },
        ),
      );
      assert.ok(started.jobs.length >= 1);
      assert.equal(calls.prepare, 1);
      assert.equal(
        started.jobs.some(
          (job) => (job as { authenticationHealth?: unknown }).authenticationHealth,
        ),
        false,
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run.repair.retry does not re-enqueue SuperGrok when remembered health is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-repair-retry-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      const environment = compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: saved.reference,
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment,
      });
      const run = await persistShopRepairRun({
        environment,
        health: { status: "error", checkedAt: 1, detail: "lab probe failed" },
      });
      await assert.rejects(
        () => client.invoke("run.repair.retry", { runId: run.id, checkId: run.checkId }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned run.repair.retry still proceeds while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-repair-retry-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const run = await persistShopRepairRun({ environment: unsignedEnvironment });
      const retried = await client.invoke("run.repair.retry", {
        runId: run.id,
        checkId: run.checkId,
      });
      assert.ok(typeof retried.job.id === "string");
      assert.equal(calls.enqueue, 1);
      await drainJob(String(retried.job.id));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("action.run does not enqueue a signed-in target with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-action-run-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      const recipe = await saveSleepRecipe();
      await assert.rejects(
        () =>
          client.invoke("action.run", {
            actionId: recipe.id,
            browserTargetId: "shop-web",
            targetKind: "browser",
            wait: false,
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.enqueue, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned action.run still queues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-action-run-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const recipe = await saveSleepRecipe();
      try {
        const queued = await client.invoke("action.run", {
          actionId: recipe.id,
          browserTargetId: "shop-web",
          targetKind: "browser",
          wait: false,
        });
        assert.ok(typeof queued.job.id === "string");
        assert.equal(
          (queued.job as { authenticationHealth?: unknown }).authenticationHealth,
          undefined,
        );
        await drainJob(String(queued.job.id));
      } catch (error) {
        assert.ok(error instanceof ApiError);
        assert.notEqual((error.body as { code?: unknown }).code, "ACCOUNT_NEEDS_RELOGIN");
      }
      assert.equal(calls.enqueue, 1);
      for (const job of listJobs(50)) {
        if (job.status === "queued" || job.status === "running") await drainJob(job.id);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recipe scheduler prepareJobBatch does not enqueue a signed-in target with remembered error health", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-scheduler-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      await saveSleepRecipe();
      const failures: string[] = [];
      await runDueSchedules(2_000, {
        ...defaultSchedulerRuntime,
        listSchedules: async () => [
          {
            id: "shop-recipe",
            recipeId: "sleep-once",
            targetKind: "browser",
            targetId: "shop-web",
            platform: "browser",
            intervalMinutes: 60,
            repetitions: 1,
            enabled: true,
            projectId: "mobile",
            createdAt: 1,
            updatedAt: 1,
            nextRunAt: 1,
          },
        ],
        prepareJobBatch(inputs) {
          calls.prepare += 1;
          return prepareJobBatch(inputs);
        },
        markScheduleFailure: async (_id, error) => {
          failures.push(error);
        },
      });
      assert.equal(calls.prepare, 0);
      assert.match(failures[0] ?? "", /ACCOUNT_NEEDS_RELOGIN/u);
      assert.match(failures[0] ?? "", /lab probe failed/u);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned recipe scheduler still queues while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-scheduler-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ calls }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      await saveSleepRecipe();
      const jobs: Array<{ id?: string }> = [];
      await runDueSchedules(2_000, {
        ...defaultSchedulerRuntime,
        listSchedules: async () => [
          {
            id: "shop-daily-recipe",
            recipeId: "sleep-once",
            targetKind: "browser",
            targetId: "shop-web",
            platform: "browser",
            intervalMinutes: 60,
            repetitions: 1,
            enabled: true,
            projectId: "mobile",
            createdAt: 1,
            updatedAt: 1,
            nextRunAt: 1,
          },
        ],
        prepareJobBatch(inputs) {
          calls.prepare += 1;
          const staged = prepareJobBatch(inputs);
          jobs.push(...staged.jobs);
          return staged;
        },
      });
      assert.equal(calls.prepare, 1);
      assert.ok(jobs.length >= 1);
      for (const job of jobs) {
        if (!job.id) continue;
        await drainJob(job.id);
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job.resume does not resume SuperGrok when remembered health is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-resume-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls, pausedJobs }) => {
      const saved = await saveBlockedSuperGrok(root);
      const environment = compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: saved.reference,
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment,
      });
      const paused = pausedShopBrowserJob({
        environment,
        health: {
          status: "ready",
          checkedAt: 1,
          signedIn: true,
          detail: "SuperGrok is signed in.",
        },
      });
      pausedJobs.set(paused.id, paused);
      await assert.rejects(
        () => client.invoke("job.resume", { jobId: paused.id }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.resume, 0);
      assert.equal(paused.status, "paused");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned job.resume still proceeds while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-resume-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls, pausedJobs }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const paused = pausedShopBrowserJob({ environment: unsignedEnvironment });
      pausedJobs.set(paused.id, paused);
      const resumed = await client.invoke("job.resume", { jobId: paused.id });
      assert.equal(resumed.job.status, "running");
      assert.equal(calls.resume, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job.resume of an actually-ready SuperGrok fixture proceeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-job-resume-ready-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls, pausedJobs }) => {
      const saved = await saveBrowserAuthenticationFixture({
        projectId: "mobile",
        targetId: "shop-web",
        name: "SuperGrok",
        createdBy: "human:qa",
        storageState: {
          cookies: [],
          origins: [{ origin: "https://example.test", localStorage: [] }],
        },
      });
      await rememberHealth(root, saved.reference, {
        status: "ready",
        checkedAt: 1,
        signedIn: true,
        detail: "SuperGrok is signed in.",
      });
      const environment = compileBrowserEnvironment({
        engine: "chromium",
        authenticationFixtureId: saved.reference,
      });
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment,
      });
      const paused = pausedShopBrowserJob({
        environment,
        health: {
          status: "ready",
          checkedAt: 1,
          signedIn: true,
          detail: "SuperGrok is signed in.",
        },
      });
      pausedJobs.set(paused.id, paused);
      const resumed = await client.invoke("job.resume", { jobId: paused.id });
      assert.equal(resumed.job.status, "running");
      assert.equal(calls.resume, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("step.run does not drive SuperGrok when remembered health is blocked", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-step-run-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      const saved = await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: compileBrowserEnvironment({
          engine: "chromium",
          authenticationFixtureId: saved.reference,
        }),
      });
      await assert.rejects(
        () =>
          client.invoke("step.run", {
            serial: "shop-web",
            step: { kind: "sleep", ms: 1 },
          }),
        isAccountNeedsRelogin,
      );
      assert.equal(calls.step, 0);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned step.run still proceeds while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-step-run-unsigned-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      await saveBlockedSuperGrok(root);
      await saveBrowserTarget({
        id: "shop-web",
        name: "Shop",
        startUrl: "https://example.test/",
        environment: unsignedEnvironment,
      });
      const ran = await client.invoke("step.run", {
        serial: "shop-web",
        step: { kind: "sleep", ms: 1 },
      });
      assert.equal(ran.ok, true);
      assert.equal(calls.step, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("device step.run still proceeds while SuperGrok health is error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-step-run-device-error-health-"));
  try {
    await withAuthHealthServer(root, async ({ client, calls }) => {
      await saveBlockedSuperGrok(root);
      const ran = await client.invoke("step.run", {
        serial: "ipad-1",
        step: { kind: "sleep", ms: 1 },
      });
      assert.equal(ran.ok, true);
      assert.equal(calls.step, 1);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
