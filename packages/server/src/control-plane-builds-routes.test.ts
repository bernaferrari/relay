import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startServer } from "./index.js";

function headers(operationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-project-id": "build-ingest-project",
    "x-organization-id": "relay",
    "x-relay-actor-id": "human:build-ingest-test",
    "x-relay-actor-kind": "human",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

test("POST /builds accepts local paths and https sources but rejects other schemes", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-build-routes-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = join(root, "state");
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const local = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "local-build",
        name: "Local build",
        platform: "android",
        sourceUrl: "/tmp/app.apk",
        status: "ready",
      }),
    });
    assert.equal(local.status, 201);
    const localBody = (await local.json()) as {
      build: { sourceUrl?: string; sourceSha256?: string };
    };
    assert.equal(localBody.build.sourceUrl, "/tmp/app.apk");
    assert.equal(localBody.build.sourceSha256, undefined);

    const https = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "https-build",
        name: "Https build",
        platform: "android",
        sourceUrl: "https://artifacts.example.com/app.apk",
        sourceSha256: `a${"b".repeat(63)}`,
        status: "ready",
      }),
    });
    assert.equal(https.status, 201);
    const httpsBody = (await https.json()) as {
      build: { sourceUrl?: string; sourceSha256?: string };
    };
    assert.equal(httpsBody.build.sourceUrl, "https://artifacts.example.com/app.apk");
    assert.equal(httpsBody.build.sourceSha256, `a${"b".repeat(63)}`);

    for (const sourceUrl of [
      "http://artifacts.example.com/app.apk",
      "file:///tmp/app.apk",
    ]) {
      const rejected = await fetch(`${base}/builds`, {
        method: "POST",
        headers: headers("build.save"),
        body: JSON.stringify({
          id: "rejected-build",
          name: "Rejected build",
          platform: "android",
          sourceUrl,
          status: "ready",
        }),
      });
      assert.equal(rejected.status, 400, `expected 400 for ${sourceUrl}`);
    }

    const badSha = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "bad-sha-build",
        name: "Bad sha build",
        platform: "android",
        sourceUrl: "https://artifacts.example.com/app.apk",
        sourceSha256: "not-a-digest",
        status: "ready",
      }),
    });
    assert.equal(badSha.status, 400);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
