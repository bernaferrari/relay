import { ApiError } from "@relay/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CAPTURE_REVIEW_DEST_PHASE, RC23_SCREENSHOT_FIRST_TESTS } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeRelayOperatorTool,
  relayOperatorToolNames,
  relayOperatorTools,
  type RelayOperatorToolDescriptor,
} from "./operator-tools.js";
import { createMcpServer, type OperationInvoker } from "./server.js";

type Call = { operationId: string; input: unknown };

function recordingInvoker(
  handler: (operationId: string, input: Record<string, unknown>) => unknown | Promise<unknown>,
): { invoker: OperationInvoker; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    invoker: {
      async invoke(operationId, input) {
        const payload = (input ?? {}) as Record<string, unknown>;
        calls.push({ operationId, input: payload });
        return handler(operationId, payload);
      },
    },
  };
}

const examples: Record<RelayOperatorToolDescriptor["name"], Record<string, unknown>> = {
  relay_health: {},
  relay_devices: {},
  relay_screenshot: { serial: "ipad" },
  relay_snapshot: { serial: "ipad", full: true },
  relay_preview: { serial: "ipad", label: "Back" },
  relay_tap: { serial: "ipad", label: "Back" },
  relay_type: { serial: "ipad", text: "hello" },
  relay_swipe: { serial: "ipad", from: { x: 200, y: 800 }, to: { x: 200, y: 200 } },
  relay_recover: { serial: "ipad" },
  relay_teach: {
    appMapId: "grok-ios",
    target: { kind: "device", platform: "ios", targetId: "ipad" },
    title: "Settings",
  },
  relay_run: { appMapId: "grok-web", testId: "logged-out-home", lane: "grok-daily" },
  relay_plan_run: {
    appMapId: "grok-web",
    combineId: "grok-hourly",
    lane: "grok-lab",
    findings: true,
    export: true,
  },
  relay_wait: { jobId: "job-1" },
  relay_findings: { batchId: "camp-1" },
  relay_evidence: { runId: "run-1" },
  relay_visual_compare: { runId: "run-1" },
  relay_visual_review: {
    runId: "run-1",
    comparisonId: "cmp-1",
    action: "approve-new-baseline",
  },
  relay_lanes: {},
  relay_advanced: { operationId: "app-map.list", input: {} },
};

function example(name: RelayOperatorToolDescriptor["name"]): Record<string, unknown> {
  const value = examples[name];
  assert.ok(value, name);
  return value;
}

test("every operator verb has a schema and a description with a worked example", () => {
  assert.equal(relayOperatorTools.length, relayOperatorToolNames.length);
  assert.ok(relayOperatorTools.length <= 21);
  assert.deepEqual(relayOperatorToolNames, [
    "relay_health",
    "relay_devices",
    "relay_screenshot",
    "relay_snapshot",
    "relay_preview",
    "relay_tap",
    "relay_type",
    "relay_swipe",
    "relay_recover",
    "relay_teach",
    "relay_run",
    "relay_plan_run",
    "relay_wait",
    "relay_findings",
    "relay_evidence",
    "relay_visual_compare",
    "relay_visual_review",
    "relay_lanes",
    "relay_advanced",
  ]);
  for (const descriptor of relayOperatorTools) {
    assert.match(descriptor.description, /example/i, descriptor.name);
    assert.doesNotMatch(descriptor.description, /Pass operation fields directly/u, descriptor.name);
    assert.equal(
      descriptor.inputSchema.safeParse(example(descriptor.name)).success,
      true,
      descriptor.name,
    );
  }
});

test("operator copy uses Plan language and adopts a live runner", () => {
  const recover = relayOperatorTools.find((tool) => tool.name === "relay_recover");
  assert.ok(recover);
  assert.match(recover.description, /adopts the live XCTest runner/u);
  assert.doesNotMatch(recover.description, /remount/u);
  const plan = relayOperatorTools.find((tool) => tool.name === "relay_plan_run");
  assert.ok(plan);
  assert.match(plan.description, /saved Plan \(every selected case\)/u);
  assert.match(plan.description, /Infra columns/u);
  assert.doesNotMatch(plan.description, /\(Combine\)/u);
  const findings = relayOperatorTools.find((tool) => tool.name === "relay_findings");
  assert.ok(findings);
  assert.match(findings.description, /Plan findings/u);
  assert.doesNotMatch(findings.description, /Combine findings/u);
  assert.equal(
    plan.inputSchema.safeParse({
      appMapId: "grok-web",
      combineId: "grok-hourly",
      executionMode: "pilot",
    }).success,
    false,
  );
});

