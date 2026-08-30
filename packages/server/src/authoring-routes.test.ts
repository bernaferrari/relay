import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import {
  captureAuthoringObservation,
  captureAuthoringReplayActionEndpoint,
} from "./authoring-routes.js";
import { startServer } from "./index.js";

async function temporaryAuthoringScreenshot(name: string) {
  const root = join(tmpdir(), "relay");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, `shot-authoring-${name}-`));
  return { directory, path: join(directory, "capture.png") };
}

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
        inspectionState: "active",
        bindingState: "matched",
        treeApp: "com.example.browser",
        visualFingerprint: "browser-visual",
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
  assert.deepEqual(observation.proof, {
    schemaVersion: 1,
    captureOrder: "concurrent",
    pixels: { status: "captured", capturedAt: 11, fingerprint: "browser-screen" },
    semantics: { status: "unavailable", capturedAt: 10 },
  });
  assert.deepEqual(observation.capture, {
    snapshotSource: "sdk",
    inspectable: true,
    inspectionState: "active",
    bindingState: "matched",
    treeApp: "com.example.browser",
    visualFingerprint: "browser-visual",
  });
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

test("Android authoring retries an empty semantic capture on the explicit serial", async () => {
  const session = {
    target: { kind: "device", platform: "android", targetId: "emulator-5554" },
  } as AuthoringSession;
  let snapshots = 0;
  const serials: string[] = [];

  const observation = await captureAuthoringObservation(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      snapshots += 1;
      return {
        serial: "emulator-5554",
        capturedAt: snapshots,
        nodes: snapshots === 1 ? [] : [{ role: "button", label: "Chrome", visibleToUser: true }],
        interactive: [],
        inspectable: snapshots > 1,
        source: snapshots > 1 ? "sdk" : "android-system",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: snapshots > 1 ? "launcher-tree" : "empty-tree",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureSnapshotBySerial(serial) {
      serials.push(serial);
      return {
        serial,
        capturedAt: 2,
        nodes: [{ role: "button", label: "Chrome", visibleToUser: true }],
        interactive: [],
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "launcher-tree",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      return {
        serial: "emulator-5554",
        capturedAt: 3,
        mime: "image/png",
        base64: Buffer.from("launcher-png").toString("base64"),
        path: "/android/launcher.png",
        bytes: 12,
      };
    },
  });

  assert.equal(snapshots, 1);
  assert.deepEqual(serials, ["emulator-5554"]);
  assert.deepEqual(observation.nodes, [{ role: "button", label: "Chrome", visibleToUser: true }]);
  assert.equal(observation.proof?.semantics.status, "current");
});

test("physical Apple authoring freezes visible evidence before inspecting the runner", async () => {
  const order: string[] = [];
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  const observation = await captureAuthoringObservation(session, {
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
  assert.equal(observation.proof?.captureOrder, "pixels-first");
  assert.equal(observation.proof?.semantics.status, "unavailable");
});

test("iOS brackets an otherwise current tree and retains it only as stale diagnostics when pixels move", async () => {
  const order: string[] = [];
  let screenshots = 0;
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  const observation = await captureAuthoringObservation(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      order.push("snapshot");
      return {
        serial: "ipad-a",
        capturedAt: 20,
        nodes: [{ role: "button", label: "Old Settings" }],
        interactive: [],
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "late-tree-identity",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      screenshots += 1;
      const after = screenshots === 2;
      order.push(after ? "screenshot:after" : "screenshot:before");
      return {
        serial: "ipad-a",
        capturedAt: after ? 30 : 10,
        mime: "image/png",
        base64: Buffer.from(after ? "new-visible-screen" : "old-visible-screen").toString("base64"),
        path: after ? "/ipad/after.png" : "/ipad/before.png",
        bytes: after ? 18 : 18,
      };
    },
  });

  assert.deepEqual(order, ["screenshot:before", "snapshot", "screenshot:after"]);
  assert.equal(observation.capturedAt, 30);
  assert.equal(observation.proof?.captureOrder, "pixels-ax-pixels");
  assert.equal(observation.proof?.semantics.status, "stale");
  assert.deepEqual(observation.proof?.pixels.bracket?.status, "changed");
  assert.equal(observation.proof?.pixels.bracket?.afterCapturedAt, 30);
  assert.notEqual(observation.fingerprint, "late-tree-identity");
  assert.deepEqual(observation.nodes, [{ role: "button", label: "Old Settings" }]);
  assert.deepEqual(observation.bracketScreenshot, {
    data: Buffer.from("new-visible-screen"),
    mime: "image/png",
    capturedAt: 30,
  });
});

test("iOS promotes a tree only after a coherent pixel bracket", async () => {
  const order: string[] = [];
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  const observation = await captureAuthoringObservation(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      order.push("snapshot");
      return {
        serial: "ipad-a",
        capturedAt: 20,
        nodes: [{ role: "button", label: "Settings" }],
        interactive: [],
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "settings-tree",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      order.push("screenshot");
      return {
        serial: "ipad-a",
        capturedAt: order.length === 1 ? 10 : 30,
        mime: "image/png",
        base64: Buffer.from("same-visible-screen").toString("base64"),
        path: "/ipad/same.png",
        bytes: 19,
      };
    },
  });

  assert.deepEqual(order, ["screenshot", "snapshot", "screenshot"]);
  assert.equal(observation.proof?.captureOrder, "pixels-ax-pixels");
  assert.equal(observation.proof?.semantics.status, "current");
  assert.equal(observation.proof?.pixels.bracket?.status, "coherent");
  assert.equal(observation.screenshotCapturedAt, 10);
  assert.equal(observation.bracketScreenshot, undefined, "identical raw frames deduplicate safely");
});

test("authoring transfers primary and bracket bytes before disposing temporary rasters", async () => {
  const opening = await temporaryAuthoringScreenshot("opening");
  const closing = await temporaryAuthoringScreenshot("closing");
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-cleanup" },
  } as AuthoringSession;
  let captures = 0;
  try {
    const observation = await captureAuthoringObservation(session, {
      async resolveDevice() {
        return {} as Device;
      },
      async captureSnapshot() {
        return {
          serial: "ipad-cleanup",
          capturedAt: 20,
          nodes: [{ role: "button", label: "Settings" }],
          interactive: [],
          inspectable: true,
          source: "sdk",
          screenIdentity: {
            schemaVersion: 1,
            fingerprint: "settings-tree",
            nodes: [],
            volatileSignals: [],
          },
        };
      },
      async captureScreenshot() {
        captures += 1;
        const isClosing = captures === 2;
        const bytes = Buffer.from(isClosing ? "closing-durable-pixels" : "opening-durable-pixels");
        return {
          serial: "ipad-cleanup",
          capturedAt: isClosing ? 30 : 10,
          mime: "image/png" as const,
          base64: bytes.toString("base64"),
          path: isClosing ? closing.path : opening.path,
          bytes: bytes.byteLength,
        };
      },
    });

    assert.deepEqual(observation.screenshot?.data, Buffer.from("opening-durable-pixels"));
    assert.deepEqual(observation.bracketScreenshot?.data, Buffer.from("closing-durable-pixels"));
    assert.equal(existsSync(opening.directory), false);
    assert.equal(existsSync(closing.directory), false);
  } finally {
    await Promise.all([
      rm(opening.directory, { recursive: true, force: true }),
      rm(closing.directory, { recursive: true, force: true }),
    ]);
  }
});

