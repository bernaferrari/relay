import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RelayClient, ApiError } from "@relay/client";
import { startServer } from "./index.js";

test("project-scoped variables persist and expose revision conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-state-"));
  const previous = process.env.GROK_DEVICE_STATE_DIR;
  process.env.GROK_DEVICE_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "chatgpt-ios",
    });
    const initial = await client.variables();
    assert.equal(initial.revision, 0);
    const saved = await client.updateVariables({
      expectedRevision: 0,
      value: [
        {
          id: "prompt",
          name: "prompt",
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
    if (previous === undefined) delete process.env.GROK_DEVICE_STATE_DIR;
    else process.env.GROK_DEVICE_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("loopback API rejects hostile browser origins and reflects Relay origins", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${server.port}/health`;
  try {
    const denied = await fetch(url, { headers: { Origin: "https://hostile.example" } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);

    const origin = "http://localhost:5173";
    const allowed = await fetch(url, { headers: { Origin: origin } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  } finally {
    await server.close();
  }
});

test("authenticated network service cannot read unowned workspace assets", async () => {
  const token = "test-service-token-with-24-characters";
  const previousProjects = process.env.RELAY_AUTH_PROJECT_IDS;
  const previousRedaction = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_AUTH_PROJECT_IDS = "project-a";
  process.env.RELAY_REDACTION_MODE = "on";
  const server = await startServer({ host: "0.0.0.0", port: 0, token });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/recipes`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-project-id": "project-a",
      },
    });
    assert.equal(response.status, 403);

    const health = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { Authorization: `Bearer ${token}`, "x-project-id": "project-a" },
    });
    assert.equal(health.status, 200);
  } finally {
    await server.close();
    if (previousProjects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previousProjects;
    if (previousRedaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousRedaction;
  }
});