test("operator profile registers at most 21 hand-named verbs and hides takeover", async () => {
  const server = createMcpServer({
    invoker: { async invoke() {} },
    scope: { projectId: "default" },
    profile: "operator",
    actorId: "agent:cursor",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<
    number,
    (response: { result?: { tools?: Array<{ name: string }> } }) => void
  >();
  let nextId = 0;
  clientTransport.onmessage = (message) => {
    if (!("id" in message) || typeof message.id !== "number") return;
    pending.get(message.id)?.(message as { result?: { tools?: Array<{ name: string }> } });
  };
  const request = (method: string, params: Record<string, unknown>) => {
    const id = ++nextId;
    const response = new Promise<{ result?: { tools?: Array<{ name: string }> } }>((resolve) => {
      pending.set(id, resolve);
    });
    void clientTransport.send({ jsonrpc: "2.0", id, method, params } as never);
    return response;
  };
  await server.connect(serverTransport);
  await clientTransport.start();
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "operator-test", version: "0.1.0" },
  });
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  } as never);
  try {
    const listed = await request("tools/list", {});
    const names = (listed.result?.tools ?? []).map(({ name }) => name);
    assert.deepEqual(names, relayOperatorToolNames);
    assert.ok(names.length <= 21);
    assert.equal(names.includes("relay_lease_takeover"), false);
    assert.ok(names.includes("relay_screenshot"));
    assert.ok(names.includes("relay_preview"));
    assert.ok(names.includes("relay_run"));
    assert.ok(names.includes("relay_advanced"));
  } finally {
    await Promise.allSettled([server.close(), clientTransport.close()]);
  }
});

test("operator verbs invoke canonical operations including optional laneId", async () => {
  const { invoker, calls } = recordingInvoker((operationId, input) => {
    if (operationId === "lease.create") return { lease: { id: "lease-1" } };
    if (operationId === "job.combine.start") {
      return { jobs: [{ id: "job-1", status: "ok" }], campaign: { id: "camp-1" } };
    }
    if (operationId === "job.get") return { job: { id: input.jobId, status: "ok" } };
    if (operationId === "job.combine.analysis") return { findings: [] };
    if (operationId === "job.combine.export") return { rootDir: "/tmp/pack", jobIds: ["job-1"] };
    return { ok: true, invoked: operationId };
  });
  const signal = new AbortController().signal;
  const run = (
    name: RelayOperatorToolDescriptor["name"],
    argumentsValue: Record<string, unknown>,
    actorId = "agent:cursor",
    confirmed = false,
  ) =>
    invokeRelayOperatorTool({
      name,
      argumentsValue,
      confirmed,
      invoker,
      actorId,
      signal,
      pollIntervalMs: 0,
    });

  assert.deepEqual(await run("relay_health", {}), { ok: true, invoked: "system.health.get" });
  assert.deepEqual(await run("relay_tap", { serial: "ipad", label: "Back" }), {
    ok: true,
    invoked: "target.interact",
  });
  assert.deepEqual(await run("relay_run", example("relay_run")), {
    ok: true,
    invoked: "app-map.test.run",
  });
  const plan = await run("relay_plan_run", example("relay_plan_run"));
  assert.equal((plan as { operationId: string }).operationId, "job.combine.start");
  assert.equal((plan as { ok: boolean }).ok, true);
  assert.deepEqual(await run("relay_wait", { jobId: "job-1" }), {
    type: "result",
    ok: true,
    operationId: "job.get",
    result: { job: { id: "job-1", status: "ok" } },
  });

  assert.ok(
    calls.some(
      (call) =>
        call.operationId === "app-map.test.run" &&
        (call.input as { laneId?: string }).laneId === "grok-daily",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call.operationId === "job.combine.start" &&
        (call.input as { laneId?: string; executionMode?: string }).laneId === "grok-lab" &&
        (call.input as { executionMode?: string }).executionMode === "all",
    ),
  );
  assert.ok(calls.some((call) => call.operationId === "target.interact"));
  assert.ok(calls.some((call) => call.operationId === "job.combine.analysis"));
  assert.ok(calls.some((call) => call.operationId === "job.combine.export"));
});

