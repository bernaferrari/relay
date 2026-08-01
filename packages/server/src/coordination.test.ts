import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import {
  leaseDevice,
  publish,
  runWithOperationContext,
  runWithTargetContext,
  subscribe,
  targetIdentity,
  type DeviceEvent,
  type OperationContext,
} from "@relay/core";
import { startServer } from "./index.js";
import { assertTargetControl, assertTargetLease } from "./access-control.js";

test("Journey and Collection writes are atomic, revision-safe, idempotent, and attributable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-coordination-"));
  const previous = {
    workspace: process.env.RELAY_WORKSPACE_ROOT,
    recipes: process.env.RELAY_RECIPES_DIR,
    tests: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const events: DeviceEvent[] = [];
  const unsubscribe = subscribe((event) => events.push(event));
  const client = new RelayClient({
    url: `http://127.0.0.1:${server.port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "default",
    actorId: "agent:writer-test",
    actorKind: "agent",
  });
  try {
    const created = await client.invoke(
      "journey.create",
      { expectedRevision: 0, title: "Checkout", steps: [] },
      { idempotencyKey: "journey-create" },
    );
    const journey = created.journey;
    const contenders = await Promise.allSettled([
      client.invoke("journey.update", {
        journeyId: journey.id,
        expectedRevision: journey.updatedAt,
        title: "Checkout A",
        steps: [],
      }),
      client.invoke("journey.update", {
        journeyId: journey.id,
        expectedRevision: journey.updatedAt,
        title: "Checkout B",
        steps: [],
      }),
    ]);
    assert.equal(
      contenders.filter((result) => result.status === "fulfilled").length,
      1,
      JSON.stringify(
        contenders.map((result) =>
          result.status === "fulfilled"
            ? { status: result.status }
            : {
                status: result.status,
                name: result.reason instanceof Error ? result.reason.name : typeof result.reason,
                message:
                  result.reason instanceof Error ? result.reason.message : String(result.reason),
                apiStatus: result.reason instanceof ApiError ? result.reason.status : undefined,
                body: result.reason instanceof ApiError ? result.reason.body : undefined,
              },
        ),
      ),
    );
    const rejected = contenders.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof ApiError);
    assert.equal((rejected.reason as ApiError).status, 409);

    const retryCreated = await client.invoke(
      "journey.create",
      {
        expectedRevision: 0,
        title: "Idempotent Journey",
        steps: [],
      },
      { idempotencyKey: "journey-retry" },
    );
    const retry = await client.invoke(
      "journey.create",
      {
        expectedRevision: 0,
        title: "Idempotent Journey",
        steps: [],
      },
      { idempotencyKey: "journey-retry" },
    );
    assert.deepEqual(retry, retryCreated);
    await assert.rejects(
      () =>
        client.invoke(
          "journey.create",
          { expectedRevision: 0, title: "Different payload", steps: [] },
          { idempotencyKey: "journey-retry" },
        ),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );

    const collectionCreated = await client.invoke(
      "collection.create",
      { expectedRevision: 0, title: "Release", sections: [] },
      { idempotencyKey: "journey-retry" },
    );
    const collection = collectionCreated.collection;
    const collectionContenders = await Promise.allSettled([
      client.invoke("collection.update", {
        collectionId: collection.id,
        expectedRevision: collection.updatedAt,
        title: "Release A",
        sections: [],
      }),
      client.invoke("collection.update", {
        collectionId: collection.id,
        expectedRevision: collection.updatedAt,
        title: "Release B",
        sections: [],
      }),
    ]);
    assert.equal(collectionContenders.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      collectionContenders.filter(
        (result) => result.status === "rejected" && result.reason instanceof ApiError,
      ).length,
      1,
    );

    assert.equal(
      (await readdir(process.env.RELAY_TESTS_DIR)).some((name) => name.endsWith(".tmp")),
      false,
    );
    assert.equal(
      (await readdir(join(root, ".relay", "suites"))).some((name) => name.endsWith(".tmp")),
      false,
    );
    const attributed = events.find(
      (event) =>
        event.payload.type === "resource.created" &&
        event.payload.resource === "journey" &&
        event.payload.resourceId === journey.id,
    );
    assert.equal(attributed?.actorId, "agent:writer-test");
    assert.equal(attributed?.operationId, "journey.create");
    assert.ok(attributed?.requestId);

    const humanClient = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:editor-test",
      actorKind: "human",
    });
    const [agentWrite, humanWrite] = await Promise.all([
      client.invoke(
        "journey.create",
        { expectedRevision: 0, title: "Agent branch", steps: [] },
        { idempotencyKey: "agent-concurrent-create" },
      ),
      humanClient.invoke(
        "journey.create",
        { expectedRevision: 0, title: "Human branch", steps: [] },
        { idempotencyKey: "human-concurrent-create" },
      ),
    ]);
    assert.equal(
      events.find(
        (event) =>
          event.payload.type === "resource.created" &&
          event.payload.resourceId === agentWrite.journey.id,
      )?.actorId,
      "agent:writer-test",
    );
    assert.equal(
      events.find(
        (event) =>
          event.payload.type === "resource.created" &&
          event.payload.resourceId === humanWrite.journey.id,
      )?.actorId,
      "human:editor-test",
    );
  } finally {
    unsubscribe();
    await server.close();
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
    else process.env.RELAY_RECIPES_DIR = previous.recipes;
    if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
    else process.env.RELAY_TESTS_DIR = previous.tests;
    await rm(root, { recursive: true, force: true });
  }
});

test("two actors keep target context, lease ownership, environment, and event identity isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-target-isolation-"));
  const previousState = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
  const environmentBefore = {
    relayTarget: process.env.RELAY_TARGET_ID,
    agentSerial: process.env.AGENT_DEVICE_SERIAL,
    androidSerial: process.env.ANDROID_SERIAL,
    platform: process.env.AGENT_DEVICE_PLATFORM,
  };
  const scope = {
    subject: "local-user",
    organizationId: "local",
    projectId: "default",
    allowedProjects: ["default"],
    tokenKind: "local" as const,
    localTrusted: true,
  };
  const command = (actorId: string, requestId: string): OperationContext => ({
    schemaVersion: 1,
    actorId,
    actorKind: "agent",
    organizationId: "local",
    projectId: "default",
    operationId: "target.snapshot.capture",
    requestId,
    idempotencyKey: requestId,
    issuedAt: Date.now(),
  });
  const leaseA = await leaseDevice({
    projectId: "default",
    poolId: "fake",
    deviceSerial: "target-a",
    ownerId: "agent:a",
    expiresAt: Date.now() + 60_000,
  });
  const leaseB = await leaseDevice({
    projectId: "default",
    poolId: "fake",
    deviceSerial: "target-b",
    ownerId: "agent:b",
    expiresAt: Date.now() + 60_000,
  });
  const events: DeviceEvent[] = [];
  const unsubscribe = subscribe((event) => events.push(event));
  try {
    const identities = await Promise.all([
      runWithOperationContext(command("agent:a", "request-a"), () =>
        runWithTargetContext(
          { kind: "device", platform: "android", serial: "target-a" },
          async () => {
            await assertTargetControl(scope, "target-a");
            await new Promise((resolve) => setTimeout(resolve, 10));
            const serial = targetIdentity();
            publish({ type: "snapshot.captured", at: Date.now(), serial, nodeCount: 0 });
            return serial;
          },
        ),
      ),
      runWithOperationContext(command("agent:b", "request-b"), () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "target-b" }, async () => {
          await assertTargetControl(scope, "target-b");
          const serial = targetIdentity();
          publish({ type: "snapshot.captured", at: Date.now(), serial, nodeCount: 0 });
          return serial;
        }),
      ),
    ]);
    assert.deepEqual(identities, ["target-a", "target-b"]);
    await assert.rejects(
      async () =>
        await runWithOperationContext(command("agent:a", "request-cross"), () =>
          assertTargetControl(scope, "target-b"),
        ),
      /active lease owned by this caller/,
    );
    await assert.rejects(
      async () =>
        await runWithOperationContext(command("agent:a", "request-stream-cross"), () =>
          assertTargetLease(scope, "target-b", leaseB.id),
        ),
      /lease is unavailable/,
    );
    const eventA = events.find((event) => event.requestId === "request-a");
    const eventB = events.find((event) => event.requestId === "request-b");
    assert.equal(eventA?.actorId, "agent:a");
    assert.equal(eventA?.leaseId, leaseA.id);
    assert.equal(
      eventA && "serial" in eventA.payload ? eventA.payload.serial : undefined,
      "target-a",
    );
    assert.equal(eventB?.actorId, "agent:b");
    assert.equal(eventB?.leaseId, leaseB.id);
    assert.equal(
      eventB && "serial" in eventB.payload ? eventB.payload.serial : undefined,
      "target-b",
    );
    assert.deepEqual(
      {
        relayTarget: process.env.RELAY_TARGET_ID,
        agentSerial: process.env.AGENT_DEVICE_SERIAL,
        androidSerial: process.env.ANDROID_SERIAL,
        platform: process.env.AGENT_DEVICE_PLATFORM,
      },
      environmentBefore,
    );
  } finally {
    unsubscribe();
    if (previousState === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("authenticated service requests cannot impersonate human or system actors", async () => {
  const token = "relay-coordination-token-123456";
  const previous = {
    subject: process.env.RELAY_AUTH_SUBJECT,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_AUTH_SUBJECT = "service:indexer";
  process.env.RELAY_AUTH_ORGANIZATION_ID = "local";
  process.env.RELAY_AUTH_PROJECT_IDS = "default";
  const server = await startServer({ host: "127.0.0.1", port: 0, token });
  try {
    const impersonating = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "bearer", token },
      organizationId: "local",
      projectId: "default",
      actorId: "human:admin",
      actorKind: "human",
    });
    await assert.rejects(
      () => impersonating.health(),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );

    const service = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "bearer", token },
      organizationId: "local",
      projectId: "default",
      actorId: "service:indexer",
      actorKind: "agent",
    });
    assert.equal((await service.health()).ok, true);
  } finally {
    await server.close();
    if (previous.subject === undefined) delete process.env.RELAY_AUTH_SUBJECT;
    else process.env.RELAY_AUTH_SUBJECT = previous.subject;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
  }
});
