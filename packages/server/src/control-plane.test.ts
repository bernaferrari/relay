import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient, ApiError } from "@relay/client";
import { startServer } from "./index.js";

function operationHeaders(
  operationId: string,
  actorId = "human:control-plane-test",
): Record<string, string> {
  return {
    "x-relay-actor-id": actorId,
    "x-relay-actor-kind": actorId.startsWith("human:") ? "human" : "agent",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

test("project-scoped variables persist and expose revision conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-state-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "chatgpt-ios",
      actorId: "human:test",
      actorKind: "human",
    });
    const initial = await client.variables();
    assert.equal(initial.revision, 0);
    const saved = await client.updateVariables({
      expectedRevision: 0,
      value: [
        {
          id: "prompt",
          name: "prompt",
          scope: "shared",
          source: "generated",
          prompt: "A novel QA prompt",
          fallback: "Hello",
        },
      ],
    });
    assert.equal(saved.revision, 1);
    await assert.rejects(
      client.updateVariables({ expectedRevision: 0, value: [] }),
      (error) => error instanceof ApiError && error.status === 409,
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("loopback API accepts only configured Relay browser origins without bearer auth", async () => {
  const origin = "http://relay-desktop.test:5173";
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    browserOrigins: [origin],
  });
  const url = `http://127.0.0.1:${server.port}/health`;
  try {
    const denied = await fetch(url, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const allowed = await fetch(url, {
      headers: { Origin: origin, ...operationHeaders("system.health.get") },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  } finally {
    await server.close();
  }
});

test("authenticated browser requests may use an unconfigured origin without granting local trust", async () => {
  const token = "browser-service-token-with-32-characters";
  const origin = "https://self-managed.relay.test";
  const server = await startServer({ host: "127.0.0.1", port: 0, token });
  const url = `http://127.0.0.1:${server.port}/health`;
  try {
    const denied = await fetch(url, { headers: { Origin: origin } });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);

    const allowed = await fetch(url, {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);

    const unauthenticatedPreflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(unauthenticatedPreflight.status, 403);
  } finally {
    await server.close();
  }
});

test("network static tokens refuse implicit administrator and default project scope", async () => {
  const previous = {
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
  };
  delete process.env.RELAY_AUTH_ORGANIZATION_ID;
  delete process.env.RELAY_AUTH_PROJECT_IDS;
  delete process.env.RELAY_AUTH_ROLE;
  process.env.RELAY_REDACTION_MODE = "on";
  try {
    await assert.rejects(
      startServer({
        host: "0.0.0.0",
        port: 0,
        token: "missing-static-service-scope-token",
      }),
      /RELAY_AUTH_ROLE.*RELAY_AUTH_ORGANIZATION_ID.*RELAY_AUTH_PROJECT_IDS/,
    );
  } finally {
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
  }
});

test("mobile setup endpoints report prerequisites and persist Apple runner settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-device-settings-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousAgentDeviceStateDir = process.env.AGENT_DEVICE_STATE_DIR;
  const previousTeam = process.env.AGENT_DEVICE_IOS_TEAM_ID;
  const previousBundle = process.env.AGENT_DEVICE_IOS_BUNDLE_ID;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.AGENT_DEVICE_STATE_DIR = join(root, "agent-device");
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const android = await fetch(`${baseUrl}/settings/devices/android`);
    assert.equal(android.status, 200);
    const androidBody = (await android.json()) as { checks: Array<{ id: string }> };
    assert.equal(androidBody.checks[0]?.id, "adb");

    const beforeSetup = await fetch(`${baseUrl}/settings/devices/apple/preflight`);
    assert.equal(beforeSetup.status, 200);
    assert.deepEqual(await beforeSetup.json(), { configured: false });

    const saved = await fetch(`${baseUrl}/settings/devices/apple`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...operationHeaders("workspace.apple-device.update"),
      },
      body: JSON.stringify({
        teamId: "ABCDE12345",
        bundleId: "com.example.relay.runner",
      }),
    });
    assert.equal(saved.status, 200);
    const apple = await fetch(`${baseUrl}/settings/devices/apple`);
    const appleBody = (await apple.json()) as { setup: { ios?: { teamId?: string } } };
    assert.equal(appleBody.setup.ios?.teamId, "ABCDE12345");

    const afterSetup = await fetch(`${baseUrl}/settings/devices/apple/preflight`);
    assert.equal(afterSetup.status, 200);
    assert.deepEqual(await afterSetup.json(), { configured: true });
  } finally {
    await server.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousAgentDeviceStateDir === undefined) delete process.env.AGENT_DEVICE_STATE_DIR;
    else process.env.AGENT_DEVICE_STATE_DIR = previousAgentDeviceStateDir;
    if (previousTeam === undefined) delete process.env.AGENT_DEVICE_IOS_TEAM_ID;
    else process.env.AGENT_DEVICE_IOS_TEAM_ID = previousTeam;
    if (previousBundle === undefined) delete process.env.AGENT_DEVICE_IOS_BUNDLE_ID;
    else process.env.AGENT_DEVICE_IOS_BUNDLE_ID = previousBundle;
    await rm(root, { recursive: true, force: true });
  }
});