test("relay_advanced refuses lease.takeover outside full", async () => {
  const { invoker, calls } = recordingInvoker(() => ({ ok: true }));
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_advanced",
      argumentsValue: {
        operationId: "lease.takeover",
        input: { leaseId: "lease-1", reason: "need device", confirm: true },
      },
      confirmed: true,
      invoker,
      actorId: "agent:cursor",
      signal: new AbortController().signal,
      profile: "operator",
    }),
    /lease\.takeover/u,
  );
  assert.deepEqual(calls, []);
});

test("relay_advanced accepts capture-view on GQA-004/040 test.edit", async () => {
  const { invoker, calls } = recordingInvoker(() => ({ ok: true }));
  for (const testId of [
    RC23_SCREENSHOT_FIRST_TESTS.attach.ios,
    RC23_SCREENSHOT_FIRST_TESTS.settings.ios,
    RC23_SCREENSHOT_FIRST_TESTS.attach.android,
    RC23_SCREENSHOT_FIRST_TESTS.settings.android,
  ]) {
    assert.ok(testId);
    const payload = {
      appMapId: "grok-ios",
      testId,
      expectedRevision: 1,
      edits: [{ kind: "test.patch", patch: { requirementAction: "capture-view" } }],
    };
    await invokeRelayOperatorTool({
      name: "relay_advanced",
      argumentsValue: { operationId: "app-map.test.edit", input: payload },
      confirmed: false,
      invoker,
      actorId: "agent:cursor",
      signal: new AbortController().signal,
      profile: "operator",
    });
    assert.deepEqual(calls.at(-1), { operationId: "app-map.test.edit", input: payload });
  }
  assert.equal(calls.length, 4);
});

test("relay_visual_review requires confirm:true and refuses agent:* actors", async () => {
  const { invoker, calls } = recordingInvoker(() => ({ ok: true }));
  const argumentsValue = example("relay_visual_review");
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_visual_review",
      argumentsValue,
      confirmed: false,
      invoker,
      actorId: "human:local-cli",
      signal: new AbortController().signal,
    }),
    /requires confirm: true/u,
  );
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_visual_review",
      argumentsValue,
      confirmed: true,
      invoker,
      actorId: "agent:cursor",
      signal: new AbortController().signal,
    }),
    /agent:\*/u,
  );
  const result = await invokeRelayOperatorTool({
    name: "relay_visual_review",
    argumentsValue,
    confirmed: true,
    invoker,
    actorId: "human:local-cli",
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    {
      operationId: "run.visual.review",
      input: {
        runId: "run-1",
        comparisonId: "cmp-1",
        action: "approve-new-baseline",
      },
    },
  ]);
});

test("operator verbs auto-create a lease on TARGET_CONTROL_LEASE_REQUIRED", async () => {
  let taps = 0;
  const { invoker, calls } = recordingInvoker((operationId) => {
    if (operationId === "target.interact") {
      taps += 1;
      if (taps === 1) {
        throw new ApiError(403, "Take control of this target before sending device input", {
          code: "TARGET_CONTROL_LEASE_REQUIRED",
        });
      }
      return { ok: true };
    }
    if (operationId === "lease.create") return { lease: { id: "lease-1" } };
    throw new Error(`unexpected ${operationId}`);
  });
  const result = await invokeRelayOperatorTool({
    name: "relay_tap",
    argumentsValue: { serial: "ipad", label: "Back" },
    confirmed: false,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(
    calls.map(({ operationId }) => operationId),
    ["target.interact", "lease.create", "target.interact"],
  );
  assert.deepEqual(calls[1]?.input, { poolId: "local", deviceSerial: "ipad" });
});

test("operator 403 names who holds the lease and since when", async () => {
  const since = Date.parse("2026-09-13T12:00:00.000Z");
  const { invoker } = recordingInvoker(() => {
    throw new ApiError(403, "This target is currently controlled by another actor", {
      code: "TARGET_CONTROL_LEASE_CONFLICT",
      activeLease: { ownerId: "human:local-cli", leasedAt: since },
    });
  });
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_tap",
      argumentsValue: { serial: "ipad", identifier: "settings.gear" },
      confirmed: false,
      invoker,
      actorId: "agent:cursor",
      signal: new AbortController().signal,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /held by human:local-cli since 2026-09-13T12:00:00.000Z/u);
      return true;
    },
  );
});

