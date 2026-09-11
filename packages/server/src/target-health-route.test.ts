import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TargetSupervisorHealth } from "@relay/protocol";
import { startServer } from "./index.js";

function headers(): Record<string, string> {
  return {
    "x-project-id": "target-health-project",
    "x-organization-id": "relay",
    "x-relay-actor-id": "agent:target-health-test",
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": "target.health.get",
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

const target = {
  id: "ipad-health-route",
  serial: "ipad-health-route",
  name: "iPad",
  platform: "ios" as const,
  kind: "iPad",
  booted: true,
};

test("target health is read-only and rehydrates its server-owned target actor", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-health-route-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  let firstServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let restartedServer: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    firstServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      targetRuntime: { listDevices: async () => [target] },
    });
    const first = await fetch(
      `http://127.0.0.1:${firstServer.port}/device/health?serial=${target.serial}`,
      { headers: headers() },
    );
    const firstBody = (await first.json()) as {
      health: { target: { id: string }; epochs: { target: number }; overall: string };
      error?: string;
    };
    assert.equal(first.status, 200, firstBody.error ?? "target health request failed");
    assert.equal(firstBody.health.target.id, target.serial);
    assert.equal(firstBody.health.epochs.target, 1);
    assert.equal(firstBody.health.overall, "starting");
    assert.equal((firstBody.health as { visibility?: string }).visibility, "public");
    await firstServer.close();
    firstServer = undefined;

    restartedServer = await startServer({
      host: "127.0.0.1",
      port: 0,
      targetRuntime: { listDevices: async () => [target] },
    });
    const restarted = await fetch(
      `http://127.0.0.1:${restartedServer.port}/device/health?serial=${target.serial}`,
      { headers: headers() },
    );
    assert.equal(restarted.status, 200);
    const restartedBody = (await restarted.json()) as {
      health: {
        visibility: string;
        epochs: { target: number };
        context: Record<string, unknown>;
        events: Array<{ code: string }>;
      };
    };
    assert.equal(restartedBody.health.epochs.target, 2);
    assert.equal(restartedBody.health.visibility, "public");
    assert.deepEqual(restartedBody.health.context, {});
    assert.deepEqual(restartedBody.health.events, []);
  } finally {
    await firstServer?.close().catch(() => undefined);
    await restartedServer?.close().catch(() => undefined);
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

function sensitiveHealth(): TargetSupervisorHealth {
  return {
    schemaVersion: 1,
    target: { id: target.serial, kind: "ios" },
    observedAt: 10,
    epochs: { target: 1, semanticSession: 2 },
    pixels: { state: "ready", lastCapturedAt: 9, lastError: "private pixel diagnostic" },
    semantics: {
      state: "refreshing",
      lastCapturedAt: 8,
      lastError: "private runner diagnostic",
      traversal: { token: "private-traversal", startedAt: 9 },
    },
    input: {
      state: "uncertain",
      pendingMutationId: "private-mutation",
      reason: "private mutation reason",
    },
    control: { state: "held-by-other", ownerId: "private-owner", expiresAt: 99 },
    overall: "recovering",
    context: {
      foregroundApp: "private.app",
      screenFingerprint: "private-screen",
      runCursor: { runId: "private-run", stepId: "private-step", index: 4 },
    },
    counters: {
      pixelCaptures: 1,
      semanticTraversals: 1,
      semanticTimeouts: 0,
      semanticWedges: 0,
      uncertainMutations: 1,
      reconciliations: 0,
      recoveryAttempts: 1,
      recoveryFailures: 0,
    },
    latency: {
      pixels: { count: 1, averageMs: 1, maximumMs: 1 },
      semantics: { count: 1, averageMs: 2, maximumMs: 2 },
      recovery: { count: 1, averageMs: 3, maximumMs: 3 },
    },
    readiness: {
      previewPixels: {
        mode: "pixels",
        state: "proven",
        freshness: "current",
        proof: { at: 10, durationMs: 1 },
      },
      semanticControl: {
        mode: "accessibility",
        state: "unproven",
        freshness: "unproven",
        reason: "not-yet-proven",
      },
      evidenceCapture: {
        mode: "evidence",
        state: "proven",
        freshness: "current",
        proof: { at: 10, durationMs: 1 },
      },
    },
    events: [
      {
        sequence: 1,
        at: 10,
        code: "TARGET_CONTROL_UPDATED",
        message: "private event",
      },
    ],
  };
}

test("local target health without project ownership is a redacted public projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-health-public-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [target],
      listDeviceLeases: async () => [],
      readTargetHealth: () => sensitiveHealth(),
    },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/device/health?serial=${target.serial}`,
      { headers: headers() },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { health: TargetSupervisorHealth };
    assert.equal(body.health.visibility, "public");
    assert.deepEqual(body.health.context, {});
    assert.deepEqual(body.health.events, []);
    assert.deepEqual(body.health.input, { state: "uncertain" });
    assert.deepEqual(body.health.control, { state: "held-by-other" });
    assert.equal(body.health.pixels.lastError, undefined);
    assert.equal(body.health.semantics.lastError, undefined);
    assert.equal(body.health.semantics.traversal, undefined);
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("a project-scoped active lease permits the full target health projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-health-project-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [target],
      listDeviceLeases: async () => [
        {
          id: "lease-health-project",
          organizationId: "relay",
          projectId: "target-health-project",
          poolId: "local",
          deviceSerial: target.serial,
          ownerId: "agent:controller",
          status: "leased",
          leasedAt: Date.now() - 1_000,
          expiresAt: Date.now() + 60_000,
        },
      ],
      readTargetHealth: () => sensitiveHealth(),
    },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/device/health?serial=${target.serial}`,
      { headers: headers() },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { health: TargetSupervisorHealth };
    assert.equal(body.health.visibility, "project");
    assert.equal(body.health.context.foregroundApp, "private.app");
    assert.equal(body.health.control.ownerId, "private-owner");
    assert.equal(body.health.events[0]?.message, "private event");
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("remote projects cannot probe global target health without a scoped lease", async () => {
  const token = "relay-target-health-cross-project-token";
  const previous = {
    stateDir: process.env.RELAY_STATE_DIR,
    subject: process.env.RELAY_AUTH_SUBJECT,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    role: process.env.RELAY_AUTH_ROLE,
    redaction: process.env.RELAY_REDACTION_MODE,
  };
  const root = await mkdtemp(join(tmpdir(), "relay-target-health-remote-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_AUTH_SUBJECT = "service:target-health";
  process.env.RELAY_AUTH_PROJECT_IDS = "project-without-target";
  process.env.RELAY_AUTH_ORGANIZATION_ID = "relay";
  process.env.RELAY_AUTH_ROLE = "viewer";
  process.env.RELAY_REDACTION_MODE = "on";
  let globalReads = 0;
  const server = await startServer({
    host: "0.0.0.0",
    port: 0,
    token,
    targetRuntime: {
      listDeviceLeases: async (projectId) => {
        assert.equal(projectId, "project-without-target");
        return [];
      },
      listDevices: async () => {
        globalReads += 1;
        return [target];
      },
      readTargetHealth: () => {
        globalReads += 1;
        return sensitiveHealth();
      },
    },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/device/health?serial=${target.serial}`,
      {
        headers: {
          ...headers(),
          authorization: `Bearer ${token}`,
          "x-project-id": "project-without-target",
          "x-relay-actor-id": "service:target-health",
        },
      },
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Target not found" });
    assert.equal(globalReads, 0);
  } finally {
    await server.close();
    if (previous.stateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.stateDir;
    if (previous.subject === undefined) delete process.env.RELAY_AUTH_SUBJECT;
    else process.env.RELAY_AUTH_SUBJECT = previous.subject;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    await rm(root, { recursive: true, force: true });
  }
});

test("a prepared reconciliation recovers after a failed transition without another observation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-input-reconcile-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls: string[] = [];
  let failTransition = true;
  const observation = {
    schemaVersion: 1,
    target: { kind: "device", platform: "ios", targetId: target.serial },
    capturedAt: 20,
    pixels: {
      status: "captured",
      capturedAt: 20,
      mime: "image/png",
      bytes: 4,
      artifact: {
        status: "available",
        artifact: {
          schemaVersion: 1,
          id: `sha256:${"a".repeat(64)}`,
          integrity: { algorithm: "sha256", sha256: "a".repeat(64), bytes: 4 },
          media: { kind: "image", mime: "image/png" },
          capturedAt: 20,
          provenance: { source: "authoring-evidence", capture: "recorded" },
          retention: {
            scope: "workspace-content-addressed",
            recoverability: "content-addressed",
          },
          locations: [{ store: "authoring-evidence", opaque: "input-reconcile-pixels" }],
        },
      },
    },
    semantics: {
      status: "unavailable",
      artifact: { status: "missing", source: "authoring-evidence", media: {} },
      nodeCount: 0,
      controls: [],
    },
  } as const;
  const before = sensitiveHealth();
  before.input = {
    state: "uncertain",
    pendingMutationId: "ios-input-reviewed",
    reason: "acknowledgement lost",
  };
  const after = sensitiveHealth();
  after.input = { state: "ready" };
  after.overall = "ready";
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      assertTargetControl: async () => ({}) as never,
      listDevices: async () => [target],
      readTargetHealth: () => before,
      captureTargetObservation: async () => {
        calls.push("observe");
        return observation as never;
      },
      reconcileTargetInput: (_serial, _platform, input) => {
        calls.push("reconcile");
        assert.deepEqual(input, {
          mutationId: "ios-input-reviewed",
          observationId: `sha256:${"a".repeat(64)}`,
          outcome: "applied",
        });
        if (failTransition) {
          failTransition = false;
          throw new Error("simulated interruption after decision persistence");
        }
        return after;
      },
    },
  });
  try {
    const first = await fetch(`http://127.0.0.1:${server.port}/device/input/reconcile`, {
      method: "POST",
      headers: {
        ...headers(),
        "content-type": "application/json",
        "x-relay-operation-id": "target.input.reconcile",
      },
      body: JSON.stringify({
        serial: target.serial,
        mutationId: "ios-input-reviewed",
        outcome: "applied",
      }),
    });
    assert.equal(first.status, 500);
    const response = await fetch(`http://127.0.0.1:${server.port}/device/input/reconcile`, {
      method: "POST",
      headers: {
        ...headers(),
        "content-type": "application/json",
        "x-relay-operation-id": "target.input.reconcile",
      },
      body: JSON.stringify({
        serial: target.serial,
        mutationId: "ios-input-reviewed",
        outcome: "applied",
      }),
    });
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(calls, ["observe", "reconcile", "reconcile"]);
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});

const browser = {
  id: "browser-member",
  name: "Member Chrome",
  kind: "browser" as const,
  createdAt: 1,
  updatedAt: 1,
};

test("browser health and reconcile use the same Device receipt path", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-browser-input-reconcile-"));
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const calls: string[] = [];
  const observation = {
    schemaVersion: 1,
    target: { kind: "browser", platform: "browser", targetId: browser.id },
    capturedAt: 20,
    pixels: {
      status: "captured",
      capturedAt: 20,
      mime: "image/jpeg",
      bytes: 4,
      artifact: {
        status: "available",
        artifact: {
          schemaVersion: 1,
          id: `sha256:${"b".repeat(64)}`,
          integrity: { algorithm: "sha256", sha256: "b".repeat(64), bytes: 4 },
          media: { kind: "image", mime: "image/jpeg" },
          capturedAt: 20,
          provenance: { source: "authoring-evidence", capture: "recorded" },
          retention: {
            scope: "workspace-content-addressed",
            recoverability: "content-addressed",
          },
          locations: [{ store: "authoring-evidence", opaque: "browser-input-reconcile-pixels" }],
        },
      },
    },
    semantics: {
      status: "unavailable",
      artifact: { status: "missing", source: "authoring-evidence", media: {} },
      nodeCount: 0,
      controls: [],
    },
  } as const;
  const before = sensitiveHealth();
  before.target = { id: browser.id, kind: "browser" };
  before.input = {
    state: "uncertain",
    pendingMutationId: "browser-input-reviewed",
    reason: "acknowledgement lost",
  };
  const after = sensitiveHealth();
  after.target = { id: browser.id, kind: "browser" };
  after.input = { state: "ready" };
  after.overall = "ready";
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      assertTargetControl: async () => ({}) as never,
      listDevices: async () => [],
      listTargets: async () => [browser],
      readTargetHealth: (_serial, platform) => {
        calls.push(`health:${platform}`);
        return before;
      },
      captureTargetObservation: async () => {
        calls.push("observe");
        return observation as never;
      },
      reconcileTargetInput: (_serial, platform, input) => {
        calls.push(`reconcile:${platform}`);
        assert.equal(platform, "browser");
        assert.deepEqual(input, {
          mutationId: "browser-input-reviewed",
          observationId: `sha256:${"b".repeat(64)}`,
          outcome: "applied",
        });
        return after;
      },
    },
  });
  try {
    const health = await fetch(
      `http://127.0.0.1:${server.port}/device/health?serial=${browser.id}`,
      { headers: headers() },
    );
    assert.equal(health.status, 200, await health.text());
    const reconciled = await fetch(`http://127.0.0.1:${server.port}/device/input/reconcile`, {
      method: "POST",
      headers: {
        ...headers(),
        "content-type": "application/json",
        "x-relay-operation-id": "target.input.reconcile",
      },
      body: JSON.stringify({
        serial: browser.id,
        mutationId: "browser-input-reviewed",
        outcome: "applied",
      }),
    });
    assert.equal(reconciled.status, 200, await reconciled.text());
    assert.deepEqual(calls, ["health:browser", "health:browser", "observe", "reconcile:browser"]);
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});
