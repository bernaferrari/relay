import type { RelayOutcomeJobs } from "@relay/workflows";
import { operationDefinition } from "@relay/protocol";
import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeRelayOutcomeToolWithJobs,
  relayOutcomeTools,
  type RelayOutcomeToolDescriptor,
} from "./outcome-tools.js";
import { invokeRelayEverydayTool } from "./everyday-tools.js";
import type { OperationInvoker } from "./server.js";

const unusedInvoker: OperationInvoker = {
  async invoke(operationId) {
    throw new Error(`unexpected ${operationId}`);
  },
};

type Invocation = { method: keyof RelayOutcomeJobs; argumentsValue: unknown[] };

function tracePack(digit: string) {
  const digest = `sha256:${digit.repeat(64)}`;
  return {
    schemaVersion: 1 as const,
    kind: "relay-trace-pack" as const,
    digest,
    createdAt: 1,
    source: {
      runId: `run-${digit}`,
      runSchemaVersion: 5,
      status: "ok",
      action: "test",
      inputDigest: "a".repeat(64),
      writtenAt: 1,
    },
    redaction: { status: "applied-at-persistence" as const, redactedChannels: [] },
    completeness: { status: "complete" as const, channels: {}, missing: [], artifacts: [] },
    objects: [
      {
        path: "run.json",
        kind: "frozen-run" as const,
        mediaType: "application/json",
        encoding: "json" as const,
        digest,
        bytes: 2,
        content: {},
      },
    ],
  };
}

function recordingJobs(invocations: Invocation[]): RelayOutcomeJobs {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return async (...argumentsValue: unknown[]) => {
          invocations.push({
            method: property as keyof RelayOutcomeJobs,
            argumentsValue,
          });
          return { invoked: property };
        };
      },
    },
  ) as RelayOutcomeJobs;
}

