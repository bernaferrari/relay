import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startServer } from "./index.js";

const headers = (projectId: string, operation: string) => ({
  "content-type": "application/json",
  "idempotency-key": crypto.randomUUID(),
  "x-project-id": projectId,
  "x-relay-actor-id": "human:fixture-test",
  "x-relay-actor-kind": "human",
  "x-relay-operation-id": operation,
  "x-relay-request-id": crypto.randomUUID(),
  "x-relay-command-at": String(Date.now()),
});

test("fixture operations import through HTTP, isolate projects and reject traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fixture-api-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${server.port}/fixtures`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers("one", "fixture.import"),
      body: JSON.stringify({
        name: "video-fixture.bin",
        base64: Buffer.alloc(2 * 1024 * 1024, 42).toString("base64"),
      }),
    });
    assert.equal(response.status, 201, await response.clone().text());
    const imported = await response.json();
    assert.equal(imported.fixture.size, 2 * 1024 * 1024);
    assert.match(imported.fixture.file, /^fixture:[a-f0-9]{64}\/video-fixture.bin$/u);
    const list = await fetch(url, { headers: headers("one", "fixture.list") });
    assert.deepEqual(await list.json(), { fixtures: [imported.fixture] });
    const other = await fetch(url, { headers: headers("two", "fixture.list") });
    assert.deepEqual(await other.json(), { fixtures: [] });
    const invalid = await fetch(url, {
      method: "POST",
      headers: headers("one", "fixture.import"),
      body: JSON.stringify({ name: "../escape", base64: "aGVsbG8=" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("fixture import requires authenticated author access", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-fixture-access-"));
  const keys = ["RELAY_STATE_DIR", "RELAY_AUTH_ROLE", "RELAY_AUTH_PROJECT_IDS"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_AUTH_ROLE = "viewer";
  process.env.RELAY_AUTH_PROJECT_IDS = "one";
  const token = crypto.randomUUID();
  const server = await startServer({ host: "127.0.0.1", port: 0, token });
  const url = `http://127.0.0.1:${server.port}/fixtures`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers("one", "fixture.import"),
        authorization: `Bearer ${token}`,
        "x-relay-actor-id": "configured-service",
        "x-relay-actor-kind": "agent",
      },
      body: JSON.stringify({ name: "test.txt", base64: "aGVsbG8=" }),
    });
    assert.equal(response.status, 403, await response.text());
  } finally {
    await server.close();
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
