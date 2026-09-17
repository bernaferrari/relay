import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "@relay/protocol";
import { ApiError, parseRegisteredOperationOutput, RelayClient } from "./index.js";

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
      actorId: "human:test",
      actorKind: "human",
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
  assert.equal(request?.headers.get("x-relay-actor-id"), "human:test");
  assert.equal(request?.headers.get("x-relay-actor-kind"), "human");
  assert.equal(request?.headers.get("x-relay-operation-id"), "system.health.get");
  assert.ok(request?.headers.get("x-relay-request-id"));
  assert.ok(request?.headers.get("idempotency-key"));
});

test("download sends authenticated scope headers and preserves binary artifacts", async () => {
  let request: Request | undefined;
  const payload = new Uint8Array([0, 255, 8, 1]);
  const client = new RelayClient(
    {
      url: "https://relay.test/",
      auth: { type: "bearer", token: "secret" },
      organizationId: "acme",
      projectId: "gemini",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(payload, {
          status: 200,
          headers: { "Content-Type": "application/gzip" },
        });
      },
    },
  );
  const response = await client.download("/jobs/batch/export?download=archive");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...payload]);
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
  assert.equal(request?.headers.get("x-organization-id"), "acme");
  assert.equal(request?.headers.get("x-project-id"), "gemini");
  assert.equal(request?.headers.get("x-relay-actor-id"), "human:test");
  assert.equal(request?.headers.get("x-relay-actor-kind"), "human");
});

test("download turns forbidden and missing artifacts into ApiError", async () => {
  for (const status of [403, 404]) {
    const client = new RelayClient(
      {
        url: "https://relay.test",
        auth: { type: "none" },
        organizationId: "local",
        projectId: "default",
        actorId: "human:test",
        actorKind: "human",
      },
      { fetch: async () => new Response("expired", { status, statusText: "Nope" }) },
    );
    await assert.rejects(
      () => client.download("/jobs/missing/export?download=archive"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === status &&
        /expired|Nope/iu.test(error.message),
    );
  }
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
      actorId: "human:test",
      actorKind: "human",
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
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        if (String(input).includes("/jobs/abc")) {
          return new Response(
            JSON.stringify({
              job: {
                id: "abc",
                action: "test.run",
                status: "queued",
                queuedAt: 1,
                frameCount: 0,
              },
            }),
            { status: 200 },
          );
        }
        if (String(input).includes("/app-maps/checkout/tests/smoke/compile")) {
          return new Response(JSON.stringify({ plan: {}, preflight: {} }), { status: 200 });
        }
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      },
    },
  );

  await client.invoke("job.list", { limit: 12 });
  await client.invoke("job.get", { jobId: "abc" });
  await client.invoke("app-map.test.compile", {
    appMapId: "checkout",
    testId: "smoke",
    entryCheckpointScreenId: "settings",
  });

  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.url, "https://relay.test/jobs?limit=12");
  assert.equal(requests[1]?.url, "https://relay.test/jobs/abc");
  assert.equal(
    requests[2]?.url,
    "https://relay.test/app-maps/checkout/tests/smoke/compile?entryCheckpointScreenId=settings",
  );
});

test("invoke strips additive output keys instead of 502ing an older operator client", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "agent:cursor",
      actorKind: "agent",
    },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            fixtures: [],
            summary: {
              liveCount: 1,
              revokedCount: 14,
              readyCount: 1,
              needsReloginCount: 0,
              expiredCount: 0,
              errorCount: 0,
              concurrentAccountsPossible: false,
              concurrentReason: "One live account.",
              lanes: [],
              electronGrokLabPartitionPresent: false,
              electronGrokLabReason: "Electron persist:lane:grok-lab is absent.",
              futureAdditiveField: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  );
  const health = await client.invoke("target.browser-auth.health", {
    targetId: "grok-com",
    probe: false,
  });
  assert.equal(health.summary.liveCount, 1);
  assert.equal(health.summary.electronGrokLabPartitionPresent, false);
  assert.equal(
    (health.summary as { futureAdditiveField?: unknown }).futureAdditiveField,
    undefined,
  );
});

