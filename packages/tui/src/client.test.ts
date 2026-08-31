import assert from "node:assert/strict";
import test from "node:test";
import { probeRelay, RelayConnectionError, createClient } from "./client.js";

const healthyResponse = () =>
  new Response(
    JSON.stringify({
      ok: true,
      product: "relay",
      version: "test",
      mode: "app-testing",
      at: 1,
      uptimeMs: 1,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

test("TUI reachability probe uses configured auth, scope, and actor headers", async () => {
  const previous = {
    token: process.env.RELAY_AUTH_TOKEN,
    organization: process.env.RELAY_ORGANIZATION_ID,
    project: process.env.RELAY_PROJECT_ID,
    actor: process.env.RELAY_ACTOR_ID,
  };
  process.env.RELAY_AUTH_TOKEN = "a-test-token-with-enough-length";
  process.env.RELAY_ORGANIZATION_ID = "acme";
  process.env.RELAY_PROJECT_ID = "mobile";
  process.env.RELAY_ACTOR_ID = "human:terminal";
  let request: Request | undefined;
  try {
    const result = await probeRelay("http://relay.test", {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return healthyResponse();
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(request?.headers.get("authorization"), "Bearer a-test-token-with-enough-length");
    assert.equal(request?.headers.get("x-organization-id"), "acme");
    assert.equal(request?.headers.get("x-project-id"), "mobile");
    assert.equal(request?.headers.get("x-relay-actor-id"), "human:terminal");
    assert.equal(request?.headers.get("x-relay-actor-kind"), "human");
    assert.equal(request?.headers.get("x-relay-operation-id"), "system.health.get");
  } finally {
    if (previous.token === undefined) delete process.env.RELAY_AUTH_TOKEN;
    else process.env.RELAY_AUTH_TOKEN = previous.token;
    if (previous.organization === undefined) delete process.env.RELAY_ORGANIZATION_ID;
    else process.env.RELAY_ORGANIZATION_ID = previous.organization;
    if (previous.project === undefined) delete process.env.RELAY_PROJECT_ID;
    else process.env.RELAY_PROJECT_ID = previous.project;
    if (previous.actor === undefined) delete process.env.RELAY_ACTOR_ID;
    else process.env.RELAY_ACTOR_ID = previous.actor;
  }
});

test("TUI probe distinguishes authentication and scope failures", async () => {
  const failed = async (status: number, message: string) =>
    probeRelay("http://relay.test", {
      fetch: async () =>
        new Response(JSON.stringify({ error: message }), {
          status,
          headers: { "content-type": "application/json" },
        }),
    });

  assert.deepEqual(await failed(401, "Authentication required"), {
    ok: false,
    kind: "authentication",
    status: 401,
    message: "Relay rejected the configured authentication: Authentication required",
  });
  assert.deepEqual(
    await failed(403, "Authenticated token is not authorized for the requested scope"),
    {
      ok: false,
      kind: "scope",
      status: 403,
      message:
        "Relay rejected the configured organization/project scope: Authenticated token is not authorized for the requested scope",
    },
  );
});

test("TUI probe classifies transport failures as network failures", async () => {
  const result = await probeRelay("http://relay.test", {
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(result, {
    ok: false,
    kind: "network",
    message: "Relay server is not reachable at http://relay.test: fetch failed",
  });
});

test("createClient preserves the classified connection failure", async () => {
  await assert.rejects(
    () =>
      createClient("http://relay.test", {
        fetch: async () =>
          new Response(JSON.stringify({ error: "Authentication required" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RelayConnectionError);
      assert.equal(error.kind, "authentication");
      assert.match(error.message, /Check RELAY_AUTH_TOKEN/);
      return true;
    },
  );
});
