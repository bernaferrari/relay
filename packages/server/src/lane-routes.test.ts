import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { createAppMap, resetControlDatabaseCache } from "@relay/core";
import { startServer } from "./index.js";

test("lane.list, lane.save, and lane.remove persist through HTTP", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lane-http-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    await createAppMap({
      organizationId: "local",
      projectId: "default",
      appMapId: "shop-web",
      name: "Shop",
    });
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:lane-http",
      actorKind: "human",
    });
    const saved = await client.invoke("lane.save", {
      id: "shop-lab",
      appMapId: "shop-web",
      target: { kind: "browser", browserTargetId: "shop-web" },
      targetProfileId: "browser:shop-web-1280x800-lab",
      engine: "chromium",
      account: {
        kind: "fixture",
        accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        accountRevision: "1",
        reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
      },
    });
    assert.equal(saved.lane.id, "shop-lab");
    const listed = await client.invoke("lane.list", {});
    assert.equal(listed.lanes.length, 1);
    await client.invoke("lane.remove", { laneId: "shop-lab" });
    assert.deepEqual((await client.invoke("lane.list", {})).lanes, []);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
