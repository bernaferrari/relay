import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { RelayOutcomeJobs } from "@relay/workflows";
import { invokeRelayEverydayTool, relayEverydayTools } from "./everyday-tools.js";
import { presentOutcomeForAgent, relayOutcomeTools } from "./outcome-tools.js";
import { relayOperatorTools } from "./operator-tools.js";
import { relayQaOperatorTools, relayQaOutcomeTools } from "./qa-tools.js";
import { createMcpServer, type OperationInvoker } from "./server.js";

const failedVerdict = {
  runId: "run-1",
  title: "Sign in",
  status: "failed",
  summary: "Failed at step 2: Dashboard shows",
  reason: "The dashboard never appeared.",
  durationMs: 4200,
  steps: [
    { id: "s1", title: "Sign in", kind: "action", status: "passed", saw: "long".repeat(300) },
    {
      id: "s2",
      title: "Dashboard shows",
      kind: "check",
      status: "failed",
      expected: "The dashboard",
      saw: "A login error",
      screenshot: "relay://runs/run-1/frames/2",
    },
  ],
};

function stubInvoker(
  handlers: Record<string, (input: Record<string, unknown>) => unknown>,
  calls: Array<{ id: string; input: Record<string, unknown> }> = [],
): OperationInvoker {
  return {
    async invoke(id, input) {
      calls.push({ id, input });
      const handler = handlers[id];
      if (!handler) throw new Error(`unexpected ${id}`);
      return handler(input);
    },
  };
}

const noSleep = async () => {};

async function connect(invoker: OperationInvoker, profile: "qa" | "author" = "qa") {
  const server = createMcpServer({ profile, scope: { projectId: "project" }, invoker });
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  let next = 0;
  client.onmessage = (message) => {
    if ("id" in message && typeof message.id === "number")
      pending.get(message.id)?.(message as Record<string, unknown>);
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = ++next;
    const result = new Promise<Record<string, unknown>>((resolve) => pending.set(id, resolve));
    await client.send({ jsonrpc: "2.0", id, method, params } as never);
    return (await result).result as Record<string, unknown>;
  };
  await server.connect(transport);
  await client.start();
  await request("initialize", {
    protocolVersion: "2025-11-25",
    clientInfo: { name: "everyday-test", version: "1" },
    capabilities: {},
  });
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" } as never);
  return {
    request,
    close: async () => {
      await server.close();
      await client.close();
    },
  };
}

test("relay_create_test writes a Test from a sentence and names the exact run call", async () => {
  const calls: Array<{ id: string; input: Record<string, unknown> }> = [];
  const session = await connect(
    stubInvoker(
      {
        "test.create-from-goal": () => ({
          appId: "localhost-3000",
          testId: "test-1",
          name: "Sign in",
          steps: [
            { kind: "action", text: "Sign in" },
            { kind: "check", text: "The dashboard shows" },
          ],
          source: "model",
          createdApp: true,
        }),
      },
      calls,
    ),
  );
  try {
    const result = await session.request("tools/call", {
      name: "relay_create_test",
      arguments: { goal: "Sign in and see the dashboard", url: "http://localhost:3000" },
    });
    assert.notEqual(result.isError, true);
    const created = (result.structuredContent as { result: Record<string, unknown> }).result;
    assert.deepEqual(calls, [
      {
        id: "test.create-from-goal",
        input: { goal: "Sign in and see the dashboard", url: "http://localhost:3000" },
      },
    ]);
    assert.equal(created.testId, "test-1");
    assert.deepEqual((created.next as Record<string, unknown>).arguments, {
      appMapId: "localhost-3000",
      testId: "test-1",
    });
    assert.equal((created.next as Record<string, unknown>).tool, "relay_run_test");
  } finally {
    await session.close();
  }
});