test("operator role or consent 403 keeps the original message", async () => {
  const { invoker } = recordingInvoker(() => {
    throw new ApiError(403, "This actor is missing the operator role for this project", {
      code: "ACTOR_ROLE_FORBIDDEN",
    });
  });
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_tap",
      argumentsValue: { serial: "ipad", identifier: "settings.gear" },
      confirmed: false,
      invoker,
      actorId: "agent:cursor",
      signal: new AbortController().signal,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "This actor is missing the operator role for this project");
      assert.doesNotMatch(error.message, /held by/u);
      return true;
    },
  );
});

const leftoverDestEndJob = {
  id: "4b93702b",
  status: "ok",
  frames: [
    { path: "frames/003.png", caption: "Observe" },
    { path: "frames/004.png", caption: "after · Run saved Test" },
  ],
  artifacts: [
    {
      kind: "capture-review",
      data: {
        caption: "Observe",
        framePath: "frames/003.png",
        phase: CAPTURE_REVIEW_DEST_PHASE,
        policy: "fast",
      },
    },
    {
      kind: "capture-review",
      data: { caption: "Close", framePath: "frames/004.png" },
    },
  ],
};

test("operator wait/run/evidence/advanced dest identity is dest wait-for, not leftover Close 004", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    if (operationId === "job.get") return { job: leftoverDestEndJob };
    if (operationId === "app-map.test.run") return { job: leftoverDestEndJob };
    if (operationId === "run.evidence.get") {
      return {
        evidence: {
          runId: leftoverDestEndJob.id,
          artifacts: leftoverDestEndJob.artifacts,
          testStepEvidence: [
            { testStepId: "step-observe", evidence: { framePaths: ["frames/003.png"] } },
            { testStepId: "step-observe", evidence: { framePaths: ["frames/004.png"] } },
          ],
        },
      };
    }
    return { ok: true };
  });
  const signal = new AbortController().signal;
  const run = (
    name: RelayOperatorToolDescriptor["name"],
    argumentsValue: Record<string, unknown>,
  ) =>
    invokeRelayOperatorTool({
      name,
      argumentsValue,
      confirmed: false,
      invoker,
      actorId: "agent:cursor",
      signal,
      pollIntervalMs: 0,
    });

  const waited = (await run("relay_wait", { jobId: leftoverDestEndJob.id })) as {
    result?: {
      job?: {
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      };
    };
  };
  assert.deepEqual(
    waited.result?.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    waited.result?.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );

  const started = (await run("relay_run", example("relay_run"))) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    started.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    started.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );

  const evidence = (await run("relay_evidence", { runId: leftoverDestEndJob.id })) as {
    evidence?: {
      destIdentity?: Array<{ path?: string }>;
      testStepEvidence?: Array<{ evidence?: { framePaths?: string[] } }>;
    };
  };
  assert.deepEqual(evidence.evidence?.destIdentity, [{ path: "frames/003.png" }]);
  assert.equal(
    evidence.evidence?.testStepEvidence?.some((item) =>
      item.evidence?.framePaths?.includes("frames/004.png"),
    ),
    false,
  );

  const advanced = (await run("relay_advanced", {
    operationId: "job.get",
    input: { jobId: leftoverDestEndJob.id },
  })) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    advanced.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    advanced.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});
