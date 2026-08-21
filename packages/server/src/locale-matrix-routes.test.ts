import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  createAppMap,
  getActiveJobs,
  mutateStoredAppMap,
  resetControlDatabaseCache,
  runWithOperationContext,
  saveRecipe,
  type Recipe,
} from "@relay/core";
import type { DeviceLease, LocalAgentDeviceExecutionTargetRef } from "@relay/protocol";
import { startServer } from "./index.js";

function target(targetId: string, platform: "android" | "ios"): LocalAgentDeviceExecutionTargetRef {
  return {
    schemaVersion: 1,
    kind: "local-device",
    provider: { key: "relay.local.agent-device", scope: "local" },
    targetId,
    platform,
    identity: { kind: "device-serial", value: targetId },
  };
}

function evidence(input: {
  target: LocalAgentDeviceExecutionTargetRef;
  testId: string;
  action: string;
  observedAt: number;
}) {
  return {
    schemaVersion: 1 as const,
    cohort: {
      targetId: input.target.targetId,
      platform: input.target.platform,
      testId: input.testId,
      action: input.action,
    },
    duration: {
      workItemDurationMs: 100,
      provenance: "observed-p95" as const,
      observedAt: input.observedAt,
      sampleCount: 20,
      maxAgeMs: 60_000,
    },
    measurement: {
      estimator: "campaign-duration-estimate" as const,
      recordSource: "persisted-runs" as const,
      durationSource: "run-wall-clock" as const,
      sampleIds: Array.from({ length: 20 }, (_, index) => `${input.target.targetId}:${index}`),
      observationWindow: { startedAt: input.observedAt - 1_000, finishedAt: input.observedAt },
    },
  };
}

