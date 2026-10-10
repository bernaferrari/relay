import { ApiError } from "@relay/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { CAPTURE_REVIEW_DEST_PHASE, RC23_SCREENSHOT_FIRST_TESTS } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeRelayOperatorTool,
  planRunExecutionMode,
  recoverSerialFromLane,
} from "./operator-tool-dispatch.js";
import {
  relayOperatorToolNames,
  relayOperatorTools,
  type RelayOperatorToolDescriptor,
} from "./operator-tools.js";
import { createMcpServer, type OperationInvoker } from "./server.js";
import { relayEverydayToolsForProfile } from "./everyday-tools.js";

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

test("recover uses the Lane target instead of asking for a separate serial", async () => {
  assert.equal(
    recoverSerialFromLane(
      { target: { kind: "browser", browserTargetId: "browser-1" } },
      "grok-daily",
    ),
    "browser-1",
  );
  assert.equal(
    recoverSerialFromLane({ target: { kind: "device", serial: "ipad" } }, "ipad-lab"),
    "ipad",
  );
  assert.throws(() => recoverSerialFromLane(undefined, "missing"), /Lane missing was not found/u);

  const calls: Call[] = [];
  const result = await invokeRelayOperatorTool({
    name: "relay_recover",
    argumentsValue: { lane: "grok-daily" },
    confirmed: false,
    actorId: "agent:cursor",
    signal: AbortSignal.timeout(1000),
    invoker: {
      async invoke(operationId, input) {
        calls.push({ operationId, input });
        if (operationId === "lane.list") {
          return {
            lanes: [
              { id: "grok-daily", target: { kind: "browser", browserTargetId: "browser-1" } },
            ],
          };
        }
        return { ok: true, invoked: operationId };
      },
    },
  });
  assert.deepEqual(calls, [
    { operationId: "lane.list", input: {} },
    { operationId: "target.recover", input: { serial: "browser-1" } },
  ]);
  assert.deepEqual(result, { ok: true, invoked: "target.recover" });
});

test("a bounded goal is refused until the caller confirms it", async () => {
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_goal",
      argumentsValue: example("relay_goal"),
      confirmed: false,
      actorId: "agent:cursor",
      signal: AbortSignal.timeout(1000),
      invoker: { async invoke() {} },
    }),
    /requires confirm: true/u,
  );
});

test("a confirmed goal is handed to the existing goal runner", async () => {
  await assert.rejects(
    invokeRelayOperatorTool({
      name: "relay_goal",
      argumentsValue: example("relay_goal"),
      confirmed: true,
      actorId: "agent:cursor",
      signal: AbortSignal.timeout(2000),
      invoker: {
        async invoke() {
          throw new Error("goal-start-observed");
        },
      },
    }),
    /goal-start-observed/u,
  );
});

test("a bounded goal requires a page to open", () => {
  const goal = relayOperatorTools.find((tool) => tool.name === "relay_goal");
  assert.ok(goal);
  assert.equal(goal.inputSchema.safeParse({ goal: "Open settings" }).success, false);
  assert.equal(goal.inputSchema.safeParse(example("relay_goal")).success, true);
  assert.equal(
    goal.inputSchema.safeParse({
      goal: "Open settings",
      startUrl: "https://app.test",
      laneId: "grok-daily",
    }).success,
    true,
  );
  assert.equal(
    goal.inputSchema.safeParse({ goal: "Open settings", startUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    goal.inputSchema.safeParse({ goal: "Open settings", startUrl: "file:///etc/passwd" }).success,
    false,
  );
});

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
  relay_cancel: { jobId: "job-1" },
  relay_export: { runId: "run-1", with: ["run-2"] },
  relay_save: {
    appMapId: "checkout",
    testId: "smoke",
    expectedRevision: 7,
    test: {
      name: "Checkout smoke",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [],
    },
  },
  relay_goal: {
    goal: "Open settings and capture language options",
    startUrl: "http://127.0.0.1:3000",
  },
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
  assert.ok(relayOperatorTools.length <= 23);
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
    "relay_cancel",
    "relay_export",
    "relay_save",
    "relay_goal",
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
  assert.match(plan.description, /one case of a saved Plan/u);
  assert.match(plan.description, /executionMode all/u);
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
    true,
  );
});

test("plan run executionMode all stays every case", () => {
  assert.equal(planRunExecutionMode(undefined), "pilot");
  assert.equal(planRunExecutionMode("pilot"), "pilot");
  assert.equal(planRunExecutionMode("all"), "all");
  assert.equal(planRunExecutionMode("everything"), "pilot");
});

