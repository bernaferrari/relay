import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDeterministicProviderTestDriver,
  durableWorkerAssignmentStore,
  readPersistedRun,
  resetControlDatabaseCache,
  resetDurableWorkerAssignmentStoreForTests,
  saveRecipe,
  setCloudDeviceProvider,
  setLocalDeviceProvider,
  TargetDriverRegistry,
  waitForJobCompletion,
} from "@relay/core";
import { startServer } from "./index.js";

function headers(operationId = "job.start"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "provider-driver-project",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:provider-driver-route-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

test("HTTP job admission dispatches a registered provider driver and never falls back to local control", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-provider-driver-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const previousTests = process.env.RELAY_TESTS_DIR;
  const previousAutomaticVisualEvidence = process.env.RELAY_AUTO_VISUAL_EVIDENCE;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  process.env.RELAY_AUTO_VISUAL_EVIDENCE = "0";
  resetControlDatabaseCache();
  resetDurableWorkerAssignmentStoreForTests();

  const fixture = createDeterministicProviderTestDriver();
  const target = fixture.target("same-text-as-local-serial", "ios");
  let localRouteControlCalls = 0;
  let localFactoryCalls = 0;
  let legacyCloudFactoryCalls = 0;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  setLocalDeviceProvider({
    kind: "device",
    create: () => {
      localFactoryCalls += 1;
      throw new Error("provider run must not construct a local AgentDevice client");
    },
  });
  setCloudDeviceProvider({
    kind: "cloud",
    provider: target.provider.key,
    create: () => {
      legacyCloudFactoryCalls += 1;
      throw new Error("provider run must not use the legacy cloud device factory");
    },
  });

  try {
    await saveRecipe({
      id: "provider-driver-http-capture",
      expectedRevision: 0,
      title: "Provider driver HTTP capture",
      steps: [{ kind: "screenshot", caption: "provider HTTP capture" }],
    });
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      targetDriverRegistry: new TargetDriverRegistry([fixture.driver]),
      jobRouteRuntime: {
        assertTargetControl: async () => {
          localRouteControlCalls += 1;
          throw new Error("provider route must not ask for a local target lease");
        },
      },
    });
    const base = `http://127.0.0.1:${server.port}`;

    const mismatched = fixture.target("same-text-as-local-serial", "ios");
    mismatched.provider = { key: "unregistered.provider", scope: "remote" };
    const rejected = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ recipe: "provider-driver-http-capture", executionTarget: mismatched }),
    });
    assert.equal(rejected.status, 409);
    const rejection = (await rejected.json()) as {
      error?: string;
      code?: string;
      capability?: string;
      reason?: string;
      provider?: unknown;
      target?: unknown;
    };
    assert.match(rejection.error ?? "", /no registered relay control driver/i);
    assert.equal(rejection.code, "TARGET_DRIVER_CAPABILITY_UNAVAILABLE");
    assert.equal(rejection.capability, "control");
    assert.equal(rejection.reason, "not-configured");
    assert.deepEqual(rejection.provider, mismatched.provider);
    assert.deepEqual(rejection.target, mismatched);
    assert.equal(localRouteControlCalls, 0);
    assert.equal(localFactoryCalls, 0);
    assert.equal(legacyCloudFactoryCalls, 0);
    assert.deepEqual(
      durableWorkerAssignmentStore().list(),
      [],
      "the rejected provider target never reaches the durable queue",
    );
    assert.equal(
      fixture.events.length,
      0,
      "a mismatched provider cannot enter the registered driver",
    );

    const accepted = await fetch(`${base}/jobs`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ recipe: "provider-driver-http-capture", executionTarget: target }),
    });
    assert.equal(accepted.status, 202);
    const body = (await accepted.json()) as { job?: { id?: string; executionTarget?: unknown } };
    const jobId = body.job?.id;
    assert.ok(jobId);
    assert.deepEqual(body.job?.executionTarget, target);

    const job = await waitForJobCompletion(jobId);
    assert.equal(job.status, "ok");
    assert.equal(localRouteControlCalls, 0);
    assert.equal(localFactoryCalls, 0);
    assert.equal(legacyCloudFactoryCalls, 0);
    assert.ok(fixture.events.includes(`control.enter:${target.provider.key}:${target.targetId}`));
    assert.ok(fixture.events.includes(`capture.enter:${target.provider.key}:${target.targetId}`));
    assert.ok(fixture.events.includes(`capture.screenshot:${target.targetId}`));

    const persisted = await readPersistedRun(job.id);
    assert.ok(persisted);
    assert.deepEqual(persisted.executionTarget, target);

    // Retry derives its target from the immutable provider ref, not from a
    // legacy serial. The server's same registry must be captured again at
    // admission so this is a second provider execution rather than a local
    // fallback after the original request has completed.
    const retriedResponse = await fetch(`${base}/jobs/${job.id}/retry`, {
      method: "POST",
      headers: headers("job.retry"),
      body: "{}",
    });
    const retriedResponseBody = await retriedResponse.text();
    assert.equal(retriedResponse.status, 202, retriedResponseBody);
    const retriedBody = JSON.parse(retriedResponseBody) as { job?: { id?: string } };
    const retriedId = retriedBody.job?.id;
    assert.ok(retriedId);
    const retried = await waitForJobCompletion(retriedId);
    assert.equal(retried.status, "ok");
    assert.equal(retried.serial, undefined);
    assert.deepEqual(retried.executionTarget, target);
    assert.equal(localRouteControlCalls, 0);
    assert.equal(localFactoryCalls, 0);
    assert.equal(legacyCloudFactoryCalls, 0);
    assert.deepEqual((await readPersistedRun(retried.id))?.executionTarget, target);
  } finally {
    await server?.close();
    setLocalDeviceProvider(undefined);
    setCloudDeviceProvider(undefined);
    resetControlDatabaseCache();
    resetDurableWorkerAssignmentStoreForTests();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    if (previousTests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previousTests;
    if (previousAutomaticVisualEvidence === undefined)
      delete process.env.RELAY_AUTO_VISUAL_EVIDENCE;
    else process.env.RELAY_AUTO_VISUAL_EVIDENCE = previousAutomaticVisualEvidence;
    await rm(root, { recursive: true, force: true });
  }
});