test("relay_create_test applies a test file as written", async () => {
  const calls: Array<{ id: string; input: Record<string, unknown> }> = [];
  const session = await connect(
    stubInvoker(
      {
        "test.apply-yaml": () => ({
          appId: "shop-example",
          testId: "checkout",
          name: "Checkout",
          created: true,
          createdApp: false,
          keptRecorded: 0,
        }),
      },
      calls,
    ),
  );
  try {
    const yaml =
      "name: Checkout\nurl: https://shop.example\nsteps:\n  - Add a shirt\n  - check: The cart shows 1 item\n";
    const result = await session.request("tools/call", {
      name: "relay_create_test",
      arguments: { yaml },
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(calls, [{ id: "test.apply-yaml", input: { yaml } }]);
    const created = (result.structuredContent as { result: Record<string, unknown> }).result;
    assert.deepEqual((created.next as Record<string, unknown>).arguments, {
      appMapId: "shop-example",
      testId: "checkout",
    });
    const both = await session.request("tools/call", {
      name: "relay_create_test",
      arguments: { yaml, goal: "Checkout works" },
    });
    assert.equal(both.isError, true);
  } finally {
    await session.close();
  }
});

test("relay_get_verdict returns a bounded verdict with failing-step details only", async () => {
  const session = await connect(
    stubInvoker({ "run.verdict.get": () => ({ verdict: failedVerdict }) }),
    "author",
  );
  try {
    const listed = await session.request("tools/list", {});
    const names = (listed.tools as Array<{ name: string }>).map(({ name }) => name);
    assert.ok(names.includes("relay_create_test") && names.includes("relay_get_verdict"));
    assert.equal(names.includes("relay_check_change"), false, "author does not run Tests");
    const result = await session.request("tools/call", {
      name: "relay_get_verdict",
      arguments: { runId: "run-1" },
    });
    const verdict = (result.structuredContent as { result: Record<string, unknown> }).result;
    const steps = verdict.steps as Array<Record<string, unknown>>;
    assert.equal(verdict.status, "failed");
    assert.deepEqual(steps[0], { id: "s1", title: "Sign in", kind: "action", status: "passed" });
    assert.equal(steps[1]!.saw, "A login error");
    assert.equal(steps[1]!.screenshot, "relay://runs/run-1/frames/2");
  } finally {
    await session.close();
  }
});

test("relay_run_test waits for the verdict and never returns the compiled plan", async () => {
  const started = {
    kind: "run-test",
    phase: "queued",
    workflow: { workflowId: "wf-1", expectedVersion: 1 },
    compiled: { plan: { huge: true }, preflight: {} },
    frozen: { appMapId: "app" },
    evidenceRefs: [],
  };
  const inspected = [
    { ...started, phase: "running", execution: { jobId: "job-1", runId: "run-1" } },
    {
      ...started,
      phase: "failed",
      execution: { jobId: "job-1", runId: "run-1" },
      evidenceRefs: [{ kind: "run", id: "run-1" }],
    },
  ];
  const jobs = {
    inspect: async () => inspected.shift(),
  } as unknown as RelayOutcomeJobs;
  const verdicts = [{ ...failedVerdict, status: "running" }, failedVerdict];
  const invoker = stubInvoker({ "run.verdict.get": () => ({ verdict: verdicts.shift() }) });
  const signal = new AbortController().signal;
  const context = { invoker, jobs, signal, sleep: noSleep };

  const waited = (await presentOutcomeForAgent(
    "relay_run_test",
    { testId: "t" },
    started,
    context,
  )) as Record<string, unknown>;
  assert.equal(waited.status, "failed");
  assert.equal(waited.runId, "run-1");
  assert.equal((waited.verdict as Record<string, unknown>).reason, "The dashboard never appeared.");
  assert.match(String(waited.next), /relay_inspect_failure/u);
  assert.doesNotMatch(JSON.stringify(waited), /huge/u);

  const immediate = (await presentOutcomeForAgent(
    "relay_run_test",
    { testId: "t", wait: false },
    started,
    context,
  )) as Record<string, unknown>;
  assert.equal(immediate.compiled, undefined);
  assert.equal(immediate.frozen, undefined);
  assert.deepEqual(immediate.workflow, started.workflow);
});

test("a bounded wait returns running with the follow-up call instead of hanging", async () => {
  let clock = 0;
  const running = {
    kind: "run-test",
    phase: "running",
    workflow: { workflowId: "wf-1", expectedVersion: 2 },
    execution: { jobId: "job-1", runId: "run-9" },
  };
  const jobs = { inspect: async () => running } as unknown as RelayOutcomeJobs;
  const invoker = stubInvoker({
    "run.verdict.get": () => ({ verdict: { ...failedVerdict, runId: "run-9", status: "running" } }),
  });
  const result = (await presentOutcomeForAgent(
    "relay_run_test",
    { testId: "t", timeoutSeconds: 5 },
    running,
    {
      invoker,
      jobs,
      signal: new AbortController().signal,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    },
  )) as Record<string, unknown>;
  assert.equal(result.status, "running");
  assert.match(String(result.next), /relay_get_verdict \{runId:"run-9"\}/u);
});

test("a risk preflight surfaces the confirm step rather than a verdict", async () => {
  const blocked = {
    kind: "run-test",
    phase: "blocked",
    problems: [{ code: "risk-confirmation-required", message: "Sends a message" }],
    compiled: { plan: { huge: true } },
  };
  const result = (await presentOutcomeForAgent("relay_run_test", { testId: "t" }, blocked, {
    invoker: stubInvoker({}),
    jobs: {} as RelayOutcomeJobs,
    signal: new AbortController().signal,
    sleep: noSleep,
  })) as Record<string, unknown>;
  assert.equal(result.status, "blocked");
  assert.match(String(result.next), /confirm: true/u);
  assert.doesNotMatch(JSON.stringify(result), /huge/u);
});

test("relay_inspect_failure adds the verdict's failing step", async () => {
  const result = (await presentOutcomeForAgent(
    "relay_inspect_failure",
    { runId: "run-1" },
    { runId: "run-1", repairProposals: [] },
    {
      invoker: stubInvoker({ "run.verdict.get": () => ({ verdict: failedVerdict }) }),
      jobs: {} as RelayOutcomeJobs,
      signal: new AbortController().signal,
    },
  )) as { verdict: { failingStep: Record<string, unknown> } };
  assert.equal(result.verdict.failingStep.expected, "The dashboard");
  assert.equal(result.verdict.failingStep.saw, "A login error");
});

test("relay_check_change runs the matching ready Tests and returns verdicts", async () => {
  const runs: string[] = [];
  const jobs = {
    run: async (intent: { testId: string; appMapId: string }) => {
      runs.push(`${intent.appMapId}/${intent.testId}`);
      return {
        kind: "run-test",
        phase: "succeeded",
        workflow: { workflowId: `wf-${intent.testId}`, expectedVersion: 3 },
        execution: { jobId: "job", runId: `run-${intent.testId}` },
      };
    },
  } as unknown as RelayOutcomeJobs;
  const fromText = { status: "unresolved", reason: "words", fromText: true };
  const invoker = stubInvoker({
    "app-map.list": () => ({
      appMaps: [
        { id: "shop", name: "Shop" },
        { id: "blog", name: "Blog" },
      ],
    }),
    "app-map.get": () => ({
      appMap: {
        tests: {
          checkout: {
            name: "Checkout",
            steps: [{ intent: "Pay for the cart", binding: fromText }],
          },
          "checkout-draft": {
            name: "Checkout coupon",
            steps: [{ intent: "Apply coupon", binding: { status: "unresolved", reason: "x" } }],
          },
          profile: { name: "Profile", steps: [{ intent: "Open profile", binding: fromText }] },
        },
      },
    }),
    "run.verdict.get": (input) => ({
      verdict:
        input.runId === "run-checkout"
          ? { ...failedVerdict, runId: "run-checkout" }
          : { ...failedVerdict, runId: String(input.runId), status: "passed", steps: [] },
    }),
  });
  const base = {
    name: "relay_check_change" as const,
    confirmed: false,
    invoker,
    jobs,
    signal: new AbortController().signal,
    sleep: noSleep,
  };

  const narrowed = (await invokeRelayEverydayTool({
    ...base,
    argumentsValue: { app: "Shop", areas: ["checkout"] },
  })) as Record<string, unknown>;
  assert.deepEqual(runs, ["shop/checkout"]);
  assert.equal(narrowed.overall, "failed");
  assert.equal(narrowed.scope, "areas");
  const [first] = narrowed.results as Array<Record<string, unknown>>;
  assert.equal((first!.failingStep as Record<string, unknown>).saw, "A login error");
  assert.deepEqual(narrowed.skipped, [
    { testId: "checkout-draft", name: "Checkout coupon", reason: "needs recording" },
  ]);

  runs.length = 0;
  const everything = (await invokeRelayEverydayTool({
    ...base,
    argumentsValue: { app: "shop", areas: ["nothing-matches"] },
  })) as Record<string, unknown>;
  assert.deepEqual(runs, ["shop/checkout", "shop/profile"]);
  assert.equal(everything.scope, "all");
  assert.match(String(everything.note), /every ready Test/u);

  await assert.rejects(invokeRelayEverydayTool({ ...base, argumentsValue: {} }), /Say which App/u);
});

test("agent-facing qa descriptions avoid internal names and engine jargon", () => {
  const qa = [...relayEverydayTools, ...relayQaOutcomeTools, ...relayQaOperatorTools];
  for (const tool of [...qa, ...relayOutcomeTools, ...relayOperatorTools]) {
    assert.doesNotMatch(tool.description, /grok|GQA|\bJev\b|Typesafe/iu, tool.name);
  }
  for (const tool of qa) {
    assert.doesNotMatch(
      `${tool.title} ${tool.description}`,
      /\b(?:Lane|Combine|cell|lease|digest|TracePack)\b/u,
      tool.name,
    );
  }
});