test("operator profile registers the everyday loop plus at most 23 hand-named verbs and hides takeover", async () => {
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
    // The describe → run → verdict loop comes first, then the hand-named verbs.
    assert.deepEqual(names, [
      ...relayEverydayToolsForProfile("operator").map(({ name }) => name),
      ...relayOperatorToolNames,
    ]);
    assert.ok(relayOperatorToolNames.length <= 23);
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
  assert.deepEqual(await run("relay_cancel", { jobId: "job-1" }), {
    ok: true,
    invoked: "job.cancel",
  });
  assert.deepEqual(await run("relay_export", { runId: "run-1", with: ["run-2"] }), {
    ok: true,
    invoked: "run.walkthrough-pack.get",
  });
  assert.deepEqual(calls.at(-1), {
    operationId: "run.walkthrough-pack.get",
    input: { runId: "run-1", with: ["run-2"] },
  });
  assert.deepEqual(await run("relay_save", example("relay_save"), "agent:cursor", true), {
    ok: true,
    invoked: "app-map.test.save",
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
        (call.input as { executionMode?: string }).executionMode === "pilot",
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

test("operator plan run dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    if (operationId === "job.combine.start") {
      return {
        campaign: { id: "camp-1" },
        jobs: [{ id: leftoverDestEndJob.id, status: "queued" }],
      };
    }
    if (operationId === "job.get") return { job: leftoverDestEndJob };
    return { ok: true };
  });
  const plan = (await invokeRelayOperatorTool({
    name: "relay_plan_run",
    argumentsValue: example("relay_plan_run"),
    confirmed: false,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
    pollIntervalMs: 0,
  })) as {
    campaign?: unknown;
    result?: { campaign?: { id?: string } };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.equal(plan.result?.campaign?.id, "camp-1");
  assert.deepEqual(
    plan.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    plan.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    plan.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
  assert.equal(
    plan.jobs?.some((job) =>
      job.captureReview?.some((item) => item.framePath === "frames/004.png"),
    ),
    false,
  );
});

test("operator visual compare dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "run.visual.compare");
    return {
      comparison: {
        latest: {
          frames: leftoverDestEndJob.frames,
          frameCount: leftoverDestEndJob.frames.length,
        },
      },
    };
  });
  const compared = (await invokeRelayOperatorTool({
    name: "relay_visual_compare",
    argumentsValue: { runId: leftoverDestEndJob.id },
    confirmed: false,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  })) as {
    destIdentity?: Array<{ path?: string }>;
    comparison?: { latest?: { frames?: Array<{ path?: string }> } };
  };
  assert.deepEqual(
    compared.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    compared.comparison?.latest?.frames?.some((frame) => frame.path === "frames/004.png"),
    false,
  );
});

test("operator visual review dest identity never accepts leftover Close 004 as dest", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "run.visual.review");
    return {
      comparison: {
        latest: {
          frames: leftoverDestEndJob.frames,
          frameCount: leftoverDestEndJob.frames.length,
        },
      },
      decision: { action: "keep-baseline" },
    };
  });
  const reviewed = (await invokeRelayOperatorTool({
    name: "relay_visual_review",
    argumentsValue: {
      runId: leftoverDestEndJob.id,
      comparisonId: "visual-comparison-leftover",
      action: "keep-baseline",
    },
    confirmed: true,
    invoker,
    actorId: "human:local-cli",
    signal: new AbortController().signal,
  })) as {
    destIdentity?: Array<{ path?: string }>;
    comparison?: { latest?: { frames?: Array<{ path?: string }> } };
    decision?: { action?: string };
  };
  assert.equal(reviewed.decision?.action, "keep-baseline");
  assert.deepEqual(
    reviewed.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    reviewed.comparison?.latest?.frames?.some((frame) => frame.path === "frames/004.png"),
    false,
  );
});

