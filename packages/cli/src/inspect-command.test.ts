import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { ApiError } from "@relay/client";
import { ExitCode } from "./errors.js";
import { runCli } from "./index.js";
import type { OperationInvoker } from "./invoke.js";

async function inspect(argv: string[], client: OperationInvoker) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => (output += String(chunk)));
  const code = await runCli([...argv, "--json", "--server", "http://fixture.invalid"], {
    streams: { stdout, stderr },
    createClient: () => client,
    registerSignalHandlers: false,
    env: {},
  });
  assert.equal(output.trim().split("\n").length, 1);
  return { code, envelope: JSON.parse(output) };
}

test("everyday inspect reads a canonical Run ID without workflow or target control", async () => {
  const calls: unknown[] = [];
  const result = await inspect(["inspect", "10ae2877-5a43-4f8f-ac17-a9d5515961ec"], {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId !== "run.get") throw new Error("Workflow not found");
      return {
        run: {
          id: "10ae2877-5a43-4f8f-ac17-a9d5515961ec",
          title: "Grok · Open Settings and capture",
          status: "error",
          outcome: "harness-failure",
          durationMs: 104193,
          frames: [],
          artifacts: [{ kind: "private-diagnostic", data: { secret: "not public" } }],
        },
      };
    },
    events: async () => {},
  });
  assert.equal(result.code, ExitCode.success);
  assert.deepEqual(calls, [
    { operationId: "run.get", input: { runId: "10ae2877-5a43-4f8f-ac17-a9d5515961ec" } },
  ]);
  assert.equal(result.envelope.result.run.id, "10ae2877-5a43-4f8f-ac17-a9d5515961ec");
  assert.equal(result.envelope.result.run.outcome, "harness-failure");
  assert.equal("artifacts" in result.envelope.result.run, false);
});

function workflowOutput() {
  return {
    workflow: {
      record: {
        schemaVersion: 1,
        workflowId: "workflow-1",
        organizationId: "local",
        projectId: "default",
        kind: "run-test",
        version: 3,
        status: "active",
        frozenIdentity: {
          appMapId: "grok-android",
          appMapRevision: 387,
          testId: "open-settings",
          planDigest: "frozen-plan",
          target: { kind: "device", platform: "android", targetId: "fixture-phone" },
        },
        resource: { kind: "job", id: "job-1" },
        createdBy: "agent:test",
        lastActorId: "agent:test",
        createdAt: 1,
        updatedAt: 3,
        expiresAt: 100_000,
        lastTransition: "run-attached",
      },
      audit: [],
    },
    job: { id: "job-1", action: "app-map.test.run", status: "running", queuedAt: 1 },
  };
}

test("inspect falls back to durable workflow inspection without recursive lookup", async () => {
  const calls: unknown[] = [];
  const result = await inspect(["inspect", "workflow-1"], {
    async invoke(operationId, input) {
      calls.push({ operationId, input });
      if (operationId === "run.get") throw new ApiError(404, "Run not found");
      assert.equal(operationId, "workflow.get");
      return workflowOutput();
    },
    events: async () => {},
  });
  assert.equal(result.code, ExitCode.success);
  assert.deepEqual(calls, [
    { operationId: "run.get", input: { runId: "workflow-1" } },
    { operationId: "workflow.get", input: { workflowId: "workflow-1" } },
  ]);
  assert.equal(result.envelope.result.phase, "running");
  assert.deepEqual(result.envelope.result.workflow, {
    workflowId: "workflow-1",
    expectedVersion: 3,
  });
});

for (const [status, exitCode] of [
  [403, ExitCode.auth],
  [500, ExitCode.server],
] as const) {
  test(`inspect preserves a canonical Run ${status} error without workflow fallback`, async () => {
    const calls: string[] = [];
    const result = await inspect(["inspect", "run-1"], {
      async invoke(operationId) {
        calls.push(operationId);
        throw new ApiError(status, "Canonical Run read failed");
      },
      events: async () => {},
    });
    assert.equal(result.code, exitCode);
    assert.deepEqual(calls, ["run.get"]);
    assert.equal(result.envelope.type, "error");
    assert.equal(result.envelope.error.message, "Canonical Run read failed");
  });
}

test("inspect keeps bounded legacy reference handling without a canonical Run probe", async () => {
  const result = await inspect(["inspect", "relay-workflow.v1.abc"], {
    invoke: async () => {
      throw new Error("An invalid legacy reference must not invoke any operation");
    },
    events: async () => {},
  });
  assert.equal(result.code, ExitCode.success);
  assert.equal(result.envelope.result.kind, "run-test");
  assert.equal(result.envelope.result.phase, "needs-attention");
  assert.equal(result.envelope.result.problems[0].code, "invalid-workflow-ref");
});