test("every default MCP outcome tool validates and invokes exactly one façade method", async () => {
  const cases: Array<{
    name: RelayOutcomeToolDescriptor["name"];
    argumentsValue: Record<string, unknown>;
    confirmed?: boolean;
    method: keyof RelayOutcomeJobs;
    expected: unknown;
  }> = [
    {
      name: "relay_connect_target",
      argumentsValue: { targetId: "pixel-9" },
      method: "connect",
      expected: { kind: "connect-target", targetId: "pixel-9" },
    },
    {
      name: "relay_observe_target",
      argumentsValue: { targetId: "pixel-9" },
      method: "observe",
      expected: { kind: "observe-target", targetId: "pixel-9" },
    },
    {
      name: "relay_goal",
      argumentsValue: { startUrl: "https://example.test", goal: "Reach settings" },
      confirmed: true,
      method: "goal",
      expected: {
        kind: "goal-start",
        startUrl: "https://example.test",
        goal: "Reach settings",
      },
    },
    {
      name: "relay_record_test",
      argumentsValue: { appMapId: "settings", title: "Locale", targetId: "ipad" },
      confirmed: true,
      method: "record",
      expected: {
        kind: "record-test",
        appMapId: "settings",
        title: "Locale",
        confirmControl: true,
        targetId: "ipad",
      },
    },
    {
      name: "relay_record_action",
      argumentsValue: {
        workflowId: "recording-workflow",
        expectedVersion: 1,
        interaction: { kind: "tap", target: { label: "Settings" } },
      },
      method: "advanceRecording",
      expected: {
        action: "record",
        workflowId: "recording-workflow",
        expectedVersion: 1,
        interaction: { kind: "tap", target: { label: "Settings" } },
      },
    },
    {
      name: "relay_add_checkpoint",
      argumentsValue: { workflowId: "recording-workflow", expectedVersion: 2, label: "Settings" },
      method: "advanceRecording",
      expected: {
        action: "checkpoint",
        workflowId: "recording-workflow",
        expectedVersion: 2,
        label: "Settings",
      },
    },
    {
      name: "relay_stop_recording",
      argumentsValue: { workflowId: "recording-workflow", expectedVersion: 3 },
      method: "advanceRecording",
      expected: { action: "stop", workflowId: "recording-workflow", expectedVersion: 3 },
    },
    {
      name: "relay_edit_recording",
      argumentsValue: {
        workflowId: "recording-workflow",
        expectedVersion: 4,
        edit: {
          kind: "merge",
          actionIds: ["tap-menu", "tap-settings"],
          intent: "Open Settings",
        },
      },
      method: "editRecording",
      expected: {
        kind: "edit-recording",
        workflowId: "recording-workflow",
        expectedVersion: 4,
        edit: {
          kind: "merge",
          actionIds: ["tap-menu", "tap-settings"],
          intent: "Open Settings",
        },
      },
    },
    {
      name: "relay_replay_recording",
      argumentsValue: { workflowId: "recording-workflow", expectedVersion: 4 },
      method: "advanceRecording",
      expected: { action: "replay", workflowId: "recording-workflow", expectedVersion: 4 },
    },
    {
      name: "relay_approve_recording",
      argumentsValue: { workflowId: "recording-workflow", expectedVersion: 5 },
      confirmed: true,
      method: "advanceRecording",
      expected: { action: "approve", workflowId: "recording-workflow", expectedVersion: 5 },
    },
    {
      name: "relay_repeat_test",
      argumentsValue: {
        appMapId: "settings",
        testId: "locale",
        repeat: {
          dimensions: [
            { id: "language", values: ["ja", "pt-BR"] },
            { id: "theme", values: "supported" },
          ],
          strategy: "pairwise",
          pilot: { mode: "specified", case: { language: "ja", theme: "dark" } },
          resume: "untouched",
        },
        evidence: "visual",
        targetId: "ipad",
      },
      method: "repeat",
      expected: {
        kind: "repeat-test",
        appMapId: "settings",
        testId: "locale",
        repeat: {
          dimensions: [
            { id: "language", values: ["ja", "pt-BR"] },
            { id: "theme", values: "supported" },
          ],
          strategy: "pairwise",
          pilot: { mode: "specified", case: { language: "ja", theme: "dark" } },
          resume: "untouched",
        },
        evidence: "visual",
        targetId: "ipad",
      },
    },
    {
      name: "relay_inspect_workflow",
      argumentsValue: { workflowId: "workflow-id" },
      method: "inspect",
      expected: { workflowId: "workflow-id" },
    },
    {
      name: "relay_cancel_run",
      argumentsValue: { workflowId: "workflow-id", expectedVersion: 2 },
      confirmed: true,
      method: "cancelRun",
      expected: {
        kind: "cancel-run",
        workflowId: "workflow-id",
        expectedVersion: 2,
        confirmCancel: true,
      },
    },
    {
      name: "relay_continue_repeat",
      argumentsValue: { workflowId: "repeat-workflow", expectedVersion: 2 },
      confirmed: true,
      method: "continueRepeat",
      expected: {
        workflowId: "repeat-workflow",
        expectedVersion: 2,
        confirmRemaining: true,
      },
    },
    {
      name: "relay_propose_repair",
      argumentsValue: {
        runId: "run-1",
        checkId: "check-1",
        proposal: "accept-current",
        reason: "Approved copy change",
      },
      method: "proposeRepair",
      expected: {
        kind: "propose-repair",
        runId: "run-1",
        checkId: "check-1",
        proposal: "accept-current",
        reason: "Approved copy change",
      },
    },
    {
      name: "relay_replay_lab",
      argumentsValue: {
        analysis: "compare",
        tracePacks: [tracePack("a"), tracePack("b")],
      },
      method: "replayLab",
      expected: {
        kind: "replay-lab",
        analysis: "compare",
        tracePacks: [tracePack("a"), tracePack("b")],
      },
    },
    {
      name: "relay_inspect_proof",
      argumentsValue: { proofId: "proof-184", includeHistory: true },
      method: "inspectProof",
      expected: {
        kind: "inspect-proof",
        proofId: "proof-184",
        includeHistory: true,
      },
    },
    {
      name: "relay_prove_change",
      argumentsValue: { proofId: "proof-184", expectedVersion: 3, wait: true },
      method: "proveChange",
      expected: {
        kind: "prove-change",
        proofId: "proof-184",
        expectedVersion: 3,
        wait: true,
      },
    },
    {
      name: "relay_export_evidence",
      argumentsValue: { runId: "run-1" },
      method: "exportEvidence",
      expected: { kind: "export-evidence", runId: "run-1" },
    },
  ];

  assert.deepEqual(
    cases.map(({ name }) => name),
    relayOutcomeTools.map(({ name }) => name),
    "the contract table must cover every default outcome tool in public order",
  );

  for (const testCase of cases) {
    const invocations: Invocation[] = [];
    const result = await invokeRelayOutcomeToolWithJobs({
      name: testCase.name,
      argumentsValue: testCase.argumentsValue,
      confirmed: testCase.confirmed ?? false,
      jobs: recordingJobs(invocations),
    });
    assert.deepEqual(result, { invoked: testCase.method });
    assert.deepEqual(invocations, [
      { method: testCase.method, argumentsValue: [testCase.expected] },
    ]);
  }
});