test("operator advanced combine campaign dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    if (operationId === "job.combine.campaign.get") {
      return { campaign: { id: "camp-1", status: "ready-to-resume" } };
    }
    if (operationId === "job.combine.campaign.resume") {
      return {
        campaign: { id: "camp-1", status: "running" },
        jobs: [leftoverDestEndJob],
        cells: [{ cellId: "cell-1" }],
      };
    }
    if (operationId === "job.combine.campaign.repeat.clusters") {
      return {
        schemaVersion: 1,
        campaignId: "camp-1",
        clusters: [
          {
            id: "cluster-1",
            cases: [{ runId: leftoverDestEndJob.id, evidenceRefs: ["run:4b93702b"] }],
          },
        ],
      };
    }
    return { ok: true };
  });
  const signal = new AbortController().signal;
  const run = (operationId: string, input: Record<string, unknown>, confirmed = false) =>
    invokeRelayOperatorTool({
      name: "relay_advanced",
      argumentsValue: { operationId, input },
      confirmed,
      invoker,
      actorId: "agent:cursor",
      signal,
    });

  const listed = (await run("job.combine.campaign.get", { batchId: "camp-1" })) as {
    campaign?: { id?: string };
    destIdentity?: unknown;
  };
  assert.equal(listed.campaign?.id, "camp-1");
  assert.equal(listed.destIdentity, undefined);

  const resumed = (await run("job.combine.campaign.resume", { batchId: "camp-1" }, true)) as {
    campaign?: { id?: string };
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.equal(resumed.campaign?.id, "camp-1");
  assert.deepEqual(
    resumed.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    resumed.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("operator advanced combine export dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "job.combine.export");
    return {
      rootDir: "/tmp/pack",
      jobIds: [leftoverDestEndJob.id],
      manifest: {
        cases: [
          {
            locale: "en",
            status: "ok",
            frames: leftoverDestEndJob.frames,
          },
        ],
        byCanonicalKey: {
          "frame-dest": { en: "frames/003.png" },
          "frame-leftover": { en: "frames/004.png" },
        },
        analysis: {
          baselineLocale: "en",
          critical: 0,
          warnings: 1,
          affectedScreens: 1,
          findings: [
            { id: "finding-dest", canonicalKey: "frame-dest", locale: "en" },
            { id: "finding-leftover", canonicalKey: "frame-leftover", locale: "en" },
          ],
        },
      },
    };
  });
  const exported = (await invokeRelayOperatorTool({
    name: "relay_advanced",
    argumentsValue: { operationId: "job.combine.export", input: { batchId: "dest-004" } },
    confirmed: false,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  })) as {
    destIdentity?: Array<{ path?: string }>;
    manifest?: {
      cases?: Array<{ frameCount?: number }>;
      analysis?: { findings?: Array<{ frame?: string }> };
    };
  };
  assert.deepEqual(
    exported.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(exported.manifest?.cases?.[0]?.frameCount, 1);
  assert.equal(
    exported.manifest?.analysis?.findings?.some((finding) => finding.frame === "frames/004.png"),
    false,
  );
});

