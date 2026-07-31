import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "./index.js";

const health = {
  ok: true,
  product: "relay",
  version: "0.1.0",
  mode: "local",
  at: 1,
  uptimeMs: 10,
  activeJob: null,
  jobs: 0,
  deviceCount: 0,
  sseClients: 0,
  runsDir: "/tmp/runs",
};

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
        return new Response(JSON.stringify(health), {
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
    return Promise.resolve(new Response(JSON.stringify(health), { status: 200 }));
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

test("invoke derives path, query, and method from the operation registry", async () => {
  const requests: Request[] = [];
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
    },
    {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        if (String(input).includes("/jobs/abc")) {
          return new Response(JSON.stringify({ job: { id: "abc" } }), { status: 200 });
        }
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      },
    },
  );

  await client.invoke("job.list", { full: false, limit: 12 });
  await client.invoke("job.get", { jobId: "abc" });

  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.url, "https://relay.test/jobs?full=false&limit=12");
  assert.equal(requests[1]?.url, "https://relay.test/jobs/abc");
});

test("invoke rejects malformed successful responses as an upstream contract error", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
    },
    { fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }) },
  );

  await assert.rejects(
    () => client.health(),
    (error: unknown) =>
      error instanceof ApiError && error.status === 502 && /invalid response/.test(error.message),
  );
});

test("resource transport cannot bypass the registry for mutations", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
    },
    { fetch: async () => new Response("{}", { status: 200 }) },
  );

  await assert.rejects(
    () => client.resource("/unregistered", { method: "POST", body: "{}" }),
    /Unregistered mutation transport/,
  );
});
