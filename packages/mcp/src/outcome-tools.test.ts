import type { RelayOutcomeJobs } from "@relay/workflows";
import assert from "node:assert/strict";
import test from "node:test";
import {
  invokeRelayOutcomeToolWithJobs,
  relayOutcomeTools,
  type RelayOutcomeToolDescriptor,
} from "./outcome-tools.js";

type Invocation = { method: keyof RelayOutcomeJobs; argumentsValue: unknown[] };

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
      argumentsValue: { appMapId: "checkout", testId: "smoke", targetId: "pixel-9" },
      method: "run",
      expected: {
        kind: "run-test",
        appMapId: "checkout",
        testId: "smoke",
        targetId: "pixel-9",
      },
    },
    {
      name: "relay_record_action",
      argumentsValue: {
        ref: "recording-ref",
        expectedVersion: "v1",
        interaction: { kind: "tap", target: { label: "Settings" } },
      },
      method: "advanceRecording",
      expected: {
        action: "record",
        ref: "recording-ref",
        expectedVersion: "v1",
        interaction: { kind: "tap", target: { label: "Settings" } },
      },
    },
    {
      name: "relay_add_checkpoint",
      argumentsValue: { ref: "recording-ref", expectedVersion: "v2", label: "Settings" },
      method: "advanceRecording",
      expected: {
        action: "checkpoint",
        ref: "recording-ref",
        expectedVersion: "v2",
        label: "Settings",
      },
    },
    {
      name: "relay_stop_recording",
      argumentsValue: { ref: "recording-ref", expectedVersion: "v3" },
      method: "advanceRecording",
      expected: { action: "stop", ref: "recording-ref", expectedVersion: "v3" },
    },
    {
      name: "relay_edit_recording",
      argumentsValue: {
        ref: "recording-ref",
        expectedVersion: "v4",
        edit: {
          kind: "merge",
          actionIds: ["tap-menu", "tap-settings"],
          intent: "Open Settings",
        },
      },
      method: "editRecording",
      expected: {
        kind: "edit-recording",
        ref: "recording-ref",
        expectedVersion: "v4",
        edit: {
          kind: "merge",
          actionIds: ["tap-menu", "tap-settings"],
          intent: "Open Settings",
        },
      },
    },
    {
      name: "relay_replay_recording",
      argumentsValue: { ref: "recording-ref", expectedVersion: "v4" },
      method: "advanceRecording",
      expected: { action: "replay", ref: "recording-ref", expectedVersion: "v4" },
    },
    {
      name: "relay_approve_recording",
      argumentsValue: { ref: "recording-ref", expectedVersion: "v5" },
      confirmed: true,
      method: "advanceRecording",
      expected: { action: "approve", ref: "recording-ref", expectedVersion: "v5" },
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
      argumentsValue: { ref: "workflow-ref" },
      method: "inspect",
      expected: "workflow-ref",
    },
    {
      name: "relay_continue_repeat",
      argumentsValue: { ref: "repeat-ref", expectedVersion: "v2" },
      confirmed: true,
      method: "continueRepeat",
      expected: {
        ref: "repeat-ref",
        expectedVersion: "v2",
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

test("protected outcome tools reject missing confirmation before workflow dispatch", async () => {
  for (const testCase of [
    {
      name: "relay_record_test" as const,
      argumentsValue: { title: "Smoke" },
    },
    {
      name: "relay_approve_recording" as const,
      argumentsValue: { ref: "recording-ref", expectedVersion: "v1" },
    },
    {
      name: "relay_continue_repeat" as const,
      argumentsValue: { ref: "repeat-ref", expectedVersion: "v1" },
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