test("mobile target scope and recording origin reach the existing facade", async () => {
  const invocations: Invocation[] = [];
  const jobs = recordingJobs(invocations);
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_connect_target",
    argumentsValue: { targetKind: "device", phase: "android" },
    confirmed: false,
    jobs,
  });
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_record_test",
    argumentsValue: {
      title: "Reply completes",
      targetId: "pixel-9",
      targetKind: "device",
      originApplication: "ai.x.grok",
    },
    confirmed: true,
    jobs,
  });
  assert.deepEqual(invocations, [
    {
      method: "connect",
      argumentsValue: [{ kind: "connect-target", targetKind: "device", phase: "android" }],
    },
    {
      method: "record",
      argumentsValue: [
        {
          kind: "record-test",
          title: "Reply completes",
          targetId: "pixel-9",
          targetKind: "device",
          originApplication: "ai.x.grok",
          confirmControl: true,
        },
      ],
    },
  ]);
  for (const argumentsValue of [{ phase: "browser" }, { targetKind: "android" }]) {
    await assert.rejects(
      invokeRelayOutcomeToolWithJobs({
        name: "relay_connect_target",
        argumentsValue,
        confirmed: false,
        jobs,
      }),
    );
  }
  assert.equal(invocations.length, 2, "invalid target filters never invoke the facade");
});

test("recorded outcome checks and insertion edits share canonical authoring schemas", async () => {
  const interaction = {
    kind: "steps",
    label: "Reply completes",
    steps: [
      {
        kind: "expect",
        target: { label: "Stop message" },
        condition: "gone",
        timeoutMs: 30_000,
      },
      { kind: "wait-for", target: { label: "Copy message" }, timeoutMs: 30_000 },
    ],
  };
  const edit = { kind: "insert-before", actionId: "capture-reply", interaction };
  const recordTool = relayOutcomeTools.find(({ name }) => name === "relay_record_action")!;
  const editTool = relayOutcomeTools.find(({ name }) => name === "relay_edit_recording")!;
  assert.equal(
    (recordTool.inputSchema as { shape?: Record<string, unknown> }).shape?.interaction,
    operationDefinition("authoring.session.interact").input.presentation.shape.interaction,
  );
  assert.equal(
    (editTool.inputSchema as { shape?: Record<string, unknown> }).shape?.edit,
    operationDefinition("authoring.take.edit").input.presentation.shape.edit,
  );

  const invocations: Invocation[] = [];
  const jobs = recordingJobs(invocations);
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_record_action",
    argumentsValue: { workflowId: "recording", expectedVersion: 2, interaction },
    confirmed: false,
    jobs,
  });
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_edit_recording",
    argumentsValue: { workflowId: "recording", expectedVersion: 3, edit },
    confirmed: false,
    jobs,
  });
  assert.deepEqual(invocations, [
    {
      method: "advanceRecording",
      argumentsValue: [
        { action: "record", workflowId: "recording", expectedVersion: 2, interaction },
      ],
    },
    {
      method: "editRecording",
      argumentsValue: [
        { kind: "edit-recording", workflowId: "recording", expectedVersion: 3, edit },
      ],
    },
  ]);
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_record_action",
      argumentsValue: {
        workflowId: "recording",
        expectedVersion: 4,
        interaction: { ...interaction, steps: "invalid" },
      },
      confirmed: false,
      jobs,
    }),
  );
  assert.equal(invocations.length, 2, "malformed check interactions never invoke the facade");
});

