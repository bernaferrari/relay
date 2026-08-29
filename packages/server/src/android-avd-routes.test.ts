import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient } from "@relay/client";
import { resetControlDatabaseCache } from "@relay/core";
import { startServer } from "./index.js";

test("AVD inventory stays separate from connected devices and boot requires one exact name", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-avd-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${server.port}`;
  const client = new RelayClient({
    url,
    auth: { type: "none" },
    organizationId: "relay",
    projectId: "avd-routes",
    actorId: "human:avd-routes-test",
    actorKind: "human",
  });
  try {
    const { inventory } = await client.invoke("target.avds.list", {});
    assert.ok(inventory.source === "android-sdk" || inventory.source === "unavailable");
    assert.ok(inventory.avds.every(({ serial, booted }) => booted || serial === undefined));

    const missingName = await fetch(`${url}/device/avd/boot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missingName.status, 400);
    assert.match(JSON.stringify(await missingName.json()), /avdName is required/u);
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    resetControlDatabaseCache();
    await rm(root, { recursive: true, force: true });
  }
});
