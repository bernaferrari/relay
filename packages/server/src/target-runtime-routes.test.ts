import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DurableWorkerAssignmentStore,
  IosMutationOutcomeUnknownError,
  listActivity,
} from "@relay/core";
import { executionTargetRefKey } from "@relay/protocol";
import { startServer } from "./index.js";

function headers(operationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "runtime-project",
    "x-organization-id": "relay",
    "x-relay-actor-id": "human:runtime-test",
    "x-relay-actor-kind": "human",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

function recoveryFenceTarget(serial = "ipad-recovery-fence") {
  return {
    schemaVersion: 1 as const,
    kind: "local-device" as const,
    provider: { key: "relay.local.agent-device" as const, scope: "local" as const },
    targetId: serial,
    platform: "ios" as const,
    identity: { kind: "device-serial" as const, value: serial },
  };
}

function seedRecoveryFence(store: DurableWorkerAssignmentStore, serial = "ipad-recovery-fence") {
  const executionTarget = recoveryFenceTarget(serial);
  store.queue({
    id: "interrupted-recovery-job",
    projectId: "runtime-project",
    executionTarget,
    lane: { workerId: `local:ios:${serial}`, capacity: 1 },
    queuedAt: 1,
  });
  store.claimRunning("interrupted-recovery-job", "server-before-restart", 2);
  const assignment = store.reconcileAfterRestart({
    workerInstanceId: "server-after-restart",
    at: 3,
  }).assignments[0]!;
  assert.equal(assignment.executionTargetKey, executionTargetRefKey(executionTarget));
  return assignment;
}

const RECOVERY_FENCE_SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGwAAADqCAYAAABHj6AIAAACAklEQVR4Ae3BQQ3CUAAFweUFBV9G/WupnaKBE9mwM69zzkM0RlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZU3nzpvm9+6bou/tmIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojKiMqIyojK65zzEI0RlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlRGVEZURlQ8JFgc/rAxuHwAAAABJRU5ErkJggg==";

function recoveryFenceScreenshot(serial: string, capturedAt: number) {
  const data = Buffer.from(RECOVERY_FENCE_SCREENSHOT_BASE64, "base64");
  return {
    serial,
    capturedAt,
    mime: "image/png" as const,
    base64: RECOVERY_FENCE_SCREENSHOT_BASE64,
    path: `/tmp/${serial}-${capturedAt}.png`,
    bytes: data.byteLength,
    width: 108,
    height: 234,
  };
}

function recoveryFenceReadiness() {
  const proof = { at: 11, observedNodeCount: 1, durationMs: 5 };
  return {
    previewPixels: {
      mode: "pixels" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
    semanticControl: {
      mode: "accessibility" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
    evidenceCapture: {
      mode: "evidence" as const,
      state: "proven" as const,
      freshness: "current" as const,
      proof,
    },
  };
}

function recoveryFenceSnapshot(serial: string, capturedAt = 11) {
  const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
  return {
    serial,
    capturedAt,
    nodes,
    interactive: nodes,
    inspectable: true,
    source: "sdk" as const,
    screenIdentity: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
    readiness: recoveryFenceReadiness(),
  };
}

test("exposes pool capacity and installs and launches a registered artifact through one leased target", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-runtime-"));
  const artifact = join(root, "app.apk");
  await writeFile(artifact, "apk");
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const commands: Array<[string, string[]]> = [];
  let controlChecks = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "pixel",
          serial: "pixel-1",
          name: "Pixel",
          platform: "android",
          kind: "Pixel 9",
          booted: true,
        },
      ],
      listDeviceLeases: async () => [
        {
          id: "lease",
          projectId: "runtime-project",
          poolId: "phones",
          deviceSerial: "pixel-1",
          ownerId: "human:runtime-test",
          status: "leased",
          leasedAt: 1,
          expiresAt: Date.now() + 60_000,
        },
      ],
      assertTargetControl: async () => {
        controlChecks += 1;
        return {
          id: "lease",
          projectId: "runtime-project",
          poolId: "phones",
          deviceSerial: "pixel-1",
          ownerId: "human:runtime-test",
          status: "leased",
          leasedAt: 1,
          expiresAt: Date.now() + 60_000,
        };
      },
      runBuildCommand: async (command, args) => {
        commands.push([command, args]);
        return { stdout: command === "apkanalyzer" ? "com.example.app\n" : "" };
      },
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const build = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "android",
        name: "Android",
        platform: "android",
        sourceUrl: artifact,
        status: "ready",
      }),
    });
    assert.equal(build.status, 201);

    const pool = await fetch(`${base}/device-pools`, {
      method: "POST",
      headers: headers("device-pool.save"),
      body: JSON.stringify({
        id: "phones",
        name: "Phones",
        platform: "android",
        deviceSerials: ["pixel-1"],
      }),
    });
    assert.equal(pool.status, 201);

    const poolPreflight = await fetch(`${base}/device-pools/phones/preflight`, {
      method: "POST",
      headers: headers("device-pool.preflight"),
      body: "{}",
    });
    const poolBody = (await poolPreflight.json()) as {
      preflight: { capacity: { connected: number; available: number; leased: number } };
    };
    assert.deepEqual(poolBody.preflight.capacity, {
      configured: 1,
      connected: 1,
      available: 0,
      leased: 1,
    });

    const preflight = await fetch(`${base}/builds/android/preflight`, {
      method: "POST",
      headers: headers("build.preflight"),
      body: JSON.stringify({ serial: "pixel-1" }),
    });
    const preflightBody = (await preflight.json()) as {
      preflight: {
        ok: boolean;
        applicationId?: string;
        capabilities: { install: boolean; launch: boolean };
      };
    };
    assert.equal(preflightBody.preflight.ok, true);
    assert.equal(preflightBody.preflight.applicationId, "com.example.app");
    assert.deepEqual(preflightBody.preflight.capabilities, { install: true, launch: true });

    const install = await fetch(`${base}/builds/android/install`, {
      method: "POST",
      headers: headers("build.install"),
      body: JSON.stringify({ serial: "pixel-1", launch: true }),
    });
    assert.equal(install.status, 200);
    assert.equal(controlChecks, 1);
    assert.ok(commands.some(([command, args]) => command === "adb" && args.includes("install")));
    assert.ok(commands.some(([command, args]) => command === "adb" && args.includes("monkey")));
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("launches an arbitrary app through the leased target session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-launch-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const launched: Array<{
    serial: string;
    platform: "android" | "ios";
    app: string;
    relaunch: boolean;
  }> = [];
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "ipad",
          serial: "ipad-1",
          name: "iPad",
          platform: "ios",
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: "ipad-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      launchApp: async (input) => {
        launched.push(input);
      },
      captureSnapshot: async () => ({
        serial: "ipad-1",
        capturedAt: 1,
        nodes: [
          {
            type: "Application",
            label: "Settings",
            hittable: true,
            rect: { x: 0, y: 0, width: 834, height: 1112 },
          },
        ],
        interactive: [],
        inspectable: true,
        source: "sdk" as const,
        screenIdentity: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      }),
    },
  });
  try {
    const defaultResponse = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "Grok" }),
    });
    assert.equal(defaultResponse.status, 200);
    const bounced = (await defaultResponse.json()) as {
      observed: { app?: string; matched: boolean };
    };
    assert.deepEqual(bounced.observed, { app: "Settings", matched: false });
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "Settings", relaunch: false }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(launched, [
      { serial: "ipad-1", platform: "ios", app: "Grok", relaunch: false },
      { serial: "ipad-1", platform: "ios", app: "Settings", relaunch: false },
    ]);
    const body = (await response.json()) as {
      launched: { serial: string; app: string; platform: string; launchedAt: number };
      observed: { app?: string; matched: boolean };
    };
    assert.deepEqual(
      {
        serial: body.launched.serial,
        app: body.launched.app,
        platform: body.launched.platform,
      },
      { serial: "ipad-1", app: "Settings", platform: "ios" },
    );
    assert.equal(Number.isFinite(body.launched.launchedAt), true);
    assert.deepEqual(body.observed, { app: "Settings", matched: true });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("launch tells agents to recover when Apple CoreDevice cannot list apps", async () => {
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "ipad",
          serial: "ipad-1",
          name: "iPad",
          platform: "ios",
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: "ipad-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      launchApp: async () => {
        throw new Error(
          "Failed to list iOS apps: The operation couldn’t be completed. (CoreDevice.ActionError error 3.)",
        );
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "ai.x.GrokApp" }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as {
      error: string;
      recovery?: string;
      recoveryAction?: { operationId?: string; cli?: { argv?: string[] } };
    };
    assert.match(body.error, /Failed to list iOS apps/);
    assert.match(String(body.recovery), /Recover the iPad/);
    assert.equal(body.recoveryAction?.operationId, "target.recover");
    assert.deepEqual(body.recoveryAction?.cli?.argv?.slice(0, 3), ["device", "recover", "ipad-1"]);
    assert.match(body.recoveryAction?.cli?.argv?.join(" ") ?? "", /reason":"control/);
  } finally {
    await server.close();
  }
});

