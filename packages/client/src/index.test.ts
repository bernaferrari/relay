import assert from "node:assert/strict";
import test from "node:test";
import { RelayClient } from "./index.js";

test("RelayClient applies scope and bearer authentication", async () => {
  let request: Request | undefined;
  const client = new RelayClient(
    {
      url: "https://relay.test/",
      auth: { type: "bearer", token: "secret" },
      organizationId: "acme",
      projectId: "gemini",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );
  await client.health();
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
  assert.equal(request?.headers.get("x-organization-id"), "acme");
  assert.equal(request?.headers.get("x-project-id"), "gemini");
});

test("RelayClient never invokes a supplied fetch with itself as the receiver", async () => {
  function browserLikeFetch(this: unknown): Promise<Response> {
    assert.equal(this, undefined);
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  }
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
    },
    { fetch: browserLikeFetch as typeof fetch },
  );
  await client.health();
});
