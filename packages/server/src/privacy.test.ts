import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { startServer } from "./index.js";

function clientFor(port: number): RelayClient {
  return clientForActor(port, "human:test", "human");
}

function clientForActor(port: number, actorId: string, actorKind: "human" | "agent"): RelayClient {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "local",
    projectId: "default",
    actorId,
    actorKind,
  });
}

test("privacy policy can be toggled locally and survives a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-privacy-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousStateDir = process.env.RELAY_STATE_DIR;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  // Isolated state dir: parallel test files each boot a real server, and the
  // state-dir lease is single-owner by design.
  process.env.RELAY_STATE_DIR = join(root, ".relay");
  delete process.env.RELAY_REDACTION_MODE;
  let server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = clientFor(server.port);
    assert.deepEqual(await client.redactionPolicy(), {
      policy: { enabled: false, source: "default", locked: false },
    });
    const enabled = await client.setRedactionEnabled(true);
    assert.equal(enabled.policy.enabled, true);
    assert.equal(enabled.policy.source, "workspace");

    await server.close();
    server = await startServer({ host: "127.0.0.1", port: 0 });
    assert.equal((await clientFor(server.port).redactionPolicy()).policy.enabled, true);
    const consented = await clientFor(server.port).setSensitiveEvidenceConsent(
      "network-body",
      true,
      "Controlled trial",
    );
    assert.equal(consented.policy.sensitive["network-body"]?.grantedBy, "local-user");
  } finally {
    await server.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await rm(root, { recursive: true, force: true });
  }
});

test("environment policy is locked and unredacted network bindings are refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-privacy-lock-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousStateDir = process.env.RELAY_STATE_DIR;
  const previousMode = process.env.RELAY_REDACTION_MODE;
  process.env.RELAY_WORKSPACE_ROOT = root;
  // Isolated state dir: parallel test files each boot a real server, and the
  // state-dir lease is single-owner by design.
  process.env.RELAY_STATE_DIR = join(root, ".relay");
  process.env.RELAY_REDACTION_MODE = "off";
  const local = await startServer({ host: "127.0.0.1", port: 0 });
  let localClosed = false;
  try {
    await assert.rejects(
      clientFor(local.port).setRedactionEnabled(true),
      (error) => error instanceof ApiError && error.status === 409,
    );
    // The server has established the locked policy. Release its state-dir
    // lease before independently asserting the rejected network binding;
    // otherwise the singleton boundary correctly rejects the second server
    // before the binding policy is reached.
    await local.close();
    localClosed = true;
    await assert.rejects(
      startServer({ host: "0.0.0.0", port: 0, token: "a-secure-token-with-24-chars" }),
      /non-local binding while evidence redaction is disabled/,
    );
  } finally {
    if (!localClosed) await local.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    if (previousMode === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previousMode;
    await rm(root, { recursive: true, force: true });
  }
});

test("browser trace and raw network retention consent are human-reviewed", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-server-browser-trace-consent-"));
  const previousRoot = process.env.RELAY_WORKSPACE_ROOT;
  const previousStateDir = process.env.RELAY_STATE_DIR;
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, ".relay");
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const agent = clientForActor(server.port, "agent:trace-policy", "agent");
    for (const channel of ["browser-trace", "network-raw"] as const) {
      await assert.rejects(
        agent.setSensitiveEvidenceConsent(channel, true, `Agent requested ${channel}`),
        (error) => error instanceof ApiError && error.status === 403,
      );
    }
    const human = clientForActor(server.port, "human:trace-policy", "human");
    const consented = await human.setSensitiveEvidenceConsent(
      "network-raw",
      true,
      "Dedicated emulator capture",
    );
    assert.equal(consented.policy.sensitive["network-raw"]?.grantedBy, "local-user");
  } finally {
    await server.close();
    if (previousRoot === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousRoot;
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(root, { recursive: true, force: true });
  }
});
