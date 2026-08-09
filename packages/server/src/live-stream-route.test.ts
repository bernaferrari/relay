import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { currentOperationContext, leaseDevice } from "@relay/core";
import { startServer } from "./index.js";

test("authenticates and attributes a live stream through its active lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-live-stream-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
    state: process.env.RELAY_STATE_DIR,
    authSubject: process.env.RELAY_AUTH_SUBJECT,
    authProjects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_AUTH_SUBJECT = "agent:stream-test";
  process.env.RELAY_AUTH_PROJECT_IDS = "default";
  const token = "relay-live-stream-test-token";
  const serial = "android-stream-test";
  const lease = await leaseDevice({
    projectId: "default",
    poolId: "local",
    deviceSerial: serial,
    ownerId: "agent:stream-test",
    expiresAt: Date.now() + 60_000,
  });
  let observedContext: ReturnType<typeof currentOperationContext>;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    token,
    liveVideoStream: async (response, streamedSerial) => {
      observedContext = currentOperationContext();
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(streamedSerial);
    },
  });
  const url = `http://127.0.0.1:${server.port}/device/stream?serial=${serial}&lease=${lease.id}`;

  try {
    const unauthenticated = await fetch(url);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), serial);
    assert.equal(observedContext?.actorId, "agent:stream-test");
    assert.equal(observedContext?.operationId, "target.stream.open");
    assert.equal(observedContext?.leaseId, lease.id);

    const wrongTarget = await fetch(
      `http://127.0.0.1:${server.port}/device/stream?serial=other&lease=${lease.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(wrongTarget.status, 403);

    const inferredLease = await fetch(
      `http://127.0.0.1:${server.port}/device/stream?serial=${serial}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-relay-actor-id": "agent:stream-test",
          "x-relay-actor-kind": "agent",
        },
      },
    );
    assert.equal(inferredLease.status, 200);
    assert.equal(await inferredLease.text(), serial);

    const noLease = await fetch(`http://127.0.0.1:${server.port}/device/stream?serial=unowned`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-relay-actor-id": "agent:stream-test",
        "x-relay-actor-kind": "agent",
      },
    });
    assert.equal(noLease.status, 403);
    assert.match(await noLease.text(), /target lease is required/i);
  } finally {
    await server.close();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.authSubject === undefined) delete process.env.RELAY_AUTH_SUBJECT;
    else process.env.RELAY_AUTH_SUBJECT = previous.authSubject;
    if (previous.authProjects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.authProjects;
    await rm(root, { recursive: true, force: true });
  }
});

test("lets the loopback renderer derive stream attribution from the lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-local-stream-"));
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const serial = "android-local-stream";
  const lease = await leaseDevice({
    projectId: "default",
    poolId: "local",
    deviceSerial: serial,
    ownerId: "human:renderer",
    expiresAt: Date.now() + 60_000,
  });
  let actorId: string | undefined;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    liveVideoStream: async (response) => {
      actorId = currentOperationContext()?.actorId;
      response.writeHead(204);
      response.end();
    },
  });
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.port}/device/stream?serial=${serial}&lease=${lease.id}`,
    );
    assert.equal(response.status, 204);
    assert.equal(actorId, "human:renderer");
  } finally {
    await server.close();
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
