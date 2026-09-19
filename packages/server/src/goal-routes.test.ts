import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GoalRouteRuntime } from "./goal-routes.js";
import { startServer } from "./index.js";

test("goal control requires confirmation while retained evidence stays inspectable", async () => {
  const previousStateDir = process.env.RELAY_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), "relay-goal-route-"));
  process.env.RELAY_STATE_DIR = stateDir;
  const calls: string[] = [];
  const runtime: Partial<GoalRouteRuntime> = {
    start: async (input) => {
      calls.push(`start:${input.goal}`);
      return { sessionId: "goal-1", status: "running" } as never;
    },
    inspect: async (sessionId) => {
      calls.push(`inspect:${sessionId}`);
      if (sessionId === "missing") throw new TypeError("Goal session missing was not found.");
      return { id: sessionId, goal: "checkout" } as never;
    },
    resume: async (sessionId) => {
      calls.push(`resume:${sessionId}`);
      return { sessionId, status: "completed" } as never;
    },
    reproduce: async (sessionId) => {
      calls.push(`reproduce:${sessionId}`);
      return { sessionId, status: "completed" } as never;
    },
    promote: async ({ sessionId }) => {
      calls.push(`promote:${sessionId}`);
      return { stage: "reviewing" } as never;
    },
  };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    goalRouteRuntime: runtime,
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const denied = await fetch(`${base}/goal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "checkout", startUrl: "https://example.test" }),
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(calls, []);

    const inspected = await fetch(`${base}/goal/goal-1`);
    assert.equal(inspected.status, 200);
    assert.deepEqual(await inspected.json(), { id: "goal-1", goal: "checkout" });

    const missing = await fetch(`${base}/goal/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "Goal session missing was not found." });

    const deniedReproduction = await fetch(`${base}/goal/goal-1/reproduce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(deniedReproduction.status, 403);

    const resumed = await fetch(`${base}/goal/goal-1/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmControl: true }),
    });
    assert.equal(resumed.status, 200);

    const reproduced = await fetch(`${base}/goal/goal-1/reproduce`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmControl: true }),
    });
    assert.equal(reproduced.status, 200);

    const promoted = await fetch(`${base}/goal/goal-1/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Empty cart", confirmControl: true }),
    });
    assert.equal(promoted.status, 200);

    const started = await fetch(`${base}/goal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "checkout",
        startUrl: "https://example.test",
        confirmControl: true,
      }),
    });
    assert.equal(started.status, 200);
    assert.deepEqual(calls, [
      "inspect:goal-1",
      "inspect:missing",
      "resume:goal-1",
      "reproduce:goal-1",
      "promote:goal-1",
      "start:checkout",
    ]);
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a server-owned goal survives client disconnect and cancels cross-client", async () => {
  const previousStateDir = process.env.RELAY_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), "relay-goal-owner-"));
  process.env.RELAY_STATE_DIR = stateDir;
  let releaseFinish!: (value: unknown) => void;
  const finishGate = new Promise((resolve) => {
    releaseFinish = resolve;
  });
  const runtime: Partial<GoalRouteRuntime> = {
    start: (input, call) =>
      new Promise((resolve) => {
        const settle = (status: string) =>
          resolve({
            schemaVersion: 1,
            sessionId: input.sessionId ?? "goal-e2e-1",
            goal: input.goal,
            target: { targetId: "t", platform: "browser" },
            status,
            step: 0,
            budget: { maxSteps: 1, maxDurationMs: 1000 },
            actions: [],
            observations: [],
            findings: [],
          } as never);
        call?.signal?.addEventListener("abort", () => {
          releaseFinish("aborted");
          settle("cancelled");
        });
        void finishGate.then(() => settle("completed"));
      }),
    inspect: async (sessionId) => ({ id: sessionId, goal: "inspect", status: "running" }) as never,
  };
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    goalRouteRuntime: runtime,
  });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    // Client one starts the goal and disconnects before it settles.
    const clientAbort = new AbortController();
    const startPromise = fetch(`${base}/goal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "server-owned",
        sessionId: "goal-e2e-1",
        startUrl: "https://example.test",
        confirmControl: true,
      }),
      signal: clientAbort.signal,
    }).catch(() => "disconnected" as const);
    await new Promise((resolve) => setTimeout(resolve, 150));
    clientAbort.abort();
    await startPromise;

    // A second client observes the same running job and its workflow identity.
    const inspected = (await (await fetch(`${base}/goal/goal-e2e-1`)).json()) as {
      workflow?: { workflowId: string; kind: string; status: string };
    };
    assert.equal(inspected.workflow?.workflowId, "goal-session:goal-e2e-1");
    assert.equal(inspected.workflow?.kind, "goal-session");
    assert.equal(inspected.workflow?.status, "active");

    // The same second client cancels the exact job.
    const cancelled = await fetch(`${base}/goal/goal-e2e-1/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmControl: true }),
    });
    assert.equal(cancelled.status, 200);
    const cancelledBody = (await cancelled.json()) as { status: string };
    assert.equal(cancelledBody.status, "cancelled");

    // The workflow settled; repeated cancel is a clean 404 once finished.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settled = (await (await fetch(`${base}/goal/goal-e2e-1`)).json()) as {
      workflow?: { status: string };
    };
    assert.equal(settled.workflow?.status, "terminal");
  } finally {
    await server.close();
    if (previousStateDir === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousStateDir;
    await rm(stateDir, { recursive: true, force: true });
  }
});
