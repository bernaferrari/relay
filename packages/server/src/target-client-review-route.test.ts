import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TargetSupervisor } from "@relay/core";
import { startServer } from "./index.js";

test("explicit Android client-only review stores acknowledgement without claiming dispatch proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-client-review-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls: string[] = [];
  const device = { id: "pixel-review", serial: "pixel-review", name: "Pixel", platform: "android" as const, kind: "phone", booted: true };
  let health = TargetSupervisor.start({ id: device.serial, kind: "android" }).health();
  const observation = {
    schemaVersion: 1,
    target: { kind: "device", platform: "android", targetId: device.serial },
    capturedAt: 20,
    pixels: {
      status: "captured", capturedAt: 20, mime: "image/png", bytes: 4,
      artifact: { status: "available", artifact: {
        schemaVersion: 1, id: `sha256:${"c".repeat(64)}`,
        integrity: { algorithm: "sha256", sha256: "c".repeat(64), bytes: 4 },
        media: { kind: "image", mime: "image/png" }, capturedAt: 20,
        provenance: { source: "authoring-evidence", capture: "recorded" },
        retention: { scope: "workspace-content-addressed", recoverability: "content-addressed" },
        locations: [{ store: "authoring-evidence", opaque: "client-review-pixels" }],
      } },
    },
    semantics: { status: "unavailable", artifact: { status: "missing", source: "authoring-evidence", media: {} }, nodeCount: 0, controls: [] },
  } as const;
  const server = await startServer({ host: "127.0.0.1", port: 0, targetRuntime: {
    listDevices: async () => [device],
    readTargetHealth: () => health,
    assertTargetControl: async () => { calls.push("authority"); return {} as never; },
    captureTargetObservation: async () => { calls.push("observe"); return observation as never; },
    reconcileTargetInput: () => { throw new Error("Client-only review must not invent a supervisor mutation"); },
  } });
  const headers = (operation: string) => ({
    "x-project-id": "client-review-project", "x-organization-id": "relay",
    "x-relay-actor-id": "human:reviewer", "x-relay-actor-kind": "human",
    "x-relay-operation-id": operation, "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()), "idempotency-key": crypto.randomUUID(),
    "content-type": "application/json",
  });
  const request = (input: Record<string, unknown>) => fetch(`http://127.0.0.1:${server.port}/device/input/reconcile`, {
    method: "POST", headers: headers("target.input.reconcile"),
    body: JSON.stringify({ serial: device.serial, mutationId: "recording-mutation-legacy", outcome: "not-applied", ...input }),
  });
  try {
    const refused = await request({});
    assert.equal(refused.status, 409);
    assert.equal(calls.includes("observe"), false);
    calls.length = 0;
    const response = await request({ clientUnknown: true, resolutionId: "review-attempt-1" });
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.mutationId, "recording-mutation-legacy");
    assert.equal(body.outcome, "acknowledged");
    assert.deepEqual(body.review, { source: "operator-review", observed: "not-observed", actorId: "human:reviewer" });
    assert.deepEqual(calls, ["authority", "observe", "authority"]);
    assert.deepEqual(body.health.input, { state: "ready" });
    const fetched = await fetch(`http://127.0.0.1:${server.port}/device/input/receipt?serial=${device.serial}&mutationId=recording-mutation-legacy`, { headers: headers("target.input.receipt.get") });
    const fetchedBody = await fetched.json() as Record<string, any>;
    assert.equal(fetched.status, 200, JSON.stringify(fetchedBody));
    assert.equal(fetchedBody.receipt.outcome, "acknowledged");
    assert.deepEqual(fetchedBody.receipt.review, body.review);
    assert.deepEqual(fetchedBody.receipt.observation, observation);
    const retry = await request({ clientUnknown: true, resolutionId: "review-attempt-1" });
    assert.equal(retry.status, 200, await retry.text());
    assert.equal(calls.filter((call) => call === "observe").length, 1);

    health = { ...health, input: { state: "uncertain", pendingMutationId: "android-input-other" } };
    const different = await request({ clientUnknown: true, mutationId: "recording-mutation-new", reconcilePending: true });
    assert.equal(different.status, 409);
    assert.equal(calls.filter((call) => call === "observe").length, 1);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
