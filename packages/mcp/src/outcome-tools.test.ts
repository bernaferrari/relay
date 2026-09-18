import type { RelayOutcomeJobs } from "@relay/workflows";
import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeRelayOutcomeToolWithJobs,
  relayOutcomeTools,
  type RelayOutcomeToolDescriptor,
} from "./outcome-tools.js";

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
      name: "relay_run_test",
      argumentsValue: {
        appMapId: "checkout",
        testId: "smoke",
        targetId: "pixel-9",
      },
      confirmed: true,
      method: "run",
      expected: {
        kind: "run-test",
        appMapId: "checkout",
        testId: "smoke",
        targetId: "pixel-9",
        confirmRisk: true,
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
      name: "relay_inspect_failure",
      argumentsValue: { runId: "run-1" },
      method: "inspectFailure",
      expected: { kind: "inspect-failure", runId: "run-1" },
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
      name: "relay_debug_bug",
      argumentsValue: {
        kind: "debug-bug",
        action: "start",
        title: "Checkout failure",
        targetId: "pixel-9",
      },
      confirmed: true,
      method: "debugBug",
      expected: {
        kind: "debug-bug",
        action: "start",
        title: "Checkout failure",
        targetId: "pixel-9",
        confirmControl: true,
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
      name: "relay_proof_analyze",
      argumentsValue: {
        selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
      },
      method: "verifyChange",
      expected: {
        kind: "verify-change",
        selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
      },
    },
    {
      name: "relay_verify_change",
      argumentsValue: {
        selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
      },
      method: "verifyChange",
      expected: {
        kind: "verify-change",
        selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
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

test("Agent Debug title uses the same 160 character limit as the product UI", () => {
  const descriptor = relayOutcomeTools.find(({ name }) => name === "relay_debug_bug");
  assert.ok(descriptor);
  assert.equal(
    descriptor.inputSchema.safeParse({
      kind: "debug-bug",
      action: "start",
      title: "a".repeat(160),
    }).success,
    true,
  );
  assert.equal(
    descriptor.inputSchema.safeParse({
      kind: "debug-bug",
      action: "start",
      title: "a".repeat(161),
    }).success,
    false,
  );
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
      name: "relay_debug_bug" as const,
      argumentsValue: {
        kind: "debug-bug",
        action: "start",
        title: "Smoke",
      },
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

test("Agent Debug exploration requires transport confirmation only when it controls a target", async () => {
  const invocations: Invocation[] = [];
  const create = {
    kind: "debug-bug",
    action: "explore",
    create: {
      id: "discovery-1",
      name: "Checkout discovery",
      targetId: "pixel-9",
      scope: { maxScreens: 20, maxTransitions: 40, maxDurationMs: 30_000 },
    },
  } as const;
  await invokeRelayOutcomeToolWithJobs({
    name: "relay_debug_bug",
    argumentsValue: create,
    confirmed: false,
    jobs: recordingJobs(invocations),
  });
  assert.deepEqual(invocations, [{ method: "debugBug", argumentsValue: [create] }]);

  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_debug_bug",
      argumentsValue: {
        ...create,
        start: { sessionId: "discovery-1", strategy: "surface", maxDepth: 2 },
      },
      confirmed: false,
      jobs: recordingJobs([]),
    }),
    /requires confirm: true/u,
  );
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

  const preflight = await invokeRelayOutcomeToolWithJobs({
    name: "relay_run_test",
    argumentsValue: { appMapId: "checkout", testId: "send-message" },
    confirmed: false,
    jobs,
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

  const confirmed = await invokeRelayOutcomeToolWithJobs({
    name: "relay_run_test",
    argumentsValue: { appMapId: "checkout", testId: "send-message" },
    confirmed: true,
    jobs,
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
  for (const testCase of [
    {
      name: "relay_run_test" as const,
      argumentsValue: { testId: "send-message", confirmRisk: true },
    },
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
    invokeRelayOutcomeToolWithJobs({
      name: "relay_run_test",
      argumentsValue: { testId: "smoke", leaseId: "hidden-engine-detail" },
      confirmed: false,
      jobs: recordingJobs(invocations),
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

test("verify-change is a read-only fail-closed tool with no provider posting fields", () => {
  const descriptor = relayOutcomeTools.find(({ name }) => name === "relay_verify_change")!;
  assert.equal(descriptor.annotations.readOnlyHint, true);
  assert.equal(descriptor.requiresConfirmation, false);
  assert.equal(
    descriptor.inputSchema.safeParse({
      selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
      github: { checkPosting: true },
    }).success,
    false,
  );
});

test("verify-change returns the canonical bounded decision projection unchanged", async () => {
  const projection = {
    schemaVersion: 1,
    kind: "verify-change",
    mode: "offline",
    summary: {
      verdict: "insufficient",
      affectedTests: 1,
      passed: 0,
      regressions: 0,
      review: 0,
      insufficient: 1,
    },
    policy: { id: "relay.verify-change", version: 1 },
    ruleIds: ["evidence.incomplete"],
    evidenceCompleteness: {
      status: "partial",
      complete: 0,
      partial: 1,
      missing: ["trace-pack:map-1:test-1"],
    },
    unresolvedUncertainty: ["missing:trace-pack:map-1:test-1"],
    smallestRequiredLiveVerification: {
      required: true,
      action: "run-one-affected-test",
      reason: "One affected Test needs complete fresh evidence before policy can decide.",
      testId: "test-1",
      evidenceNeeded: ["trace-pack:map-1:test-1"],
    },
    mutation: "none",
    checkPosting: "none",
  } as const;
  const jobs = {
    ...recordingJobs([]),
    verifyChange: async () => projection,
  } as unknown as RelayOutcomeJobs;

  const returned = await invokeRelayOutcomeToolWithJobs({
    name: "relay_verify_change",
    argumentsValue: { selection: { kind: "runs", runIds: ["run-1"] } },
    confirmed: false,
    jobs,
  });

  assert.strictEqual(returned, projection);
  assert.equal(projection.checkPosting, "none");
  assert.equal("tracePacks" in projection, false);
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

test("verify-change bounds ids and supplied TracePacks before invoking the façade", async () => {
  const invocations: Invocation[] = [];
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_verify_change",
      argumentsValue: {
        selection: {
          kind: "runs",
          runIds: Array.from({ length: 129 }, (_, index) => `run-${index}`),
        },
      },
      confirmed: false,
      jobs: recordingJobs(invocations),
    }),
    /128/u,
  );
  assert.deepEqual(invocations, []);

  const falselySmall = structuredClone(tracePack("e"));
  falselySmall.objects[0]!.content = { payload: "x".repeat(32 * 1024 * 1024) };
  falselySmall.objects[0]!.bytes = 1;
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_verify_change",
      argumentsValue: {
        selection: { kind: "trace-packs", tracePacks: [falselySmall] },
      },
      confirmed: false,
      jobs: recordingJobs(invocations),
    }),
    /string|serialized bytes/u,
  );
  assert.deepEqual(invocations, []);

  const tooManyObjects = structuredClone(tracePack("f"));
  tooManyObjects.objects = Array.from({ length: 2_001 }, (_, index) => ({
    ...tooManyObjects.objects[0]!,
    path: index === 0 ? "run.json" : `artifacts/${index}.json`,
    content: {},
  }));
  await assert.rejects(
    invokeRelayOutcomeToolWithJobs({
      name: "relay_verify_change",
      argumentsValue: {
        selection: { kind: "trace-packs", tracePacks: [tooManyObjects] },
      },
      confirmed: false,
      jobs: recordingJobs(invocations),
    }),
    /2000 objects/u,
  );
  assert.deepEqual(invocations, []);
});
