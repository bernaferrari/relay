import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";
import { setCloudDeviceProvider, setLocalDeviceProvider } from "./device-factory.js";
import { createDeterministicProviderTestDriver } from "./deterministic-provider-test-driver.js";
import { runWithOperationContext } from "./operation-context.js";
import type { Recipe } from "./recipes.js";
import { readPersistedRun } from "./runs.js";
import { prepareJobBatch, runJobSync, waitForJobCompletion } from "./session.js";
import { TargetDriverRegistry, runWithTargetDriverRegistry } from "./target-driver-registry.js";
import { runColdAppMapStartup } from "./session-provider-execution.js";

test("cold App Map startup fails with an actionable error when origin app is unbound", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cold-startup-origin-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    await assert.rejects(
      runColdAppMapStartup(
        {
          targetKind: "device",
          targetContext: { kind: "device", platform: "android", serial: "cold-origin" },
        } as never,
        {} as never,
        "cold",
        undefined,
        () => undefined,
      ),
      /no saved origin application.*Open the mapped origin explicitly.*remember it/u,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("cold App Map startup launches the frozen Test origin instead of target last-app state", async () => {
  const launched: string[] = [];
  const logs: string[] = [];
  await runColdAppMapStartup(
    {
      targetKind: "device",
      targetContext: { kind: "device", platform: "android", serial: "cold-origin" },
    } as never,
    {} as never,
    "cold",
    "com.example.origin-a",
    (line) => logs.push(line),
    async (_device, app) => {
      launched.push(app);
    },
  );
  assert.deepEqual(launched, ["com.example.origin-a"]);
  assert.match(logs[0] ?? "", /com\.example\.origin-a/u);
});

test("verified checkpoint startup does not relaunch the frozen Test origin", async () => {
  let launches = 0;
  await runColdAppMapStartup(
    {
      targetKind: "device",
      targetContext: { kind: "device", platform: "android", serial: "cold-origin" },
    } as never,
    {} as never,
    "verified-checkpoint",
    "com.example.origin-a",
    () => undefined,
    async () => {
      launches += 1;
    },
  );
  assert.equal(launches, 0);
});

test("warm startup preserves the current target and does not require an origin", async () => {
  let launches = 0;
  await runColdAppMapStartup(
    {
      targetKind: "device",
      targetContext: { kind: "device", platform: "android", serial: "cold-origin" },
    } as never,
    {} as never,
    "warm",
    undefined,
    () => undefined,
    async () => {
      launches += 1;
    },
  );
  assert.equal(launches, 0);
});

test("a registered provider session executes through driver control and capture without legacy device fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provider-driver-execution-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousAutomaticVisualEvidence = process.env.RELAY_AUTO_VISUAL_EVIDENCE;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_AUTO_VISUAL_EVIDENCE = "0";
  resetDurableWorkerAssignmentStoreForTests();

  const fixture = createDeterministicProviderTestDriver();
  const registry = new TargetDriverRegistry([fixture.driver]);
  const target = fixture.target("same-text-as-a-local-serial", "ios");
  const recipe: Recipe = {
    id: "provider-bounded-capture",
    title: "Provider bounded capture",
    source: "builtin",
    steps: [{ kind: "screenshot", caption: "provider capture" }],
    createdAt: 1,
    updatedAt: 1,
  };
  let localFactoryCalls = 0;
  let legacyCloudFactoryCalls = 0;
  setLocalDeviceProvider({
    kind: "device",
    create: () => {
      localFactoryCalls += 1;
      throw new Error("registered provider execution must not create a local AgentDevice client");
    },
  });
  setCloudDeviceProvider({
    kind: "cloud",
    provider: target.provider.key,
    create: () => {
      legacyCloudFactoryCalls += 1;
      throw new Error("registered provider execution must not use the legacy cloud device factory");
    },
  });

  try {
    const job = await runWithTargetDriverRegistry(
      registry,
      async () =>
        await runWithOperationContext(
          {
            schemaVersion: 1,
            actorId: "agent:provider-driver-test",
            actorKind: "agent",
            organizationId: "org-provider-driver-test",
            projectId: "project-provider-driver-test",
            operationId: "job.start",
            requestId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            issuedAt: Date.now(),
            leaseId: "provider-lease-42",
            leaseOwnerId: "agent:provider-lease-owner",
          },
          async () =>
            await runJobSync({
              recipe: recipe.id,
              recipeSnapshot: recipe,
              recipeGraph: { [recipe.id]: recipe },
              executionTarget: target,
              projectId: "project-provider-driver-test",
              ownerId: "agent:provider-driver-test",
            }),
        ),
    );

    assert.equal(job.status, "ok");
    assert.equal(job.serial, undefined, "a provider session never becomes a local serial");
    assert.equal(localFactoryCalls, 0);
    assert.equal(legacyCloudFactoryCalls, 0);
    assert.ok(
      fixture.events.indexOf(`control.enter:${target.provider.key}:${target.targetId}`) >= 0,
      "the registered control scope owns the run",
    );
    assert.ok(
      fixture.events.indexOf(`capture.enter:${target.provider.key}:${target.targetId}`) >= 0,
      "the registered capture scope owns the run",
    );
    assert.ok(
      fixture.events.includes(`capture.screenshot:${target.targetId}`),
      "the bounded recipe captured through the provider Device facade",
    );
    assert.ok(
      fixture.events.indexOf(`control.enter:${target.provider.key}:${target.targetId}`) <
        fixture.events.indexOf(`capture.enter:${target.provider.key}:${target.targetId}`),
    );
    assert.ok(
      fixture.events.indexOf(`capture.enter:${target.provider.key}:${target.targetId}`) <
        fixture.events.indexOf(`capture.screenshot:${target.targetId}`),
    );

    const persisted = await readPersistedRun(job.id);
    assert.ok(persisted);
    assert.deepEqual(persisted.executionTarget, target);
    assert.equal(persisted.executionProvenance?.leaseId, "provider-lease-42");
    assert.deepEqual(
      persisted.artifacts.find((artifact) => artifact.kind === "target-driver-execution")?.data,
      {
        schemaVersion: 1,
        target,
        provider: target.provider,
        capabilities: ["control", "capture"],
        lease: { id: "provider-lease-42", ownerId: "agent:provider-lease-owner" },
      },
    );

    const assignment = durableWorkerAssignmentStore().get(job.id);
    assert.ok(assignment);
    assert.equal(assignment.status, "ok");
    assert.deepEqual(assignment.executionTarget, target);
    assert.deepEqual(assignment.lease, {
      leaseId: "provider-lease-42",
      ownerId: "agent:provider-lease-owner",
      actorId: "agent:provider-driver-test",
    });
    assert.match(
      assignment.lane.workerId,
      /^remote:relay\.test\.deterministic-provider:ios:target:/u,
    );
  } finally {
    setLocalDeviceProvider(undefined);
    setCloudDeviceProvider(undefined);
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousAutomaticVisualEvidence === undefined)
      delete process.env.RELAY_AUTO_VISUAL_EVIDENCE;
    else process.env.RELAY_AUTO_VISUAL_EVIDENCE = previousAutomaticVisualEvidence;
    await rm(root, { recursive: true, force: true });
  }
});

