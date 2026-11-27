import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { resetControlDatabaseCache } from "@relay/core";
import { startServer } from "../index.js";

const usernameCanary = "route-user-canary@example.test";
const passwordCanary = "route-password-canary-secret";

function client(port: number, actorKind: "human" | "agent") {
  return new RelayClient({
    url: `http://127.0.0.1:${port}`,
    auth: { type: "none" },
    organizationId: "relay",
    projectId: "shop-project",
    actorId: `${actorKind}:sign-in-route-test`,
    actorKind,
  });
}

test("saved sign-in operations are metadata-only and mutations are human-only", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-sign-in-routes-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  resetControlDatabaseCache();
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  const human = client(server.port, "human");
  const agent = client(server.port, "agent");
  try {
    const input = {
      appMapId: "shop",
      key: "member",
      name: "Member account",
      username: usernameCanary,
      password: passwordCanary,
      confirm: true as const,
    };
    const saved = await human.invoke("sign-in.save", input);
    assert.equal(saved.signIn.key, "member");
    assert.equal(saved.signIn.revision, 1);
    assert.equal(JSON.stringify(saved).includes(usernameCanary), false);
    assert.equal(JSON.stringify(saved).includes(passwordCanary), false);

    await assert.rejects(
      agent.invoke("sign-in.save", input),
      (error) => error instanceof ApiError && error.status === 403,
    );
    await assert.rejects(
      agent.invoke("sign-in.rotate", {
        key: "member",
        username: "agent",
        password: "agent",
        confirm: true,
      }),
      (error) => error instanceof ApiError && error.status === 403,
    );
    await assert.rejects(
      agent.invoke("sign-in.revoke", { key: "member", confirm: true }),
      (error) => error instanceof ApiError && error.status === 403,
    );

    const listed = await agent.invoke("sign-in.list", {});
    assert.equal(listed.signIns.length, 1);
    assert.equal(JSON.stringify(listed).includes(usernameCanary), false);
    assert.equal(JSON.stringify(listed).includes(passwordCanary), false);
    assert.equal("username" in listed.signIns[0]!, false);
    assert.equal("password" in listed.signIns[0]!, false);

    const ready = await agent.invoke("sign-in.resolve-check", { key: "member" });
    assert.equal(ready.resolution.status, "ready");
    assert.equal(ready.resolution.source, "local");
    assert.equal(JSON.stringify(ready).includes(usernameCanary), false);

    const rotated = await human.invoke("sign-in.rotate", {
      key: "member",
      username: "rotated-user@example.test",
      password: "rotated-password",
      confirm: true,
    });
    assert.equal(rotated.signIn.revision, 2);
    const revoked = await human.invoke("sign-in.revoke", { key: "member", confirm: true });
    assert.equal(
      revoked.signIns.every((item) => typeof item.revokedAt === "number"),
      true,
    );
    const unavailable = await agent.invoke("sign-in.resolve-check", { key: "member" });
    assert.equal(unavailable.resolution.status, "revoked");
    assert.equal(JSON.stringify(unavailable).includes("rotated-password"), false);
  } finally {
    await server.close();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});
