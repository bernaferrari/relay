import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  currentTargetContext,
  IosMutationOutcomeUnknownError,
  type AuthoringRuntime,
  type Device,
} from "@relay/core";
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

test("authoring rejects a blank device screenshot instead of saving a broken screen", async () => {
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  await assert.rejects(
    captureAuthoringObservation(session, {
      async resolveDevice() {
        return {} as Device;
      },
      async captureSnapshot() {
        return {
          serial: "ipad-a",
          capturedAt: 10,
          nodes: [],
          interactive: [],
          inspectable: false,
          source: "pixels-only",
          screenIdentity: {
            schemaVersion: 1,
            fingerprint: "pixels",
            nodes: [],
            volatileSignals: [],
          },
        };
      },
      async captureScreenshot() {
        return {
          serial: "ipad-a",
          capturedAt: 11,
          mime: "image/png",
          base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACklEQVR4AWPAAAAAEgABKPhxBgAAAABJRU5ErkJggg==",
          path: "/ipad/blank.png",
          bytes: 68,
        };
      },
    }),
    /blank screenshot/u,
  );
});

test("Authoring Sessions share local target control but keep mutation actor-owned", async () => {
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
      (
        await owner.authoringSessions({
          appMapId: created.appMap.id,
          targetId: "device-a",
          activeOnly: true,
        })
      ).sessions[0]?.id,
      response.session.id,
    );
    assert.equal(
      (await owner.authoringSessions({ appMapId: "another-map", activeOnly: true })).sessions
        .length,
      0,
    );
    assert.equal(
      (await observer.authoringSession(response.session.id)).session.id,
      response.session.id,
    );

    await assert.rejects(
      observer.cancelAuthoringSession(response.session.id),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const cancelled = await owner.cancelAuthoringSession(response.session.id);
    assert.equal(cancelled.session.state, "cancelled");
    assert.equal((await owner.authoringSessions({ activeOnly: true })).sessions.length, 0);
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

test("atomic authoring begin preserves the device failure instead of masking it as a state error", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-begin-error-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const runtime: AuthoringRuntime = {
    async observe() {
      throw new Error("xcrun timed out after 20000ms");
    },
    async execute() {},
    async replay() {},
  };
  const server = await startServer({ host: "127.0.0.1", port: 0, authoringRuntime: runtime });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "project-begin-error",
    actorId: "agent:author",
    actorKind: "agent",
  });
  try {
    const created = await client.invoke("app-map.create", {
      appMapId: "begin-error",
      name: "Begin error",
    });
    const lease = await client.lease({
      poolId: "authoring",
      deviceSerial: "ipad-error",
      expiresAt: Date.now() + 60_000,
    });
    await assert.rejects(
      client.invoke("authoring.session.begin", {
        appMapId: created.appMap.id,
        target: { kind: "device", platform: "ios", targetId: "ipad-error" },
        leaseId: lease.lease.id,
        expectedAppMapRevision: created.appMap.revision,
      }),
      (error) =>
        error instanceof ApiError &&
        error.status === 422 &&
        error.message.includes("xcrun timed out after 20000ms") &&
        error.body?.code === "AUTHORING_SOURCE_UNAVAILABLE",
    );
  } finally {
    await server.close();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("authoring preserves an unknown iOS action as one-command review instead of a retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-unknown-ios-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  let nativeCalls = 0;
  const runtime: AuthoringRuntime = {
    async observe() {
      return {
        capturedAt: Date.now(),
        targetId: "ipad-authoring-unknown",
        fingerprint: "authoring-source",
        bounds: { width: 834, height: 1112 },
        nodes: [{ role: "button", label: "Settings" }],
        screenshot: { data: Buffer.from("authoring-source"), mime: "image/png" },
      };
    },
    async execute() {
      nativeCalls += 1;
      throw new IosMutationOutcomeUnknownError(
        {
          sequence: 1,
          operation: "press",
          nativeAttempts: 1,
          outcome: "outcome-unknown",
          retry: {
            attempts: 0,
            decision: "blocked",
            reason: "native-command-outcome-unknown",
          },
          intervention: { required: true, action: "capture-current-screen-before-any-retry" },
          at: Date.now(),
        },
        new Error("connection reset after native XCTest press"),
      );
    },
    async replay() {},
  };
  const server = await startServer({ host: "127.0.0.1", port: 0, authoringRuntime: runtime });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "project-authoring-unknown",
    actorId: "human:author",
    actorKind: "human",
  });
  try {
    const appMap = await client.invoke("app-map.create", {
      appMapId: "authoring-unknown",
      name: "Authoring unknown",
    });
    const lease = await client.lease({
      poolId: "authoring",
      deviceSerial: "ipad-authoring-unknown",
      expiresAt: Date.now() + 60_000,
    });
    const begun = await client.invoke("authoring.session.begin", {
      appMapId: appMap.appMap.id,
      target: { kind: "device", platform: "ios", targetId: "ipad-authoring-unknown" },
      leaseId: lease.lease.id,
      expectedAppMapRevision: appMap.appMap.revision,
    });

    await assert.rejects(
      client.interactAuthoringSession(begun.session.id, {
        kind: "tap",
        target: { label: "Settings" },
      }),
      (error: unknown) => {
        if (!(error instanceof ApiError) || error.status !== 409) return false;
        const body = error.body as {
          code?: unknown;
          iosMutation?: { nativeAttempts?: unknown; outcome?: unknown };
        };
        return (
          body.code === "IOS_MUTATION_OUTCOME_UNKNOWN" &&
          body.iosMutation?.nativeAttempts === 1 &&
          body.iosMutation.outcome === "outcome-unknown"
        );
      },
    );
    assert.equal(nativeCalls, 1, "the authoring endpoint never retries an unknown native press");
  } finally {
    await server.close();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});