test("authenticated network service cannot read unowned workspace assets", async () => {
  const token = "test-service-token-with-24-characters";
  const previous = {
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
  };
  process.env.RELAY_AUTH_ORGANIZATION_ID = "acme";
  process.env.RELAY_AUTH_PROJECT_IDS = "project-a";
  process.env.RELAY_AUTH_ROLE = "runner";
  process.env.RELAY_REDACTION_MODE = "on";
  const server = await startServer({ host: "0.0.0.0", port: 0, token });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/discovery`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-project-id": "project-a",
        ...operationHeaders("discovery.list", "configured-service"),
      },
    });
    assert.equal(response.status, 403);

    const health = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-project-id": "project-a",
        ...operationHeaders("system.health.get", "configured-service"),
      },
    });
    assert.equal(health.status, 200);
  } finally {
    await server.close();
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
  }
});

test("legacy Recipe authoring and evidence routes are absent", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const requests: Array<{ method: string; path: string }> = [
    { method: "GET", path: "/recipes" },
    { method: "POST", path: "/recipes" },
    { method: "GET", path: "/recipes/legacy" },
    { method: "PUT", path: "/recipes/legacy" },
    { method: "DELETE", path: "/recipes/legacy" },
    { method: "GET", path: "/recipes/legacy/yaml" },
    { method: "POST", path: "/recipes/import" },
    { method: "POST", path: "/recipes/legacy/evidence" },
    { method: "GET", path: "/recipes/legacy/evidence/image" },
    { method: "GET", path: "/recipes/legacy/history" },
    { method: "POST", path: "/recipes/legacy/history" },
    { method: "GET", path: "/recipes/legacy/stability" },
  ];
  try {
    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        ...(request.method === "POST" || request.method === "PUT"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
      });
      assert.equal(response.status, 404, `${request.method} ${request.path}`);
    }
  } finally {
    await server.close();
  }
});

test("authenticated network service only sees schedules for its project", async () => {
  const token = "test-service-token-with-24-characters";
  const root = await mkdtemp(join(tmpdir(), "relay-schedules-scope-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previous = {
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_AUTH_ORGANIZATION_ID = "acme";
  process.env.RELAY_AUTH_PROJECT_IDS = "project-a";
  process.env.RELAY_AUTH_ROLE = "runner";
  process.env.RELAY_REDACTION_MODE = "on";
  const { saveSchedule } = await import("@relay/core");
  await saveSchedule({
    recipeId: "login",
    targetKind: "device",
    targetId: "pixel",
    platform: "android",
    intervalMinutes: 60,
    projectId: "project-a",
  });
  await saveSchedule({
    recipeId: "checkout",
    targetKind: "device",
    targetId: "pixel",
    platform: "android",
    intervalMinutes: 60,
    projectId: "project-b",
  });
  const server = await startServer({ host: "0.0.0.0", port: 0, token });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/schedules`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-project-id": "project-a",
        ...operationHeaders("schedule.list", "configured-service"),
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      schedules: Array<{ projectId: string; recipeId: string }>;
    };
    assert.equal(body.schedules.length, 1);
    assert.equal(body.schedules[0]?.projectId, "project-a");
    assert.equal(body.schedules[0]?.recipeId, "login");
  } finally {
    await server.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    await rm(root, { recursive: true, force: true });
  }
});