test("parseRegisteredOperationOutput still fails closed on missing required fields", () => {
  assert.throws(() =>
    parseRegisteredOperationOutput(operationDefinition("system.health.get").output, { ok: true }),
  );
});

test("invoke rejects malformed successful responses as an upstream contract error", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
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
      actorId: "human:test",
      actorKind: "human",
    },
    { fetch: async () => new Response("{}", { status: 200 }) },
  );

  await assert.rejects(
    () => client.resource("/unregistered", { method: "POST", body: "{}" }),
    /Unregistered mutation transport/,
  );
});

test("resource transport prefers a static operation over an overlapping parameter route", async () => {
  let request: Request | undefined;
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ repairs: [], nextCursor: null }), { status: 200 });
      },
    },
  );

  await client.resource("/runs/repairs");

  assert.equal(request?.headers.get("x-relay-operation-id"), "run.repair.list");
});

test("binary resources retain operation identity while returning bounded bytes", async () => {
  let request: Request | undefined;
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "application/x-relay-browser-device-frame" },
        });
      },
    },
  );

  const result = await client.binaryResource(
    "/targets/browser/browser-device/frame.bin?afterSequence=2",
  );
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(request?.headers.get("accept"), "application/octet-stream, image/jpeg;q=0.9");
  assert.equal(request?.headers.get("x-relay-operation-id"), "target.browser-device.frame-binary");
});

test("binary resources reject oversized declared bodies before reading them", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "Content-Length": "4" },
        }),
    },
  );

  await assert.rejects(() => client.binaryResource("/unregistered", {}, 3), /3-byte limit/u);
});

test("device discovery accepts the registered fast Android phase", async () => {
  let request: Request | undefined;
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ devices: [] }), { status: 200 });
      },
    },
  );

  await client.resource("/devices?phase=android");
  assert.equal(request?.url, "https://relay.test/devices?phase=android");
  await assert.rejects(
    () => client.resource("/devices?phase=apple"),
    /target devices phase must be android or ios/,
  );
});

test("configured request timeout still applies when a caller supplies a cancellation signal", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      timeoutMs: 5,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    },
  );

  await assert.rejects(
    () => client.invoke("system.health.get", {}, { signal: new AbortController().signal }),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );
});