test("a queued provider job keeps its admitted driver after the registry rotates", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provider-driver-rotation-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousAutomaticVisualEvidence = process.env.RELAY_AUTO_VISUAL_EVIDENCE;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_AUTO_VISUAL_EVIDENCE = "0";
  resetDurableWorkerAssignmentStoreForTests();

  const admitted = createDeterministicProviderTestDriver();
  const replacement = createDeterministicProviderTestDriver();
  const registry = new TargetDriverRegistry([admitted.driver]);
  const target = admitted.target("provider-session-rotation", "ios");
  const recipe: Recipe = {
    id: "provider-queued-rotation",
    title: "Provider queued rotation",
    source: "builtin",
    steps: [{ kind: "screenshot", caption: "admitted driver capture" }],
    createdAt: 1,
    updatedAt: 1,
  };
  let localFactoryCalls = 0;
  setLocalDeviceProvider({
    kind: "device",
    create: () => {
      localFactoryCalls += 1;
      throw new Error("a rotated provider registry must not fall back locally");
    },
  });

  try {
    const batch = runWithTargetDriverRegistry(registry, () =>
      runWithOperationContext(
        {
          schemaVersion: 1,
          actorId: "agent:provider-driver-rotation",
          actorKind: "agent",
          organizationId: "org-provider-driver-rotation",
          projectId: "project-provider-driver-rotation",
          operationId: "job.start",
          requestId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          issuedAt: Date.now(),
        },
        () =>
          prepareJobBatch([
            {
              input: {
                recipe: recipe.id,
                recipeSnapshot: recipe,
                recipeGraph: { [recipe.id]: recipe },
                executionTarget: target,
                projectId: "project-provider-driver-rotation",
                ownerId: "agent:provider-driver-rotation",
              },
            },
          ]),
      ),
    );

    assert.equal(registry.unregister(target.provider), true);
    registry.register(replacement.driver);
    const [job] = batch.commit();
    assert.ok(job);
    const completed = await waitForJobCompletion(job.id);

    assert.equal(completed.status, "ok");
    assert.equal(localFactoryCalls, 0);
    assert.ok(
      admitted.events.includes(`capture.screenshot:${target.targetId}`),
      "the driver selected at admission runs the queued job",
    );
    assert.equal(replacement.events.length, 0, "the replacement driver never receives queued work");
  } finally {
    setLocalDeviceProvider(undefined);
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousAutomaticVisualEvidence === undefined)
      delete process.env.RELAY_AUTO_VISUAL_EVIDENCE;
    else process.env.RELAY_AUTO_VISUAL_EVIDENCE = previousAutomaticVisualEvidence;
    await rm(root, { recursive: true, force: true });
  }
});
