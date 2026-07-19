import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { startServer } from "./index.js";

function clientFor(port: number): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "default",
  });
}

test("privacy policy can be toggled locally and survives a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-privacy-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  delete process.env.RELAY_REDACTION_MODE;
  let server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    assert.deepEqual(await client.redactionPolicy(), {
      policy: { enabled: true, source: "default", locked: false },
    });
    const disabled = await client.setRedactionEnabled(false);
    assert.equal(disabled.policy.enabled, false);
    assert.equal(disabled.policy.source, "workspace");

    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0 });
    assert.equal((await clientFor(server.port).redactionPolicy()).policy.enabled, false);
  } finally {
    await server.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await rm(root, { recursive: true, force: true });
  }
});

test("environment policy is locked and unredacted network bindings are refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-privacy-lock-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_REDACTION_MODE = "off";
  const local = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    await assert.rejects(
      clientFor(local.port).setRedactionEnabled(true),
      (error) => error instanceof ApiError && error.status === 409,
    );
    await assert.rejects(
      startServer({ host: "0.0.0.0", port: 0, token: "a-secure-token-with-24-chars" }),
      /non-local binding while evidence redaction is disabled/,
    );
  } finally {
    await local.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await rm(root, { recursive: true, force: true });
  }
});