test("event streams parse canonical envelopes, deduplicate cursors, and surface gaps", async () => {
  let request: Request | undefined;
  const base = {
    schemaVersion: 1,
    actorId: "agent:indexer",
    actorKind: "agent",
    organizationId: "local",
    projectId: "default",
    operationId: "app-map.update",
    requestId: "request-event",
    occurredAt: 2,
  } as const;
  const resource = {
    ...base,
    eventId: "event-2",
    sequence: 2,
    payload: {
      type: "resource.updated",
      at: 2,
      projectId: "default",
      resource: "app-map",
      resourceId: "login",
      revision: 2,
    },
  };
  const gap = {
    ...base,
    eventId: "event-3",
    sequence: 3,
    occurredAt: 3,
    payload: {
      type: "stream.gap",
      at: 3,
      requestedAfter: 1,
      oldestAvailable: 2,
      latestAvailable: 2,
      requiresRefresh: true,
    },
  };
  const frames = [resource, resource, gap]
    .map(
      (event) =>
        `id: ${event.sequence}\nevent: ${event.payload.type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response(frames, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    },
  );
  const received: number[] = [];
  const gaps: number[] = [];
  await client.events((event) => received.push(event.sequence), {
    afterSequence: 1,
    onGap: (event) => gaps.push(event.sequence),
  });
  assert.deepEqual(received, [2, 3]);
  assert.deepEqual(gaps, [3]);
  assert.equal(request?.headers.get("last-event-id"), "1");
  assert.equal(request?.headers.get("x-relay-operation-id"), "event.stream");
});

test("HTTP errors prefer an explicit error field over joined doctor checks", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: "No device is visible. Connect an Android phone or an iPhone/iPad.",
            checks: [
              { id: "node", ok: true, message: "Node.js 22" },
              {
                id: "devices",
                ok: false,
                message: "No device is visible. Connect an Android phone or an iPhone/iPad.",
              },
            ],
          }),
          { status: 503, statusText: "Service Unavailable" },
        ),
    },
  );

  await assert.rejects(
    () => client.invoke("system.doctor.get", {}),
    (error: unknown) =>
      error instanceof ApiError &&
      error.message === "No device is visible. Connect an Android phone or an iPhone/iPad.",
  );
});

test("HTTP errors prefer doctor check text over 503 Service Unavailable", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            checks: [
              { id: "node", ok: true, message: "Node.js 22" },
              {
                id: "devices",
                ok: false,
                message:
                  "No device is visible. Connect an Android phone or an iPhone/iPad, then run relay device list.",
              },
            ],
          }),
          { status: 503, statusText: "Service Unavailable" },
        ),
    },
  );

  await assert.rejects(
    () => client.invoke("system.doctor.get", {}),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 503 &&
      /iPhone\/iPad/.test(error.message) &&
      !/undefined/.test(error.message) &&
      !/Service Unavailable/.test(error.message),
  );
});

test("app launch has a dedicated acknowledgement budget while ordinary requests stay short", async (t) => {
  const budgets: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  const connection = {
    url: "https://relay.test",
    auth: { type: "none" as const },
    organizationId: "local",
    projectId: "default",
    actorId: "human:test",
    actorKind: "human" as const,
  };
  const fetcher: typeof fetch = async (input) =>
    new Response(
      JSON.stringify(
        String(input).endsWith("/device/app/launch")
          ? {
              launched: {
                serial: "emulator-5554",
                app: "com.google.android.deskclock",
                platform: "android",
                launchedAt: 1,
              },
              observed: { matched: false },
            }
          : health,
      ),
    );
  const client = new RelayClient(connection, { fetch: fetcher });
  const result = await client.invoke("target.app.launch", {
    serial: "emulator-5554",
    app: "com.google.android.deskclock",
  });
  assert.equal(result.launched.app, "com.google.android.deskclock");
  await client.invoke("system.health.get", {});
  const explicit = new RelayClient(connection, { fetch: fetcher, timeoutMs: 1234 });
  await explicit.invoke("target.app.launch", {
    serial: "emulator-5554",
    app: "com.google.android.deskclock",
  });
  assert.deepEqual(budgets, [90000, 20000, 1234]);
});

test("a rejected app launch remains a failure under its longer deadline", async () => {
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async () =>
        new Response(JSON.stringify({ error: "App is not installed" }), { status: 409 }),
    },
  );
  await assert.rejects(
    client.invoke("target.app.launch", { serial: "emulator-5554", app: "missing" }),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
});

test("recovery and accessibility reads have bounded cold-start budgets", async (t) => {
  const budgets: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  const connection = {
    url: "https://relay.test",
    auth: { type: "none" as const },
    organizationId: "local",
    projectId: "default",
    actorId: "human:test",
    actorKind: "human" as const,
  };
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
  const client = new RelayClient(connection, { fetch: fetcher });
  await assert.rejects(client.invoke("target.recover", { serial: "emulator-5554", force: true }));
  await assert.rejects(client.invoke("target.snapshot.capture", { serial: "emulator-5554" }));
  const explicit = new RelayClient(connection, { fetch: fetcher, timeoutMs: 1234 });
  await assert.rejects(explicit.invoke("target.recover", { serial: "emulator-5554" }));
  assert.deepEqual(budgets, [180000, 90000, 1234]);
});