test("operator advanced job retry dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "job.retry");
    return { job: leftoverDestEndJob };
  });
  const retried = (await invokeRelayOperatorTool({
    name: "relay_advanced",
    argumentsValue: {
      operationId: "job.retry",
      input: { jobId: leftoverDestEndJob.id },
    },
    confirmed: true,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  })) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    retried.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    retried.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("operator advanced job pause dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "job.pause");
    return { job: leftoverDestEndJob };
  });
  const paused = (await invokeRelayOperatorTool({
    name: "relay_advanced",
    argumentsValue: {
      operationId: "job.pause",
      input: { jobId: leftoverDestEndJob.id },
    },
    confirmed: true,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  })) as {
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.deepEqual(
    paused.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    paused.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("operator advanced repair retry dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "run.repair.retry");
    return {
      repair: {
        schemaVersion: 1,
        id: "repair-1",
        source: { runId: leftoverDestEndJob.id, checkId: "check-language" },
      },
      job: leftoverDestEndJob,
    };
  });
  const retried = (await invokeRelayOperatorTool({
    name: "relay_advanced",
    argumentsValue: {
      operationId: "run.repair.retry",
      input: { runId: leftoverDestEndJob.id, checkId: "check-language" },
    },
    confirmed: true,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  })) as {
    repair?: { id?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(retried.repair?.id, "repair-1");
  assert.deepEqual(
    retried.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    retried.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("operator advanced run review dest identity is dest wait-for, not leftover Close 004 last-frame", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    assert.equal(operationId, "run.review");
    return {
      review: { status: "approved", action: "approve" },
      run: leftoverDestEndJob,
    };
  });
  const reviewed = (await invokeRelayOperatorTool({
    name: "relay_advanced",
    argumentsValue: {
      operationId: "run.review",
      input: { runId: leftoverDestEndJob.id, action: "approve" },
    },
    confirmed: true,
    invoker,
    actorId: "human:local-cli",
    signal: new AbortController().signal,
  })) as {
    review?: { status?: string };
    run?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(reviewed.review?.status, "approved");
  assert.deepEqual(
    reviewed.run?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    reviewed.run?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("operator advanced leftover Close 004 cannot fill dest on remaining job/flow/campaign/offline envelopes", async () => {
  const { invoker } = recordingInvoker((operationId) => {
    if (operationId === "job.list") return { jobs: [leftoverDestEndJob] };
    if (operationId === "job.start" || operationId === "job.active.cancel") {
      return { job: leftoverDestEndJob };
    }
    if (operationId === "app-map.flow.run") {
      return {
        plan: { appMapId: "map", appMapRevision: 1, connections: [{ id: "c1" }] },
        job: leftoverDestEndJob,
        jobs: [leftoverDestEndJob],
        matrix: { id: "matrix-1" },
      };
    }
    if (
      operationId === "job.combine.campaign.cancel" ||
      operationId === "job.combine.campaign.triage"
    ) {
      return { campaign: { id: "camp-1", status: "cancelled" }, jobs: [leftoverDestEndJob] };
    }
    if (operationId === "run.replay.offline") {
      return {
        report: {
          schemaVersion: 1,
          mode: "offline-evidence-replay",
          runId: leftoverDestEndJob.id,
          frames: leftoverDestEndJob.frames,
          artifacts: leftoverDestEndJob.artifacts,
        },
      };
    }
    return { ok: true };
  });
  const signal = new AbortController().signal;
  const run = (operationId: string, input: Record<string, unknown>, confirmed = false) =>
    invokeRelayOperatorTool({
      name: "relay_advanced",
      argumentsValue: { operationId, input },
      confirmed,
      invoker,
      actorId: "agent:cursor",
      signal,
    });

  const listed = (await run("job.list", {})) as {
    jobs?: Array<{
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    }>;
  };
  assert.deepEqual(
    listed.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    listed.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );

  for (const operationId of ["job.start", "job.active.cancel"] as const) {
    const started = (await run(
      operationId,
      operationId === "job.start" ? { recipe: "smoke" } : {},
      true,
    )) as {
      job?: {
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      };
    };
    assert.deepEqual(
      started.job?.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
      operationId,
    );
    assert.equal(
      started.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
      operationId,
    );
  }

  const flowed = (await run("app-map.flow.run", { appMapId: "map", flowId: "flow" }, true)) as {
    plan?: { appMapId?: string; connectionCount?: number };
    matrix?: { id?: string };
    job?: {
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(flowed.plan?.appMapId, "map");
  assert.equal(flowed.plan?.connectionCount, 1);
  assert.equal(flowed.matrix?.id, "matrix-1");
  assert.deepEqual(
    flowed.job?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    flowed.job?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );

  for (const [operationId, input] of [
    ["job.combine.campaign.cancel", { batchId: "camp-1" }],
    [
      "job.combine.campaign.triage",
      { batchId: "camp-1", caseIds: ["cell-1"], triageStatus: "resolved" },
    ],
  ] as const) {
    const cancelled = (await run(operationId, input, true)) as {
      campaign?: { id?: string };
      jobs?: Array<{
        destIdentity?: Array<{ path?: string }>;
        captureReview?: Array<{ framePath?: string }>;
      }>;
    };
    assert.equal(cancelled.campaign?.id, "camp-1");
    assert.deepEqual(
      cancelled.jobs?.[0]?.destIdentity?.map((frame) => frame.path),
      ["frames/003.png"],
    );
    assert.equal(
      cancelled.jobs?.[0]?.captureReview?.some((item) => item.framePath === "frames/004.png"),
      false,
      operationId,
    );
  }

  const replayed = (await run("run.replay.offline", { runId: leftoverDestEndJob.id })) as {
    destIdentity?: Array<{ path?: string }>;
    report?: {
      mode?: string;
      destIdentity?: Array<{ path?: string }>;
      captureReview?: Array<{ framePath?: string }>;
    };
  };
  assert.equal(replayed.report?.mode, "offline-evidence-replay");
  assert.deepEqual(
    replayed.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.deepEqual(
    replayed.report?.destIdentity?.map((frame) => frame.path),
    ["frames/003.png"],
  );
  assert.equal(
    replayed.report?.captureReview?.some((item) => item.framePath === "frames/004.png"),
    false,
  );
});

test("Lane observation and controls preserve the exact saved account without a serial", async () => {
  for (const [name, args, operationId] of [
    ["relay_snapshot", { full: true }, "target.snapshot.capture"],
    ["relay_preview", { label: "Settings" }, "target.interact"],
    ["relay_tap", { label: "Settings" }, "target.interact"],
    ["relay_type", { text: "hello" }, "target.interact"],
    ["relay_swipe", { from: { x: 10, y: 80 }, to: { x: 10, y: 20 } }, "target.interact"],
  ] as const) {
    const { invoker, calls } = recordingInvoker(() => ({}));
    await invokeRelayOperatorTool({
      name,
      argumentsValue: { lane: "signed-in", ...args },
      confirmed: false,
      invoker,
      actorId: "agent:test",
      signal: new AbortController().signal,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.operationId, operationId);
    assert.equal((calls[0]?.input as Record<string, unknown>).laneId, "signed-in");
    assert.equal(Object.hasOwn(calls[0]?.input as object, "serial"), false);
    if (name === "relay_preview")
      assert.equal((calls[0]?.input as Record<string, unknown>).preview, true);
    for (const selection of [
      {},
      { serial: "other", lane: "signed-in" },
      { lane: "signed-in", laneId: "signed-out" },
    ]) {
      await assert.rejects(
        invokeRelayOperatorTool({
          name,
          argumentsValue: { ...selection, ...args },
          confirmed: false,
          invoker,
          actorId: "agent:test",
          signal: new AbortController().signal,
        }),
      );
    }
    assert.equal(calls.length, 1, "invalid selections must fail before any device operation");
  }
});

test("nonblocking Plan start returns continuation IDs without polling or accepting visual evidence", async () => {
  const { invoker, calls } = recordingInvoker(() => ({
    batch: { id: "batch-1" },
    jobs: [{ id: "job-1", status: "running" }],
  }));
  const result = (await invokeRelayOperatorTool({
    name: "relay_plan_run",
    argumentsValue: { appMapId: "app", combineId: "plan", wait: false },
    confirmed: false,
    invoker,
    actorId: "agent:test",
    signal: new AbortController().signal,
  })) as Record<string, unknown>;
  assert.equal(result.status, "started");
  assert.equal(result.batchId, "batch-1");
  assert.deepEqual(result.jobIds, ["job-1"]);
  assert.deepEqual(
    calls.map((call) => call.operationId),
    ["job.combine.start"],
  );
  for (const args of [
    { wait: false, export: true },
    { wait: false, findings: true },
    { export: "/ignored/path" },
  ]) {
    await assert.rejects(
      invokeRelayOperatorTool({
        name: "relay_plan_run",
        argumentsValue: { appMapId: "app", combineId: "plan", ...args },
        confirmed: false,
        invoker,
        actorId: "agent:test",
        signal: new AbortController().signal,
      }),
    );
  }
  assert.equal(calls.length, 1);
});

test("job inspection returns running truth once without waiting or restarting", async () => {
  const { invoker, calls } = recordingInvoker(() => ({ job: { id: "job-1", status: "running" } }));
  const result = (await invokeRelayOperatorTool({
    name: "relay_wait",
    argumentsValue: { jobId: "job-1", wait: false },
    confirmed: false,
    invoker,
    actorId: "agent:test",
    signal: new AbortController().signal,
  })) as Record<string, unknown>;
  assert.equal(result.status, "running");
  assert.equal(result.terminal, false);
  assert.equal(result.ok, undefined);
  assert.deepEqual(calls, [{ operationId: "job.get", input: { jobId: "job-1" } }]);
});

test("relay_screenshot accepts a lane instead of a serial and forwards laneId", async () => {
  const { invoker, calls } = recordingInvoker(() => ({ base64: "aGk=", mime: "image/png" }));
  const result = await invokeRelayOperatorTool({
    name: "relay_screenshot",
    argumentsValue: { lane: "member-lane" },
    confirmed: false,
    invoker,
    actorId: "agent:cursor",
    signal: new AbortController().signal,
  });
  assert.equal(calls.length, 1);
  const [call] = calls as [{ operationId: string; input: Record<string, unknown> }];
  assert.equal(call.operationId, "target.screenshot.capture");
  assert.equal(call.input.laneId, "member-lane");
  assert.equal(call.input.serial, undefined);
  void result;
});
