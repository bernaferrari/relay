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
