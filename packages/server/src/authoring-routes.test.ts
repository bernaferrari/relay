import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { currentTargetContext, type Device } from "@relay/core";
import type { AuthoringSession } from "@relay/protocol";
import { captureAuthoringObservation } from "./authoring-routes.js";
import { startServer } from "./index.js";

test("browser authoring observation stays on the explicit browser adapter path", async () => {
  const browserDevice = {} as Device;
  const seen: Array<{ operation: string; device: Device; context: unknown }> = [];
  const session = {
    target: { kind: "browser", platform: "browser", targetId: "browser-a" },
  } as AuthoringSession;
  const observation = await captureAuthoringObservation(session, {
    async resolveDevice(value) {
      assert.equal(value.target.kind, "browser");
      return browserDevice;
    },
    async captureSnapshot(device) {
      seen.push({ operation: "snapshot", device, context: currentTargetContext() });
      return {
        serial: "browser-a",
        capturedAt: 10,
        nodes: [],
        interactive: [],
        bounds: { width: 1280, height: 800 },
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "browser-screen",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot(device) {
      seen.push({ operation: "screenshot", device, context: currentTargetContext() });
      return {
        serial: "browser-a",
        capturedAt: 11,
        mime: "image/png",
        base64: Buffer.from("browser-png").toString("base64"),
        path: "/browser/capture.png",
        bytes: 11,
      };
    },
  });

  assert.equal(observation.targetId, "browser-a");
  assert.equal(observation.fingerprint, "browser-screen");
  assert.deepEqual(
    seen.map(({ operation, device, context }) => ({
      operation,
      sameDevice: device === browserDevice,
      context,
    })),
    [
      {
        operation: "snapshot",
        sameDevice: true,
        context: { kind: "browser", platform: "browser", targetId: "browser-a" },
      },
      {
        operation: "screenshot",
        sameDevice: true,
        context: { kind: "browser", platform: "browser", targetId: "browser-a" },
      },
    ],
  );
});

test("physical Apple authoring freezes visible evidence before inspecting the runner", async () => {
  const order: string[] = [];
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  await captureAuthoringObservation(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      order.push("snapshot:start");
      await new Promise<void>((resolve) => setImmediate(resolve));
      order.push("snapshot:end");
      return {
        serial: "ipad-a",
        capturedAt: 10,
        nodes: [],
        interactive: [],
        bounds: { width: 834, height: 1194 },
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "ipad-screen",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      order.push("screenshot");
      return {
        serial: "ipad-a",
        capturedAt: 11,
        mime: "image/png",
        base64: Buffer.from("ipad-png").toString("base64"),
        path: "/ipad/capture.png",
        bytes: 8,
      };
    },
  });

  assert.deepEqual(order, ["screenshot", "snapshot:start", "snapshot:end"]);
});

test("Authoring Sessions require an explicit actor-owned target lease and remain observable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-server-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const connection = {
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" as const },
    organizationId: "local",
    projectId: "project-a",
    actorId: "human:author",
    actorKind: "human" as const,
  };
  const owner = new RelayClient(connection);
  const observer = new RelayClient({
    ...connection,
    actorId: "agent:observer",
    actorKind: "agent",
  });
  try {
    const created = await owner.invoke("app-map.create", {
      appMapId: "checkout",
      name: "Checkout",
    });
    const lease = await owner.lease({
      poolId: "authoring",
      deviceSerial: "device-a",
      expiresAt: Date.now() + 60_000,
    });
    const response = await owner.createAuthoringSession({
      appMapId: created.appMap.id,
      target: { kind: "device", platform: "android", targetId: "device-a" },
      leaseId: lease.lease.id,
      expectedAppMapRevision: created.appMap.revision,
    });
    assert.equal(response.session.state, "preparing");
    assert.equal(response.session.actorId, "human:author");
    assert.equal(response.session.target.targetId, "device-a");
    assert.equal((await owner.authoringSessions()).sessions[0]?.id, response.session.id);
    assert.equal(
      (await observer.authoringSession(response.session.id)).session.id,
      response.session.id,
    );

    await assert.rejects(
      observer.cancelAuthoringSession(response.session.id),
      (error) => error instanceof ApiError && error.status === 403,
    );
    const cancelled = await owner.cancelAuthoringSession(response.session.id);
    assert.equal(cancelled.session.state, "cancelled");
    await owner.cleanupAuthoringSession(response.session.id);
    assert.equal((await owner.authoringSessions()).sessions.length, 0);
  } finally {
    await server.close();
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});