test("locale local admission rejects before control and compensates a partial target lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-locale-admission-route-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const pixel = target("pixel-locale", "android");
  const ipad = target("ipad-locale", "ios");
  const calls = { assert: 0, admit: 0, release: [] as string[] };
  const leases = new Map<string, DeviceLease>();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        return [pixel, ipad].map((item) => ({
          id: item.targetId,
          serial: item.targetId,
          name: item.targetId,
          kind: "Physical device",
          booted: true,
          platform: item.platform,
        }));
      },
      async listDeviceLeases() {
        return [];
      },
      listTargetWorkers() {
        return [pixel, ipad].map((item) => ({
          workerId: `local:${item.platform}:target:${item.targetId}`,
          capacity: 1,
          active: 0,
          queued: 0,
          activeTargets: [],
          queuedTargets: [],
        }));
      },
      async assertTargetControl(scope, targetId) {
        calls.assert += 1;
        if (!targetId) throw new Error("fixture target is required");
        return {
          id: `assert:${targetId}`,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          poolId: "local",
          deviceSerial: targetId,
          ownerId: "human:locale-test",
          status: "leased" as const,
          leasedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        };
      },
      async admitTargetControl(scope, targetId) {
        calls.admit += 1;
        if (!targetId) throw new Error("fixture target is required");
        if (targetId === ipad.targetId) throw new Error("iPad target admission failed");
        const lease: DeviceLease = {
          id: `lease:${targetId}`,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          poolId: "local",
          deviceSerial: targetId,
          ownerId: "human:locale-test",
          status: "leased",
          leasedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        };
        leases.set(lease.id, lease);
        return { lease, createdByThisCall: true };
      },
      async releaseDeviceLease(leaseId) {
        calls.release.push(leaseId);
        const lease = leases.get(leaseId);
        if (!lease) throw new Error(`missing fixture lease ${leaseId}`);
        return lease;
      },
      async verifyCampaignDurationCohortEvidence({ evidence: submitted }) {
        return new Map(
          submitted.map((item) => [
            JSON.stringify([
              item.cohort.targetId,
              item.cohort.platform,
              item.cohort.testId,
              item.cohort.action,
            ]),
            structuredClone(item),
          ]),
        );
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:locale-test",
      actorKind: "human",
    });
    const bareBindings = [{ caseIndex: 0, locale: "en", executionTarget: pixel }];
    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: "not-read",
        caseTargetBindings: bareBindings,
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCAL_LOCALE_ADMISSION_REQUIRED",
    );
    assert.equal(calls.assert, 0);
    assert.equal(calls.admit, 0);

    const recipe: Recipe = {
      id: "locale-body",
      title: "Locale body",
      source: "custom",
      steps: [{ kind: "screenshot", caption: "body" }],
      createdAt: 1,
      updatedAt: 1,
    };
    await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:locale-test",
        actorKind: "human",
        organizationId: "acme",
        projectId: "mobile",
        operationId: "recipe.create",
        requestId: "locale-admission-recipe",
        idempotencyKey: "locale-admission-recipe",
        issuedAt: Date.now(),
      },
      () => saveRecipe({ ...recipe, expectedRevision: 0 }),
    );
    const scope = {
      locales: ["en", "it"],
      languagePath: [{ kind: "tap", target: { label: "App Language" } }],
      restoreAtEnd: false,
    };
    const bindings = [
      { caseIndex: 0, locale: "en", executionTarget: pixel },
      { caseIndex: 1, locale: "it", executionTarget: ipad },
    ];
    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        scope,
        caseTargetBindings: bindings,
        localAdmission: { deadlineMs: 5_000, durationEvidence: [] },
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code ===
          "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
    );
    assert.equal(calls.assert, 0, "target control must follow a successful evidence preflight");
    assert.equal(calls.admit, 0, "leases must not be minted for missing cohort evidence");

    const jobsBefore = getActiveJobs().length;
    const observedAt = Date.now();
    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        scope,
        caseTargetBindings: bindings,
        localAdmission: {
          deadlineMs: 5_000,
          durationEvidence: [
            evidence({ target: pixel, testId: recipe.id, action: recipe.id, observedAt }),
            evidence({ target: ipad, testId: recipe.id, action: recipe.id, observedAt }),
          ],
        },
      } as never),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
    assert.equal(calls.assert, 0, "explicit bindings never use the legacy one-target control path");
    assert.equal(calls.admit, 2);
    assert.deepEqual(calls.release, [`lease:${pixel.targetId}`]);
    assert.equal(
      getActiveJobs().length,
      jobsBefore,
      "failed lease admission must stage no locale jobs",
    );
  } finally {
    await server.close();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("locale materialization is target-free and makes a restore case bindable before admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-locale-materialization-route-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const calls = { devices: 0, control: 0, admit: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async listDevices() {
        calls.devices += 1;
        return [];
      },
      async assertTargetControl() {
        calls.control += 1;
        throw new Error("materialization must not control a target");
      },
      async admitTargetControl() {
        calls.admit += 1;
        throw new Error("materialization must not admit a target");
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:locale-plan-test",
      actorKind: "human",
    });
    const recipe: Recipe = {
      id: "locale-plan-body",
      title: "Locale plan body",
      source: "custom",
      steps: [{ kind: "screenshot", caption: "body" }],
      createdAt: 1,
      updatedAt: 1,
    };
    await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:locale-plan-test",
        actorKind: "human",
        organizationId: "acme",
        projectId: "mobile",
        operationId: "recipe.create",
        requestId: "locale-plan-recipe",
        idempotencyKey: "locale-plan-recipe",
        issuedAt: Date.now(),
      },
      () => saveRecipe({ ...recipe, expectedRevision: 0 }),
    );
    const materialized = await client.invoke("job.locale-matrix.materialize", {
      recipe: recipe.id,
      scope: {
        locales: ["en", "it", "en"],
        languagePath: [{ kind: "tap", target: { label: "App Language" } }],
        restoreLocale: "en",
        restoreAtEnd: true,
      },
    });
    assert.equal(materialized.schemaVersion, 1);
    assert.deepEqual(materialized.scope.locales, ["en", "it"]);
    assert.deepEqual(materialized.cases, [
      { caseIndex: 0, locale: "en" },
      { caseIndex: 1, locale: "it" },
      { caseIndex: 2, locale: "en" },
    ]);
    assert.deepEqual(materialized.durationCohort, { testId: recipe.id, action: recipe.id });
    assert.deepEqual(calls, { devices: 0, control: 0, admit: 0 });

    const pixel = target("pixel-plan", "android");
    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        scope: materialized.scope,
        caseTargetBindings: materialized.cases.slice(0, 2).map((item) => ({
          ...item,
          executionTarget: pixel,
        })),
        localAdmission: { deadlineMs: 120_000, durationEvidence: [] },
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCAL_LOCALE_ADMISSION_BINDINGS_INCOMPLETE",
    );
    assert.deepEqual(calls, { devices: 0, control: 0, admit: 0 });

    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        scope: materialized.scope,
        caseTargetBindings: materialized.cases.map((item) => ({
          ...item,
          executionTarget: pixel,
        })),
        localAdmission: { deadlineMs: 120_000, durationEvidence: [] },
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code ===
          "LOCAL_COMBINE_ADMISSION_COHORT_DURATION_REQUIRED",
    );
    assert.deepEqual(calls, { devices: 0, control: 0, admit: 0 });
  } finally {
    await server.close();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("an iOS language profile rejects Android bindings before local control or lease admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-locale-profile-platform-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const calls = { control: 0, lease: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async assertTargetControl() {
        calls.control += 1;
        throw new Error("profile mismatch must not claim control");
      },
      async admitTargetControl() {
        calls.lease += 1;
        throw new Error("profile mismatch must not mint a lease");
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:locale-profile-platform",
      actorKind: "human",
    });
    const recipe: Recipe = {
      id: "locale-ios-profile-body",
      title: "Locale iOS profile body",
      source: "custom",
      steps: [{ kind: "screenshot", caption: "body" }],
      createdAt: 1,
      updatedAt: 1,
    };
    await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:locale-profile-platform",
        actorKind: "human",
        organizationId: "acme",
        projectId: "mobile",
        operationId: "recipe.create",
        requestId: "locale-ios-profile-recipe",
        idempotencyKey: "locale-ios-profile-recipe",
        issuedAt: Date.now(),
      },
      () => saveRecipe({ ...recipe, expectedRevision: 0 }),
    );
    const materialized = await client.invoke("job.locale-matrix.materialize", {
      recipe: recipe.id,
      profileId: "grok-ios",
      locales: ["en"],
    });
    assert.equal(materialized.targetPlatform, "ios");
    const android = target("pixel-profile-mismatch", "android");
    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        profileId: "grok-ios",
        scope: materialized.scope,
        caseTargetBindings: materialized.cases.map((item) => ({
          ...item,
          executionTarget: android,
        })),
        localAdmission: { deadlineMs: 120_000, durationEvidence: [] },
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
    );
    assert.deepEqual(calls, { control: 0, lease: 0 });
  } finally {
    await server.close();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("a locale start cannot spoof a serial platform or use a browser for a mobile profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-locale-legacy-platform-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const calls = { control: 0 };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    jobRouteRuntime: {
      async assertTargetControl() {
        calls.control += 1;
        throw new Error("a platform mismatch must not claim target control");
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:locale-legacy-platform",
      actorKind: "human",
    });
    const recipe: Recipe = {
      id: "locale-legacy-platform-body",
      title: "Locale legacy platform body",
      source: "custom",
      steps: [{ kind: "screenshot", caption: "body" }],
      createdAt: 1,
      updatedAt: 1,
    };
    await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "human:locale-legacy-platform",
        actorKind: "human",
        organizationId: "acme",
        projectId: "mobile",
        operationId: "recipe.create",
        requestId: "locale-legacy-platform-recipe",
        idempotencyKey: "locale-legacy-platform-recipe",
        issuedAt: Date.now(),
      },
      () => saveRecipe({ ...recipe, expectedRevision: 0 }),
    );
    const materialized = await client.invoke("job.locale-matrix.materialize", {
      recipe: recipe.id,
      profileId: "grok-ios",
      locales: ["en"],
    });

    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        profileId: "grok-ios",
        scope: materialized.scope,
        serial: "emulator-5554",
        platform: "ios",
        targetKind: "device",
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCALE_TARGET_PLATFORM_MISMATCH",
    );
    assert.equal(calls.control, 0);

    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        profileId: "grok-ios",
        scope: materialized.scope,
        serial: "emulator-5554",
        targetKind: "browser",
      } as never),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
    assert.equal(calls.control, 0);

    await assert.rejects(
      client.invoke("job.locale-matrix.start", {
        recipe: recipe.id,
        profileId: "grok-ios",
        scope: materialized.scope,
        browserTargetId: "browser:cannot-spoof-ios",
        platform: "ios",
        targetKind: "browser",
      } as never),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
    );
    assert.equal(calls.control, 0);
  } finally {
    await server.close();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("a saved App Map Test materializes and starts through its saved language Variable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-test-locale-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  const at = Date.now();
  const mapId = "settings-map";
  const testId = "settings-smoke";
  try {
    await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: mapId,
      name: "Settings",
      at,
    });
    await mutateStoredAppMap("mobile", mapId, (map) => ({
      ...map,
      revision: map.revision + 1,
      updatedAt: at + 1,
      variables: {
        language: {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "language",
          name: "Language",
          kind: "language",
          apply: {
            kind: "list",
            entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
            exitPath: [{ kind: "back" }],
          },
          options: [
            { id: "en", identifier: "locale.en", label: "English" },
            { id: "it", identifier: "locale.it", label: "Italiano" },
          ],
          restoreId: "en",
          screenshotEach: true,
          createdAt: at,
          updatedAt: at,
        },
        "android-language": {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "android-language",
          name: "Android language",
          kind: "language",
          apply: { kind: "appLocale", app: "com.example.settings" },
          options: [
            { id: "en", label: "English" },
            { id: "it", label: "Italiano" },
          ],
          restoreId: "en",
          screenshotEach: true,
          createdAt: at,
          updatedAt: at,
        },
      },
      tests: {
        [testId]: {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: testId,
          name: "Settings smoke",
          kind: "scenario",
          intentSchemaVersion: 1,
          steps: [
            {
              id: "assert-settings",
              kind: "validation",
              intent: "Settings is visible",
              binding: {
                status: "resolved",
                kind: "recipe-step",
                step: {
                  kind: "expect",
                  target: { identifier: "settings-title" },
                  condition: "visible",
                },
              },
            },
          ],
          createdAt: at,
          updatedAt: at,
        },
      },
    }));

    const calls = { devices: 0, control: 0 };
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        async listDevices() {
          calls.devices += 1;
          return [];
        },
        async assertTargetControl(scope, targetId) {
          calls.control += 1;
          return {
            id: `lease:${targetId}`,
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            poolId: "local",
            deviceSerial: targetId ?? "browser:app-map-locale",
            ownerId: "human:app-map-locale",
            status: "leased" as const,
            leasedAt: Date.now(),
            expiresAt: Date.now() + 60_000,
          };
        },
      },
    });
    try {
      const client = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId: "acme",
        projectId: "mobile",
        actorId: "human:app-map-locale",
        actorKind: "human",
      });
      const materialized = await client.invoke("job.locale-matrix.materialize", {
        appMapId: mapId,
        testId,
        variableId: "language",
      });
      assert.deepEqual(materialized.source, {
        kind: "app-map-test",
        appMapId: mapId,
        testId,
        variableId: "language",
        appMapRevision: 1,
        recipeId: `app-map:${mapId}:test:${testId}:root:r1`,
      });
      assert.deepEqual(materialized.scope, {
        locales: ["en", "it"],
        entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
        exitPath: [{ kind: "back" }],
        languageOptions: {
          en: { identifier: "locale.en" },
          it: { identifier: "locale.it" },
        },
        restoreLocale: "en",
        restoreAtEnd: true,
        screenshotEachLocale: true,
      });
      assert.deepEqual(calls, { devices: 0, control: 0 });

      await assert.rejects(
        client.invoke("job.locale-matrix.start", {
          appMapId: mapId,
          testId,
          variableId: "language",
          browserTargetId: "browser:app-map-locale",
          targetKind: "browser",
        } as never),
        (error: unknown) =>
          error instanceof ApiError &&
          (error.body as { code?: unknown }).code === "LOCALE_APP_MAP_MATERIALIZATION_REQUIRED",
      );
      assert.deepEqual(calls, { devices: 0, control: 0 });

      const started = (await client.invoke("job.locale-matrix.start", {
        appMapId: mapId,
        testId,
        variableId: "language",
        expectedAppMapRevision: materialized.source.appMapRevision,
        scope: materialized.scope,
        browserTargetId: "browser:app-map-locale",
        targetKind: "browser",
      } as never)) as { jobs: Array<{ id: string }> };
      const frozen = getActiveJobs().find((job) => job.id === started.jobs[0]?.id);
      assert.equal(
        frozen?.recipeGraph?.[materialized.source.recipeId]?.id,
        materialized.source.recipeId,
      );
      assert.equal(frozen?.recipeGraph?.[materialized.source.recipeId]?.steps[0]?.kind, "expect");
      assert.deepEqual(calls, { devices: 0, control: 1 });

      await assert.rejects(
        client.invoke("job.locale-matrix.start", {
          appMapId: mapId,
          testId,
          variableId: "language",
          expectedAppMapRevision: materialized.source.appMapRevision,
          scope: { ...materialized.scope, locales: ["it"] },
          browserTargetId: "browser:app-map-locale",
          targetKind: "browser",
        } as never),
        (error: unknown) =>
          error instanceof ApiError &&
          (error.body as { code?: unknown }).code === "LOCALE_APP_MAP_SCOPE_MISMATCH",
      );
      assert.deepEqual(calls, { devices: 0, control: 1 });

      const android = await client.invoke("job.locale-matrix.materialize", {
        appMapId: mapId,
        testId,
        variableId: "android-language",
      });
      assert.equal(android.targetPlatform, "android");
      assert.equal(android.scope.appLocale, "com.example.settings");
      assert.equal(android.scope.entryPath, undefined);
      assert.deepEqual(calls, { devices: 0, control: 1 });

      await assert.rejects(
        client.invoke("job.locale-matrix.materialize", {
          appMapId: mapId,
          testId,
          variableId: "android-language",
          profileId: "grok-ios",
        }),
        (error: unknown) =>
          error instanceof ApiError &&
          (error.body as { code?: unknown }).code === "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
      );
      assert.deepEqual(calls, { devices: 0, control: 1 });
    } finally {
      await server.close();
    }
  } finally {
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    resetControlDatabaseCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("an App Map flow locale plan is revision-sealed before target control", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-flow-locale-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    runs: process.env.RELAY_RUNS_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  resetControlDatabaseCache();
  const at = Date.now();
  const mapId = "flow-map";
  try {
    await createAppMap({
      organizationId: "acme",
      projectId: "mobile",
      appMapId: mapId,
      name: "Flow map",
      at,
    });
    await mutateStoredAppMap("mobile", mapId, (map) => ({
      ...map,
      revision: map.revision + 1,
      updatedAt: at + 1,
      screens: {
        home: {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "home",
          title: "Home",
          identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
          variantIds: [],
          createdAt: at,
          updatedAt: at,
        },
        settings: {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "settings",
          title: "Settings",
          identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
          variantIds: [],
          createdAt: at,
          updatedAt: at,
        },
      },
      connections: {
        "open-settings": {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "open-settings",
          fromScreenId: "home",
          destination: { kind: "screen", screenId: "settings" },
          state: "ready",
          actions: [{ id: "tap-settings", kind: "tap", target: { label: "Settings" } }],
          createdAt: at,
          updatedAt: at,
        },
      },
      flows: {
        settings: {
          organizationId: "acme",
          projectId: "mobile",
          appMapId: mapId,
          id: "settings",
          name: "Settings",
          startScreenId: "home",
          connectionIds: ["open-settings"],
          createdAt: at,
          updatedAt: at,
        },
      },
    }));
    const calls = { devices: 0, control: 0 };
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      jobRouteRuntime: {
        async listDevices() {
          calls.devices += 1;
          return [];
        },
        async assertTargetControl() {
          calls.control += 1;
          throw new Error("stale flow plan must not control a target");
        },
      },
    });
    try {
      const client = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId: "acme",
        projectId: "mobile",
        actorId: "human:flow-locale",
        actorKind: "human",
      });
      const materialized = await client.invoke("job.locale-matrix.materialize", {
        appMapId: mapId,
        flowId: "settings",
        scope: {
          locales: ["en"],
          entryPath: [{ kind: "tap", target: { label: "Language" } }],
          restoreAtEnd: false,
        },
      });
      assert.equal(materialized.source.kind, "app-map-flow");
      assert.equal(materialized.source.appMapRevision, 1);
      assert.deepEqual(calls, { devices: 0, control: 0 });
      await mutateStoredAppMap("mobile", mapId, (map) => ({
        ...map,
        revision: map.revision + 1,
        updatedAt: at + 2,
      }));
      await assert.rejects(
        client.invoke("job.locale-matrix.start", {
          appMapId: mapId,
          flowId: "settings",
          expectedAppMapRevision: materialized.source.appMapRevision,
          scope: materialized.scope,
          browserTargetId: "browser:flow-locale",
          targetKind: "browser",
        } as never),
        (error: unknown) =>
          error instanceof ApiError &&
          (error.body as { code?: unknown }).code === "revision-conflict",
      );
      assert.deepEqual(calls, { devices: 0, control: 0 });
    } finally {
      await server.close();
    }
  } finally {
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    resetControlDatabaseCache();
    await rm(root, { recursive: true, force: true });
  }
});