test("an ambiguous iOS app launch is returned as review evidence, never recovery", async () => {
  const unknown = new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "app-open",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("xcrun timed out after 10000ms"),
  );
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "ipad",
          serial: "ipad-1",
          name: "iPad",
          platform: "ios",
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: "ipad-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      launchApp: async () => {
        throw unknown;
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "ai.x.GrokApp" }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      code?: string;
      iosMutation?: {
        operation?: string;
        nativeAttempts?: number;
        retry?: { decision?: string };
      };
      recoveryAction?: unknown;
    };
    assert.equal(body.code, "IOS_MUTATION_OUTCOME_UNKNOWN");
    assert.equal(body.iosMutation?.operation, "app-open");
    assert.equal(body.iosMutation?.nativeAttempts, 1);
    assert.equal(body.iosMutation?.retry?.decision, "blocked");
    assert.equal(body.recoveryAction, undefined);
  } finally {
    await server.close();
  }
});

test("discovers every locale declared by an installed Android app", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-locales-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "pixel",
          serial: "pixel-1",
          name: "Pixel",
          platform: "android",
          kind: "Pixel 9",
          booted: true,
        },
      ],
      listAndroidAppLocales: async (serial, packageName) => {
        assert.equal(serial, "pixel-1");
        assert.equal(packageName, "com.example.app");
        return {
          locales: ["en", "it", "pt-BR"],
          currentLocale: "it",
          source: "android-locale-manager",
        };
      },
    },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/device/app/locales?serial=pixel-1&package=com.example.app`,
      { headers: headers("target.app.locales") },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      packageName: "com.example.app",
      locales: ["en", "it", "pt-BR"],
      currentLocale: "it",
      source: "android-locale-manager",
    });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("sets one per-app locale and reports the locale Android read back", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-locale-set-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const applied: Array<{ serial: string; packageName: string; locale: string }> = [];
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "pixel",
          serial: "pixel-1",
          name: "Pixel",
          platform: "android",
          kind: "Pixel 9",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "local",
        deviceSerial: "pixel-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      setAppLocale: async (serial, packageName, locale) => {
        applied.push({ serial, packageName, locale });
        return "iw";
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/locale`, {
      method: "POST",
      headers: headers("target.app.locale.set"),
      body: JSON.stringify({ serial: "pixel-1", package: "ai.x.grok", locale: "he" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      packageName: "ai.x.grok",
      locale: "he",
      observedLocale: "iw",
    });
    assert.deepEqual(applied, [{ serial: "pixel-1", packageName: "ai.x.grok", locale: "he" }]);

    const malformed = await fetch(`http://127.0.0.1:${server.port}/device/app/locale`, {
      method: "POST",
      headers: headers("target.app.locale.set"),
      body: JSON.stringify({ serial: "pixel-1", package: "ai.x.grok" }),
    });
    assert.equal(malformed.status, 400);
    assert.match(await malformed.text(), /target app locale set locale/u);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a locale that never takes fails loudly instead of reporting success", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-locale-mismatch-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "pixel",
          serial: "pixel-1",
          name: "Pixel",
          platform: "android",
          kind: "Pixel 9",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "local",
        deviceSerial: "pixel-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      setAppLocale: async () => {
        throw new Error("app locale he did not take (tried iw)");
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/locale`, {
      method: "POST",
      headers: headers("target.app.locale.set"),
      body: JSON.stringify({ serial: "pixel-1", package: "ai.x.grok", locale: "he" }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as {
      error?: string;
      code?: string;
      recovery?: string;
    };
    assert.match(body.error ?? "", /did not take/u);
    assert.equal(body.code, "APP_LOCALE_DID_NOT_TAKE");
    assert.match(body.recovery ?? "", /locale resources/u);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("launch treats a wedged xcrun as recover, not a 20s mystery", async () => {
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "ipad",
          serial: "ipad-1",
          name: "iPad",
          platform: "ios",
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: "ipad-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      launchApp: async () => {
        throw new Error("xcrun timed out after 20000ms");
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "ai.x.GrokApp" }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { recoveryAction?: { operationId?: string } };
    assert.equal(body.recoveryAction?.operationId, "target.recover");
  } finally {
    await server.close();
  }
});

test("repairs an Apple target through the same actor-aware operation used by agents", async () => {
  const calls: Array<{ serial: string; reason?: string }> = [];
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "ipad",
          serial: "ipad-1",
          name: "iPad",
          platform: "ios",
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: "ipad-1",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      recoverTarget: async (serial, reason) => {
        calls.push({ serial, ...(reason ? { reason } : {}) });
        return {
          serial,
          recovered: true,
          ready: true,
          summary: "Relay repaired the Apple device connection.",
          actions: [
            {
              kind: "stale-lock",
              status: "completed",
              detail: "Removed a lock left by a process that is no longer running.",
            },
          ],
          session: {
            status: "restored",
            app: "com.apple.Preferences",
            fallback: false,
            detail: "Relay restored the app that was active in this workspace.",
          },
        };
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: headers("target.recover"),
      body: JSON.stringify({ serial: "ipad-1", reason: "observe" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ serial: "ipad-1", reason: "observe" }]);
    const body = (await response.json()) as {
      recovery: { ready: boolean; session: { app?: string } };
    };
    assert.equal(body.recovery.ready, true);
    assert.equal(body.recovery.session.app, "com.apple.Preferences");
  } finally {
    await server.close();
  }
});

test("repairs an Android target through the same recover operation", async () => {
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "phone",
          serial: "RQCY104BG8X",
          name: "Pixel",
          platform: "android",
          kind: "device",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "phones",
        deviceSerial: "RQCY104BG8X",
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      recoverTarget: async (serial) => ({
        serial,
        recovered: true,
        ready: true,
        summary: "Relay can read names on this screen.",
        actions: [
          {
            kind: "agent-device",
            status: "completed",
            detail: "Woke the screen and refreshed labels.",
          },
        ],
        session: {
          status: "restored",
          app: "ai.x.grok",
          fallback: false,
          detail: "Relay can read names on this screen.",
        },
      }),
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: headers("target.recover"),
      body: JSON.stringify({ serial: "RQCY104BG8X", reason: "observe" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { recovery: { ready: boolean; summary: string } };
    assert.equal(body.recovery.ready, true);
    assert.match(body.recovery.summary, /read names/i);
  } finally {
    await server.close();
  }
});

test("preflights local campaign capacity from current target, lease, and scheduler facts without admission", async () => {
  let deviceReads = 0;
  let leaseReads = 0;
  let workerReads = 0;
  let controlChecks = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      now: () => 10_000,
      listDevices: async () => {
        deviceReads += 1;
        return [
          {
            id: "pixel-a",
            serial: "pixel-a",
            name: "Pixel A",
            platform: "android" as const,
            kind: "Physical device",
            booted: true,
          },
          {
            id: "ipad-a",
            serial: "ipad-a",
            name: "iPad A",
            platform: "ios" as const,
            kind: "Physical device",
            booted: true,
          },
        ];
      },
      listDeviceLeases: async () => {
        leaseReads += 1;
        return [];
      },
      listTargetWorkers: () => {
        workerReads += 1;
        return [
          {
            workerId: "local:android:target:pixel-a",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
          {
            workerId: "local:ios:target:ipad-a",
            capacity: 1,
            active: 0,
            queued: 0,
            activeTargets: [],
            queuedTargets: [],
          },
        ];
      },
      assertTargetControl: async () => {
        controlChecks += 1;
        throw new Error("read-only preflight must not acquire control");
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/campaign-capacity/preflight`, {
      method: "POST",
      headers: headers("campaign.capacity.preflight"),
      body: JSON.stringify({
        targets: [
          { targetId: "pixel-a", platform: "android" },
          { targetId: "ipad-a", platform: "ios" },
        ],
        workItems: 4,
        workItemsByPlatform: { android: 2, ios: 2 },
        duration: {
          workItemDurationMs: 1_000,
          provenance: "observed-p95",
          observedAt: 9_900,
          sampleCount: 20,
          maxAgeMs: 1_000,
        },
        deadlineMs: 5_000,
        setupHeadroomMs: 500,
        recoveryHeadroomMs: 500,
      }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      preflight: {
        deadline: {
          assurance: string;
          achievableWithCurrentCapacity: boolean;
          estimatedParallelDurationMs: number | null;
        };
        targets: Array<{ targetId: string; workerFact: string }>;
      };
    };
    assert.deepEqual(body.preflight.deadline, {
      assurance: "measured-current",
      achievableWithCurrentCapacity: true,
      estimatedParallelDurationMs: 3_000,
      requestedMs: 5_000,
      reservedHeadroomMs: 1_000,
      workBudgetMs: 4_000,
      capacity: "within-budget",
    });
    assert.deepEqual(
      body.preflight.targets.map((target) => ({
        targetId: target.targetId,
        workerFact: target.workerFact,
      })),
      [
        { targetId: "pixel-a", workerFact: "scheduler" },
        { targetId: "ipad-a", workerFact: "scheduler" },
      ],
    );
    assert.deepEqual(
      { deviceReads, leaseReads, workerReads, controlChecks },
      {
        deviceReads: 1,
        leaseReads: 1,
        workerReads: 1,
        controlChecks: 0,
      },
    );
  } finally {
    await server.close();
  }
});

