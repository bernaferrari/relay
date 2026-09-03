import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { issueWebBuildProviderReceipt } from "@relay/core";
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
        sourceSha: "1".repeat(40),
        configuration: "android.debug",
        environmentRevision: "local-v1",
        applicationId: "com.example.app",
        status: "ready",
      }),
    });
    assert.equal(local.status, 201);
    const localBody = (await local.json()) as {
      build: {
        sourceUrl?: string;
        sourceSha256?: string;
        sourceSha?: string;
        configuration?: string;
        environmentRevision?: string;
        applicationId?: string;
      };
    };
    assert.equal(localBody.build.sourceUrl, "/tmp/app.apk");
    assert.equal(localBody.build.sourceSha256, undefined);
    assert.equal(localBody.build.sourceSha, "1".repeat(40));
    assert.equal(localBody.build.configuration, "android.debug");
    assert.equal(localBody.build.environmentRevision, "local-v1");
    assert.equal(localBody.build.applicationId, "com.example.app");

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

    const webReceipt = await issueWebBuildProviderReceipt({
      provider: "preview-host",
      deploymentId: "web-preview",
      sourceUrl: "https://preview.example.com/pr-184",
      sourceSha: "2".repeat(40),
      deploymentDigest: `sha256:${"c".repeat(64)}`,
      configuration: "web.production",
      environmentRevision: "preview-v12",
    });
    const web = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "web-preview",
        name: "Web preview",
        platform: "web",
        webDeploymentMode: "provider-verified",
        webProviderReceipt: webReceipt,
        status: "ready",
      }),
    });
    assert.equal(web.status, 201);
    const webBody = (await web.json()) as {
      build: {
        platform: string;
        sourceUrl?: string;
        sourceSha?: string;
        deploymentDigest?: string;
      };
    };
    assert.equal(webBody.build.platform, "web");
    assert.equal(webBody.build.sourceUrl, "https://preview.example.com/pr-184");
    assert.equal(webBody.build.sourceSha, "2".repeat(40));
    assert.equal(webBody.build.deploymentDigest, `sha256:${"c".repeat(64)}`);

    const selfManaged = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "web-local",
        name: "Local web development",
        platform: "web",
        webDeploymentMode: "self-managed",
        sourceUrl: "http://localhost:4173",
        status: "ready",
      }),
    });
    assert.equal(selfManaged.status, 201);
    const selfManagedBody = (await selfManaged.json()) as {
      build: { webDeploymentMode?: string; webProviderReceipt?: unknown };
    };
    assert.equal(selfManagedBody.build.webDeploymentMode, "self-managed");
    assert.equal(selfManagedBody.build.webProviderReceipt, undefined);

    const incompleteWeb = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "incomplete-web",
        name: "Incomplete web",
        platform: "web",
        sourceUrl: "https://preview.example.com/pr-184",
        status: "ready",
      }),
    });
    assert.equal(incompleteWeb.status, 400);

    for (const sourceUrl of ["http://artifacts.example.com/app.apk", "file:///tmp/app.apk"]) {
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

    const badSourceSha = await fetch(`${base}/builds`, {
      method: "POST",
      headers: headers("build.save"),
      body: JSON.stringify({
        id: "bad-source-sha-build",
        name: "Bad source SHA build",
        platform: "android",
        sourceUrl: "/tmp/app.apk",
        sourceSha: "ABC123",
        status: "ready",
      }),
    });
    assert.equal(badSourceSha.status, 400);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