test("relay_goal exposes explicit reproduction and review-only promotion", async () => {
  const cases = [
    {
      argumentsValue: { reproduceSessionId: "goal-123" },
      method: "reproduceGoal" as const,
      expected: { kind: "goal-reproduce", sessionId: "goal-123" },
    },
    {
      argumentsValue: {
        promoteSessionId: "goal-123",
        appMapId: "checkout",
        title: "Empty cart regression",
      },
      method: "promoteGoal" as const,
      expected: {
        kind: "goal-promote",
        sessionId: "goal-123",
        appMapId: "checkout",
        title: "Empty cart regression",
        confirmControl: true,
      },
    },
  ];
  for (const testCase of cases) {
    const invocations: Invocation[] = [];
    const result = await invokeRelayOutcomeToolWithJobs({
      name: "relay_goal",
      argumentsValue: testCase.argumentsValue,
      confirmed: true,
      jobs: recordingJobs(invocations),
    });
    assert.deepEqual(result, { invoked: testCase.method });
    assert.deepEqual(invocations, [
      { method: testCase.method, argumentsValue: [testCase.expected] },
    ]);
  }
});

test("relay_goal exposes read-only inspection without control confirmation", async () => {
  const cases = [
    {
      argumentsValue: { inspectSessionId: "goal-123" },
      method: "inspectGoal" as const,
      expected: { kind: "goal-inspect", sessionId: "goal-123" },
    },
    {
      argumentsValue: { inspectExplorationId: "explore-123" },
      method: "inspectExploration" as const,
      expected: { kind: "goal-explore-inspect", explorationId: "explore-123" },
    },
  ];
  for (const testCase of cases) {
    const invocations: Invocation[] = [];
    const result = await invokeRelayOutcomeToolWithJobs({
      name: "relay_goal",
      argumentsValue: testCase.argumentsValue,
      confirmed: false,
      jobs: recordingJobs(invocations),
    });
    assert.deepEqual(result, { invoked: testCase.method });
    assert.deepEqual(invocations, [
      { method: testCase.method, argumentsValue: [testCase.expected] },
    ]);
  }
});

test("protected outcome tools reject missing confirmation before workflow dispatch", async () => {
  for (const testCase of [
    {
      name: "relay_record_test" as const,
      argumentsValue: { title: "Smoke" },
    },
    {
      name: "relay_approve_recording" as const,
      argumentsValue: { workflowId: "recording-workflow", expectedVersion: 1 },
    },
    {
      name: "relay_continue_repeat" as const,
      argumentsValue: { workflowId: "repeat-workflow", expectedVersion: 1 },
    },
    {
      name: "relay_goal" as const,
      argumentsValue: { startUrl: "https://example.test", goal: "Reach settings" },
    },
  ]) {
    const invocations: Invocation[] = [];
    await assert.rejects(
      invokeRelayOutcomeToolWithJobs({
        ...testCase,
        confirmed: false,
        jobs: recordingJobs(invocations),
      }),
      /requires confirm: true/u,
    );
    assert.deepEqual(invocations, []);
  }
});

test("Run risk consent comes only from transport confirmation and preserves two-call preflight", async () => {
  const invocations: Invocation[] = [];
  const jobs = {
    run: async (intent: { confirmRisk?: true }) => {
      invocations.push({ method: "run", argumentsValue: [intent] });
      return intent.confirmRisk
        ? { phase: "queued" }
        : {
            phase: "needs-input",
            problems: [{ code: "risk-confirmation-required" }],
          };
    },
  } as unknown as RelayOutcomeJobs;

  const preflight = await invokeRelayEverydayTool({
    name: "relay_run_test",
    argumentsValue: { appMapId: "checkout", testId: "send-message", wait: false },
    confirmed: false,
    invoker: unusedInvoker,
    jobs,
    signal: new AbortController().signal,
  });
  assert.deepEqual(preflight, {
    phase: "needs-input",
    problems: [{ code: "risk-confirmation-required" }],
  });
  assert.deepEqual(invocations, [
    {
      method: "run",
      argumentsValue: [{ kind: "run-test", appMapId: "checkout", testId: "send-message" }],
    },
  ]);

  const confirmed = await invokeRelayEverydayTool({
    name: "relay_run_test",
    argumentsValue: { appMapId: "checkout", testId: "send-message", wait: false },
    confirmed: true,
    invoker: unusedInvoker,
    jobs,
    signal: new AbortController().signal,
  });
  assert.deepEqual(confirmed, { phase: "queued" });
  assert.deepEqual(invocations[1], {
    method: "run",
    argumentsValue: [
      {
        kind: "run-test",
        appMapId: "checkout",
        testId: "send-message",
        confirmRisk: true,
      },
    ],
  });
});