test("target recovery releases a local durable fence only after a fresh immutable pixel and semantic reproof", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-recovery-fence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const store = new DurableWorkerAssignmentStore(join(root, "recovery-fence.sqlite"));
  const serial = "ipad-recovery-fence";
  seedRecoveryFence(store, serial);
  let captures = 0;
  let recoveryCalls = 0;
  let recoveryForced = false;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      now: () => 20,
      getDurableWorkerAssignments: () => store,
      listDevices: async () => [
        {
          id: "ipad",
          serial,
          name: "iPad",
          platform: "ios" as const,
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: serial,
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      recoverTarget: async (targetSerial, _reason, force) => {
        recoveryCalls += 1;
        recoveryForced = Boolean(force);
        return {
          serial: targetSerial,
          recovered: true,
          ready: true,
          summary: "Relay verified the repaired target.",
          actions: [],
          session: { status: "restored" as const, detail: "Ready for a fresh proof." },
        };
      },
      captureScreenshot: async () => recoveryFenceScreenshot(serial, captures++ === 0 ? 10 : 12),
      captureSnapshot: async () => recoveryFenceSnapshot(serial, 11),
      cleanupScreenshot: async () => undefined,
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: headers("target.recover"),
      body: JSON.stringify({ serial, recoveryFenceAssignmentId: "interrupted-recovery-job" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      recoveryFenceRelease: {
        assignmentId: string;
        releasedAt: number;
        reproofId: string;
        evidence: { manifest: { uri: string }; semanticSnapshot: { uri: string } };
      };
    };
    assert.equal(recoveryCalls, 1);
    assert.equal(recoveryForced, true);
    assert.equal(captures, 2);
    assert.equal(body.recoveryFenceRelease.assignmentId, "interrupted-recovery-job");
    assert.match(
      body.recoveryFenceRelease.reproofId,
      /^durable-recovery-fence-reproof:[a-f0-9]{64}$/u,
    );
    assert.match(body.recoveryFenceRelease.evidence.manifest.uri, /^relay-evidence:\/\//u);
    assert.match(body.recoveryFenceRelease.evidence.semanticSnapshot.uri, /^relay-evidence:\/\//u);
    assert.deepEqual(store.get("interrupted-recovery-job")?.recoveryFenceRelease, {
      releasedAt: 20,
      releasedBy: "human:runtime-test",
      reproofId: body.recoveryFenceRelease.reproofId,
    });
    const activity = await listActivity({ organizationId: "relay", projectId: "runtime-project" });
    const authorization = activity.items.find(
      (item) => item.eventType === "target.recovery-fence.release-authorized",
    );
    assert.equal(authorization?.actorId, "human:runtime-test");
    assert.equal(authorization?.actorKind, "human");
    assert.equal(authorization?.operationId, "target.recover");
    assert.ok(authorization?.requestId, "the release audit must retain the operation request id");
    assert.equal(authorization?.resourceId, "interrupted-recovery-job");
    assert.equal(authorization?.evidenceIds?.length, 3);
  } finally {
    await server.close();
    store.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("target recovery keeps an interrupted fence when fresh semantic evidence is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-recovery-fence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const store = new DurableWorkerAssignmentStore(join(root, "recovery-fence.sqlite"));
  const serial = "ipad-recovery-fence";
  seedRecoveryFence(store, serial);
  let captures = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      getDurableWorkerAssignments: () => store,
      listDevices: async () => [
        {
          id: "ipad",
          serial,
          name: "iPad",
          platform: "ios" as const,
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => ({
        id: "lease",
        projectId: "runtime-project",
        poolId: "tablets",
        deviceSerial: serial,
        ownerId: "human:runtime-test",
        status: "leased",
        leasedAt: 1,
        expiresAt: Date.now() + 60_000,
      }),
      recoverTarget: async (targetSerial) => ({
        serial: targetSerial,
        recovered: true,
        ready: true,
        summary: "Relay repaired the device connection.",
        actions: [],
        session: { status: "restored" as const, detail: "Pixels remain available." },
      }),
      captureScreenshot: async () => recoveryFenceScreenshot(serial, captures++ === 0 ? 10 : 12),
      captureSnapshot: async () => ({
        ...recoveryFenceSnapshot(serial, 11),
        inspectable: false,
        nodes: [],
        interactive: [],
        source: "pixels-only" as const,
        readiness: {
          ...recoveryFenceReadiness(),
          semanticControl: {
            mode: "accessibility" as const,
            state: "unavailable" as const,
            freshness: "unproven" as const,
            reason: "probe-failed" as const,
          },
        },
      }),
      cleanupScreenshot: async () => undefined,
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: headers("target.recover"),
      body: JSON.stringify({ serial, recoveryFenceAssignmentId: "interrupted-recovery-job" }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "DURABLE_RECOVERY_FENCE_SEMANTIC_EVIDENCE_INVALID");
    assert.equal(captures, 2, "the semantic read is bracketed even when it cannot release");
    assert.equal(store.get("interrupted-recovery-job")?.recoveryFenceRelease, undefined);
  } finally {
    await server.close();
    store.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("target recovery rejects a durable fence from another target before it starts recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-recovery-fence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const store = new DurableWorkerAssignmentStore(join(root, "recovery-fence.sqlite"));
  seedRecoveryFence(store, "ipad-fenced");
  let recoveryCalls = 0;
  let captureCalls = 0;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      getDurableWorkerAssignments: () => store,
      listDevices: async () => [
        {
          id: "other-ipad",
          serial: "ipad-other",
          name: "Other iPad",
          platform: "ios" as const,
          kind: "iPad Pro",
          booted: true,
        },
      ],
      assertTargetControl: async () => {
        throw new Error("target control must not be acquired for a mismatched fence");
      },
      recoverTarget: async () => {
        recoveryCalls += 1;
        throw new Error("recovery must not run for a mismatched fence");
      },
      captureScreenshot: async () => {
        captureCalls += 1;
        throw new Error("capture must not run for a mismatched fence");
      },
      captureSnapshot: async () => {
        captureCalls += 1;
        throw new Error("capture must not run for a mismatched fence");
      },
      cleanupScreenshot: async () => undefined,
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: headers("target.recover"),
      body: JSON.stringify({
        serial: "ipad-other",
        recoveryFenceAssignmentId: "interrupted-recovery-job",
      }),
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "DURABLE_RECOVERY_FENCE_TARGET_MISMATCH");
    assert.equal(recoveryCalls, 0);
    assert.equal(captureCalls, 0);
    assert.equal(store.get("interrupted-recovery-job")?.recoveryFenceRelease, undefined);
  } finally {
    await server.close();
    store.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a network-authenticated recovery request cannot release a local durable fence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-recovery-fence-remote-"));
  const previous = {
    stateDir: process.env.RELAY_STATE_DIR,
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_REDACTION_MODE = "on";
  process.env.RELAY_AUTH_ROLE = "runner";
  process.env.RELAY_AUTH_ORGANIZATION_ID = "relay";
  process.env.RELAY_AUTH_PROJECT_IDS = "runtime-project";
  const token = "target-recovery-fence-remote-test-token";
  let targetWork = 0;
  const server = await startServer({
    host: "0.0.0.0",
    port: 0,
    token,
    targetRuntime: {
      getDurableWorkerAssignments: () => {
        throw new Error("remote callers must not read local durable assignments");
      },
      listDevices: async () => {
        targetWork += 1;
        return [];
      },
      assertTargetControl: async () => {
        targetWork += 1;
        throw new Error("remote callers must not acquire target control");
      },
      recoverTarget: async () => {
        targetWork += 1;
        throw new Error("remote callers must not start target recovery");
      },
      captureScreenshot: async () => {
        targetWork += 1;
        throw new Error("remote callers must not capture local evidence");
      },
      captureSnapshot: async () => {
        targetWork += 1;
        throw new Error("remote callers must not capture local evidence");
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/recover`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-project-id": "runtime-project",
        "x-organization-id": "relay",
        "x-relay-operation-id": "target.recover",
        "x-relay-request-id": crypto.randomUUID(),
        "x-relay-command-at": String(Date.now()),
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        serial: "ipad-1",
        recoveryFenceAssignmentId: "interrupted-recovery-job",
      }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Durable recovery-fence release is available only from the local Relay host",
      code: "DURABLE_RECOVERY_FENCE_LOCAL_ONLY",
    });
    assert.equal(targetWork, 0);
  } finally {
    await server.close();
    if (previous.stateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.stateDir;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    await rm(root, { recursive: true, force: true });
  }
});

test("lists launchable apps on the selected Android device", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-locales-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    targetRuntime: {
      listDevices: async () => [
        {
          id: "pixel",
          serial: "pixel-1",
          name: "Pixel",
          platform: "android",
          kind: "Pixel 9",
          booted: true,
        },
      ],
      listAndroidInstalledApps: async (serial) => {
        assert.equal(serial, "pixel-1");
        return [{ package: "com.android.settings", name: "Settings" }];
      },
    },
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/device/apps?serial=pixel-1`, {
      headers: headers("target.app.list"),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      apps: [{ package: "com.android.settings", name: "Settings" }],
    });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