test("a failed concurrent authoring observation still disposes its completed temporary raster", async () => {
  const temporary = await temporaryAuthoringScreenshot("failed-observation");
  const session = {
    target: { kind: "device", platform: "android", targetId: "android-cleanup" },
  } as AuthoringSession;
  try {
    await assert.rejects(
      captureAuthoringObservation(session, {
        async resolveDevice() {
          return {} as Device;
        },
        async captureSnapshot() {
          throw new Error("AX failed after screenshot capture began");
        },
        async captureScreenshot() {
          return {
            serial: "android-cleanup",
            capturedAt: 10,
            mime: "image/png" as const,
            base64: Buffer.from("still-durable-until-finally").toString("base64"),
            path: temporary.path,
            bytes: 26,
          };
        },
      }),
      /AX failed/u,
    );
    assert.equal(existsSync(temporary.directory), false);
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
});

test("iOS keeps usable pixels but marks a tree stale when the closing bracket cannot be captured", async () => {
  let screenshots = 0;
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  const observation = await captureAuthoringObservation(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      return {
        serial: "ipad-a",
        capturedAt: 20,
        nodes: [{ role: "button", label: "Settings" }],
        interactive: [],
        inspectable: true,
        source: "sdk",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: "settings-tree",
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      screenshots += 1;
      if (screenshots === 2) throw new Error("XCTest closing raster timed out");
      return {
        serial: "ipad-a",
        capturedAt: 10,
        mime: "image/png",
        base64: Buffer.from("opening-visible-screen").toString("base64"),
        path: "/ipad/opening.png",
        bytes: 22,
      };
    },
  });

  assert.equal(screenshots, 2);
  assert.equal(observation.proof?.captureOrder, "pixels-ax-pixels");
  assert.equal(observation.proof?.pixels.status, "captured");
  assert.deepEqual(observation.proof?.pixels.bracket, { status: "unavailable" });
  assert.equal(observation.proof?.semantics.status, "stale");
  assert.equal(observation.nodes?.[0]?.label, "Settings");
});

test("replay action endpoint captures pixels without querying or trusting accessibility", async () => {
  const operations: string[] = [];
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-a" },
  } as AuthoringSession;

  const observation = await captureAuthoringReplayActionEndpoint(session, {
    async resolveDevice() {
      operations.push("device");
      return {} as Device;
    },
    async captureSnapshot() {
      operations.push("snapshot");
      throw new Error("a fast replay endpoint must not read AX");
    },
    async captureScreenshot() {
      operations.push("screenshot");
      return {
        serial: "ipad-a",
        capturedAt: 12,
        mime: "image/png",
        base64: Buffer.from("immediate-replay-png").toString("base64"),
        path: "/ipad/replay-endpoint.png",
        bytes: 20,
        width: 1194,
        height: 834,
      };
    },
  });

  assert.deepEqual(operations, ["device", "screenshot"]);
  assert.equal(observation.proof?.captureOrder, "pixels-first");
  assert.deepEqual(observation.proof?.semantics, { status: "unavailable", capturedAt: 12 });
  assert.deepEqual(observation.capture, {
    snapshotSource: "pixels-only",
    inspectable: false,
    visualFingerprint: observation.fingerprint,
  });
  assert.equal(observation.nodes, undefined);
  assert.deepEqual(observation.bounds, { width: 1194, height: 834 });
});

