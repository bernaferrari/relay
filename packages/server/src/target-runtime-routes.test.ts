import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    },
  });
  try {
    const defaultResponse = await fetch(`http://127.0.0.1:${server.port}/device/app/launch`, {
      method: "POST",
      headers: headers("target.app.launch"),
      body: JSON.stringify({ serial: "ipad-1", app: "Grok" }),
    });
    assert.equal(defaultResponse.status, 200);
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
  } finally {
    await server.close();
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

test("discovers every locale declared by an installed Android app", async () => {
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
        return ["en", "it", "pt-BR"];
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
    });
  } finally {
    await server.close();
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
