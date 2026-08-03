import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { subscribe, type DeviceEvent } from "@relay/core";
import { startServer } from "./index.js";

test("App Map writes are revision-safe, idempotent, and attributable", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-coordination-"));
  const appMapId = `checkout-${crypto.randomUUID().slice(0, 8)}`;
  const previousRelay = process.env.RELAY_STATE_DIR;
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_STATE_DIR = root;
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
      "app-map.create",
      { appMapId, name: "Checkout" },
      { idempotencyKey: "map-create" },
    );
    const repeated = await client.invoke(
      "app-map.create",
      { appMapId, name: "Checkout" },
      { idempotencyKey: "map-create" },
    );
    assert.deepEqual(repeated, created);

    const contenders = await Promise.allSettled([
      client.invoke("app-map.update", {
        appMapId,
        expectedRevision: created.appMap.revision,
        patch: { name: "Checkout A" },
      }),
      client.invoke("app-map.update", {
        appMapId,
        expectedRevision: created.appMap.revision,
        patch: { name: "Checkout B" },
      }),
    ]);
    assert.equal(contenders.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = contenders.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.ok(rejected.reason instanceof ApiError);
    assert.equal(rejected.reason.status, 409);

    const attributed = events.find(
      (event) =>
        event.payload.type === "resource.created" &&
        event.payload.resource === "app-map" &&
        event.payload.resourceId === appMapId,
    );
    assert.equal(attributed?.actorId, "agent:writer-test");
    assert.equal(attributed?.operationId, "app-map.create");
    assert.ok(attributed?.requestId);
  } finally {
    unsubscribe();
    await server.close();
    if (previousRelay === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousRelay;
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
