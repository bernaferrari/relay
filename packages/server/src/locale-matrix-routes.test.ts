import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { getActiveJobs, runWithOperationContext, saveRecipe, type Recipe } from "@relay/core";
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