test("replay action endpoint disposes the temporary raster after copying its bytes", async () => {
  const temporary = await temporaryAuthoringScreenshot("replay");
  const session = {
    target: { kind: "device", platform: "ios", targetId: "ipad-replay-cleanup" },
  } as AuthoringSession;
  try {
    const observation = await captureAuthoringReplayActionEndpoint(session, {
      async resolveDevice() {
        return {} as Device;
      },
      async captureSnapshot() {
        throw new Error("replay endpoints must remain pixels-only");
      },
      async captureScreenshot() {
        const bytes = Buffer.from("replay-durable-pixels");
        return {
          serial: "ipad-replay-cleanup",
          capturedAt: 12,
          mime: "image/png" as const,
          base64: bytes.toString("base64"),
          path: temporary.path,
          bytes: bytes.byteLength,
        };
      },
    });
    assert.deepEqual(observation.screenshot?.data, Buffer.from("replay-durable-pixels"));
    assert.equal(existsSync(temporary.directory), false);
  } finally {
    await rm(temporary.directory, { recursive: true, force: true });
  }
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
    const archivedId = "archived-authoring-review";
    await writeFile(
      join(process.env.RELAY_STATE_DIR!, "authoring-sessions", `${archivedId}.json`),
      JSON.stringify({
        ...response.session,
        id: archivedId,
        state: "cancelled",
        updatedAt: response.session.updatedAt + 1,
        archive: {
          reason: "superseded",
          archivedAt: response.session.updatedAt + 1,
          supersededBySessionId: response.session.id,
        },
      }),
    );
    assert.deepEqual(
      (await owner.authoringSessions()).sessions.map((session) => session.id),
      [response.session.id],
    );
    assert.deepEqual(
      (await owner.authoringSessions({ includeHistory: true })).sessions.map(
        (session) => session.id,
      ),
      [archivedId, response.session.id],
    );
    assert.equal(
      (await observer.authoringSession(archivedId)).session.archive?.reason,
      "superseded",
    );
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

test("raw Take optimization is a scoped read-only proposal with no device access", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-authoring-optimization-"));
  const previous = {
    state: process.env.RELAY_STATE_DIR,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  let nativeCalls = 0;
  let observationCalls = 0;
  const runtime: AuthoringRuntime = {
    async observe() {
      observationCalls += 1;
      return {
        capturedAt: Date.now(),
        targetId: "device-optimization",
        fingerprint: "authoring-source",
        bounds: { width: 1_080, height: 2_400 },
        nodes: [{ role: "button", label: "Continue" }],
        screenshot: { data: Buffer.from("authoring-source"), mime: "image/png" },
      };
    },
    async execute() {
      nativeCalls += 1;
    },
    async replay() {},
  };
  const server = await startServer({ host: "127.0.0.1", port: 0, authoringRuntime: runtime });
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "project-optimization",
    actorId: "human:author",
    actorKind: "human",
  });
  try {
    const appMap = await client.invoke("app-map.create", {
      appMapId: "optimization-map",
      name: "Optimization map",
    });
    const lease = await client.lease({
      poolId: "authoring",
      deviceSerial: "device-optimization",
      expiresAt: Date.now() + 60_000,
    });
    const begun = await client.invoke("authoring.session.begin", {
      appMapId: appMap.appMap.id,
      target: { kind: "device", platform: "android", targetId: "device-optimization" },
      leaseId: lease.lease.id,
      expectedAppMapRevision: appMap.appMap.revision,
    });
    await client.interactAuthoringSession(begun.session.id, {
      kind: "observe",
      label: "Private generated copy that must never leave the raw source",
    });
    const before = await client.authoringSession(begun.session.id);
    const observationsBeforeReview = observationCalls;
    const proposal = await client.invoke("authoring.take.optimization.get", {
      sessionId: begun.session.id,
    });
    const after = await client.authoringSession(begun.session.id);

    assert.equal(nativeCalls, 0, "an observation-only recorded action has no native input");
    assert.equal(observationCalls, observationsBeforeReview, "review must not read the target");
    assert.equal(proposal.proposal?.reviewOnly, true);
    assert.equal(proposal.proposal?.takeId, before.session.take?.id);
    assert.equal(proposal.proposal?.baseRevision, before.session.take?.currentRevision);
    assert.deepEqual(
      proposal.proposal?.suggestions.map((suggestion) => suggestion.kind),
      ["review-observe-only"],
    );
    assert.equal(JSON.stringify(proposal).includes("Private generated copy"), false);
    assert.deepEqual(after.session.take, before.session.take, "review must not mutate the Take");
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
