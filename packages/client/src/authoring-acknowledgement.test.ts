import assert from "node:assert/strict";
import test from "node:test";
import type { OperationId, OperationInput } from "@relay/protocol";
import { ApiError, RelayClient } from "./index.js";

const connection = {
  url: "https://relay.test",
  auth: { type: "none" as const },
  organizationId: "local",
  projectId: "default",
  actorId: "human:test",
  actorKind: "human" as const,
};
const session = { sessionId: "recording-1" };
const fence = { workflowId: "wf_recording", expectedVersion: 1 };
const begin = {
  appMapId: "grok-ios",
  expectedAppMapRevision: 1,
  leaseId: "lease-1",
  target: { kind: "device" as const, platform: "ios" as const, targetId: "ipad-1" },
};
type RequestCase = { id: OperationId; input: unknown; budget: number };

test("authoring capture stages have bounded acknowledgements through direct and workflow operations", async (t) => {
  const budgets: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  let requests = 0;
  const client = new RelayClient(connection, {
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
    },
  });
  const cases: RequestCase[] = [
    { id: "authoring.session.begin", input: begin, budget: 180_000 },
    {
      id: "workflow.transition",
      input: { ...fence, action: "start-authoring", leaseId: "lease-1" },
      budget: 180_000,
    },
    { id: "authoring.session.start", input: session, budget: 180_000 },
    { id: "authoring.session.observe", input: session, budget: 180_000 },
    { id: "authoring.session.capture", input: session, budget: 180_000 },
    {
      id: "authoring.session.interact",
      input: {
        ...session,
        interaction: { kind: "tap", target: { identifier: "sidebar.open.button" } },
      },
      budget: 180_000,
    },
    {
      id: "workflow.transition",
      input: {
        ...fence,
        action: "authoring-record",
        interaction: { kind: "tap", target: { point: { x: 20, y: 30 } } },
      },
      budget: 180_000,
    },
    {
      id: "workflow.transition",
      input: {
        ...fence,
        action: "authoring-record",
        interaction: { kind: "tap", applied: true, target: { point: { x: 20, y: 30 } } },
      },
      budget: 180_000,
    },
    {
      id: "workflow.transition",
      input: { ...fence, action: "authoring-checkpoint" },
      budget: 180_000,
    },
    { id: "authoring.session.stop", input: session, budget: 180_000 },
    { id: "workflow.transition", input: { ...fence, action: "authoring-stop" }, budget: 180_000 },
    { id: "authoring.session.cancel", input: session, budget: 180_000 },
    { id: "workflow.transition", input: { ...fence, action: "authoring-cancel" }, budget: 180_000 },
    {
      id: "workflow.transition",
      input: { ...fence, action: "authoring-abandon", reason: "Stop" },
      budget: 180_000,
    },
    {
      id: "target.input.reconcile",
      input: {
        serial: "ipad-1",
        mutationId: "mutation-1",
        outcome: "applied",
        reconcilePending: true,
      },
      budget: 180_000,
    },
    { id: "workflow.transition", input: { ...fence, action: "authoring-discard" }, budget: 20_000 },
    { id: "authoring.session.get", input: session, budget: 20_000 },
  ];
  for (const item of cases) {
    await assert.rejects(
      client.invoke(item.id, item.input as OperationInput<OperationId>),
      ApiError,
    );
    assert.equal(budgets.at(-1), item.budget, item.id);
  }
  assert.equal(
    requests,
    cases.length,
    "each command is sent once, including failed acknowledgements",
  );
});

test("the measured slow native receipt remains observable without resending input", async (t) => {
  const budgets = new WeakMap<AbortSignal, number>();
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const signal = new AbortController().signal;
    budgets.set(signal, ms);
    return signal;
  });
  let requests = 0;
  const client = new RelayClient(connection, {
    fetch: async (_input, init) => {
      requests++;
      // Virtual elapsed time reproduces the retained 43.921-second device
      // command without a slow test or physical device access.
      if ((budgets.get(init!.signal!) ?? 0) < 43_921) {
        throw new DOMException("The request timed out", "TimeoutError");
      }
      return new Response(JSON.stringify({ error: "Canonical receipt retained" }), { status: 409 });
    },
  });
  await assert.rejects(
    client.invoke("workflow.transition", {
      ...fence,
      action: "authoring-record",
      interaction: { kind: "tap", target: { identifier: "sidebar.open.button" } },
    }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 409 &&
      /Canonical receipt retained/u.test(error.message),
  );
  assert.equal(requests, 1);
});

test("direct interaction waits for its single reply without guessing the serial format", async (t) => {
  const budgets: number[] = [];
  const bySignal = new WeakMap<AbortSignal, number>();
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    const signal = new AbortController().signal;
    bySignal.set(signal, ms);
    return signal;
  });
  let requests = 0;
  const serial = "db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5";
  const fetcher: typeof fetch = async (input, init) => {
    requests++;
    const text = await new Request(input, init).text();
    const body = text ? JSON.parse(text) : {};
    if (body.serial === serial && (bySignal.get(init!.signal!) ?? 0) < 43_921) {
      throw new DOMException("The request timed out", "TimeoutError");
    }
    return new Response(JSON.stringify({ error: "Exact native response" }), { status: 409 });
  };
  const client = new RelayClient(connection, { fetch: fetcher });
  const interaction = { kind: "label" as const, label: "Open Sidebar" };
  await assert.rejects(
    client.invoke("target.interact", { ...interaction, serial }),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
  for (const otherSerial of ["RQCY104BG8X", "grok-com"]) {
    await assert.rejects(
      client.invoke("target.interact", { ...interaction, serial: otherSerial }),
      ApiError,
    );
  }
  await assert.rejects(client.invoke("system.health.get", {}), ApiError);
  const explicit = new RelayClient(connection, { fetch: fetcher, timeoutMs: 1234 });
  await assert.rejects(explicit.invoke("target.interact", { ...interaction, serial }), {
    name: "TimeoutError",
  });
  assert.deepEqual(budgets, [180_000, 180_000, 180_000, 20_000, 1234]);
  assert.equal(requests, budgets.length, "no timed-out or refused interaction is resent");
});

test("explicit deadlines and cancellation remain authoritative after scoping", async (t) => {
  const budgets: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  const received: Array<AbortSignal | null | undefined> = [];
  const fetcher: typeof fetch = async (_input, init) => {
    received.push(init?.signal);
    return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
  };
  const input = { ...session, interaction: { kind: "wait" as const, ms: 60_000 } };
  const client = new RelayClient(connection, { fetch: fetcher });
  await assert.rejects(
    client.scoped("other").invoke("authoring.session.interact", input),
    ApiError,
  );
  const explicit = new RelayClient(connection, { fetch: fetcher, timeoutMs: 1234 });
  await assert.rejects(explicit.scoped("other").invoke("authoring.session.begin", begin), ApiError);
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    client.invoke("authoring.session.interact", input, { signal: cancel.signal }),
    ApiError,
  );
  assert.equal(received.at(-1)?.aborted, true);
  assert.deepEqual(budgets, [240_000, 1234, 240_000]);
});