test("Run and Repeat reject self-asserted confirmRisk before workflow dispatch", async () => {
  const runInvocations: Invocation[] = [];
  await assert.rejects(
    invokeRelayEverydayTool({
      name: "relay_run_test",
      argumentsValue: { testId: "send-message", confirmRisk: true },
      confirmed: false,
      invoker: unusedInvoker,
      jobs: recordingJobs(runInvocations),
      signal: new AbortController().signal,
    }),
  );
  assert.deepEqual(runInvocations, []);
  for (const testCase of [
    {
      name: "relay_repeat_test" as const,
      argumentsValue: {
        testId: "send-message",
        repeat: { dimensions: [{ id: "language", values: ["en"] }] },
        confirmRisk: true,
      },
    },
  ]) {
    const invocations: Invocation[] = [];
    await assert.rejects(
      invokeRelayOutcomeToolWithJobs({
        ...testCase,
        confirmed: false,
        jobs: recordingJobs(invocations),
      }),
    );
    assert.deepEqual(invocations, []);
  }
});

test("Repeat transport confirmation authorizes only the frozen pilot preflight", async () => {
  const invocations: Invocation[] = [];
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_repeat_test",
    argumentsValue: {
      testId: "locale",
      repeat: { dimensions: [{ id: "language", values: ["ja", "pt-BR"] }] },
    },
    confirmed: true,
    jobs: recordingJobs(invocations),
  });
  assert.deepEqual(invocations, [
    {
      method: "repeat",
      argumentsValue: [
        {
          kind: "repeat-test",
          testId: "locale",
          repeat: { dimensions: [{ id: "language", values: ["ja", "pt-BR"] }] },
          confirmRisk: true,
        },
      ],
    },
  ]);
});

test("outcome tool schemas reject adapter-only fields instead of leaking raw operations", async () => {
  const invocations: Invocation[] = [];
  await assert.rejects(
    invokeRelayEverydayTool({
      name: "relay_run_test",
      argumentsValue: { testId: "smoke", leaseId: "hidden-engine-detail" },
      confirmed: false,
      invoker: unusedInvoker,
      jobs: recordingJobs(invocations),
      signal: new AbortController().signal,
    }),
  );
  assert.deepEqual(invocations, []);
});

test("default outcome tool copy keeps engine nouns behind advanced profiles", () => {
  for (const descriptor of relayOutcomeTools) {
    assert.doesNotMatch(
      `${descriptor.title} ${descriptor.description}`,
      /\b(?:App Map|Take|Variable|Combine|campaign|lease|lens)\b/u,
      descriptor.name,
    );
  }
});

test("Replay Lab MCP accepts only bounded explicit payloads", async () => {
  const descriptor = relayOutcomeTools.find(({ name }) => name === "relay_replay_lab")!;
  assert.equal(descriptor.annotations.readOnlyHint, true);
  assert.equal(
    descriptor.inputSchema.safeParse({ analysis: "compare", tracePacks: [tracePack("a")] }).success,
    false,
  );
  const oversized = structuredClone(tracePack("b"));
  oversized.objects[0]!.bytes = 33 * 1024 * 1024;
  assert.equal(
    descriptor.inputSchema.safeParse({
      analysis: "all",
      tracePacks: [tracePack("a"), oversized],
    }).success,
    true,
    "declared object bytes do not replace actual transport measurement",
  );
  const falselySmall = structuredClone(tracePack("c"));
  falselySmall.objects[0]!.content = { payload: "x".repeat(32 * 1024 * 1024) };
  falselySmall.objects[0]!.bytes = 1;
  assert.equal(
    descriptor.inputSchema.safeParse({
      analysis: "compare",
      tracePacks: [tracePack("a"), falselySmall],
    }).success,
    false,
    "actual JSON payload size must win over the declared object byte count",
  );
  let deeplyNested: unknown = "leaf";
  for (let index = 0; index < 10_000; index += 1) deeplyNested = { child: deeplyNested };
  const deepPack = structuredClone(tracePack("d"));
  (deepPack.objects[0] as { content: unknown }).content = deeplyNested;
  assert.equal(
    descriptor.inputSchema.safeParse({
      analysis: "compare",
      tracePacks: [tracePack("a"), deepPack],
    }).success,
    false,
    "deep JSON must fail before offline analysis",
  );
  const invocations: Invocation[] = [];
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_replay_lab",
      argumentsValue: { analysis: "compare", tracePacks: [tracePack("a"), deepPack] },
      confirmed: false,
      jobs: recordingJobs(invocations),
    }),
    /depth/u,
  );
  assert.deepEqual(invocations, []);
});
