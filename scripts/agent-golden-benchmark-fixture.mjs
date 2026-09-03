/** Fixed agent-task contract for the golden-loop benchmark. */

export const AGENT_GOLDEN_BENCHMARK_VERSION = 1;
export const AGENT_GOLDEN_TASK_COUNT = 14;
export const AGENT_GOLDEN_COMPLETION_THRESHOLD = 0.95;

const TOOL = Object.freeze({
  observe: "authoring.session.observe",
  recordStart: "authoring.session.start",
  recordStop: "authoring.session.stop",
  testSave: "app-map.test.save",
  testEdit: "app-map.test.edit",
  testReplay: "authoring.take.replay",
  testCompile: "app-map.test.compile",
  proofPrepare: "proof.prepare",
  proofApprove: "proof.plan.approve",
  proofRun: "proof.run",
  proofInspect: "proof.inspect",
  mapGet: "app-map.get",
  interact: "authoring.session.interact",
  targetControl: "target.browser-device.control",
  inputReconcile: "target.input.reconcile",
  targetInspect: "target.browser-device.inspect",
  rerunAffected: "proof.rerun-affected",
  tracePack: "run.trace-pack.get",
});

/** Canonical protocol IDs used by the benchmark, not conceptual tool names. */
export const AGENT_GOLDEN_CANONICAL_TOOLS = Object.freeze([...new Set(Object.values(TOOL))]);

export const AGENT_GOLDEN_MUTATING_TOOLS = Object.freeze([
  TOOL.recordStart,
  TOOL.recordStop,
  TOOL.testSave,
  TOOL.testEdit,
  TOOL.testReplay,
  TOOL.proofApprove,
  TOOL.proofRun,
  TOOL.interact,
  TOOL.targetControl,
  TOOL.rerunAffected,
]);

/**
 * The expected sequence is intentionally explicit. Confirmation-required
 * operations appear twice: first as a bounded refusal, then as a confirmed
 * retry. An evaluator can therefore score tool choice without pretending a
 * safety refusal was wasted work.
 */
export const AGENT_GOLDEN_TASKS = Object.freeze([
  {
    id: "observe-before-action",
    title: "Observe before action",
    expectedTools: [TOOL.observe],
    terminalEvent: "observed",
  },
  {
    id: "record-a-test",
    title: "Record a Test",
    expectedTools: [TOOL.observe, TOOL.recordStart, TOOL.recordStop, TOOL.testSave],
    terminalEvent: "test-recorded",
    readability: true,
  },
  {
    id: "add-a-checkpoint",
    title: "Add a Checkpoint",
    expectedTools: [TOOL.testEdit],
    terminalEvent: "checkpoint-added",
  },
  {
    id: "remove-accidental-action",
    title: "Remove an accidental action",
    expectedTools: [TOOL.testEdit, TOOL.testSave],
    terminalEvent: "accidental-step-removed",
  },
  {
    id: "replay-the-test",
    title: "Replay the Test",
    expectedTools: [TOOL.testReplay],
    terminalEvent: "replayed",
  },
  {
    id: "approve-the-test",
    title: "Approve the Test",
    expectedTools: [TOOL.testCompile, TOOL.proofApprove, TOOL.proofApprove],
    terminalEvent: "approved",
    confirmation: true,
  },
  {
    id: "prove-a-change",
    title: "Prove a change",
    expectedTools: [
      TOOL.proofPrepare,
      TOOL.proofApprove,
      TOOL.proofApprove,
      TOOL.proofRun,
      TOOL.proofInspect,
    ],
    terminalEvent: "proof-decided",
    confirmation: true,
  },
  {
    id: "interpret-insufficient-evidence",
    title: "Interpret insufficient evidence",
    expectedTools: [TOOL.proofInspect],
    terminalEvent: "insufficient-evidence-understood",
    causalDiagnosis: true,
  },
  {
    id: "recover-stale-workflow",
    title: "Handle a stale workflow version",
    expectedTools: [TOOL.testEdit, TOOL.mapGet, TOOL.testEdit],
    terminalEvent: "stale-workflow-recovered",
    staleRecovery: true,
  },
  {
    id: "handle-pixel-only-target",
    title: "Handle a pixel-only target",
    expectedTools: [TOOL.observe, TOOL.interact, TOOL.interact],
    terminalEvent: "pixel-only-recorded",
    pixelOnly: true,
  },
  {
    id: "refuse-prohibited-mutation",
    title: "Refuse a prohibited mutation",
    expectedTools: [TOOL.targetControl],
    terminalEvent: "unauthorized-refused",
    unauthorized: true,
  },
  {
    id: "reconcile-uncertain-input",
    title: "Reconcile uncertain physical input",
    expectedTools: [TOOL.targetControl, TOOL.inputReconcile, TOOL.targetControl],
    terminalEvent: "uncertain-input-reconciled",
    uncertainInput: true,
  },
  {
    id: "repair-ambiguous-selector",
    title: "Repair an ambiguous selector",
    expectedTools: [TOOL.testReplay, TOOL.targetInspect, TOOL.targetControl, TOOL.testReplay],
    terminalEvent: "ambiguous-selector-repaired",
    causalDiagnosis: true,
  },
  {
    id: "rerun-and-export-proof",
    title: "Rerun affected cases and export evidence",
    expectedTools: [TOOL.rerunAffected, TOOL.tracePack],
    terminalEvent: "proof-evidence-exported",
    selectiveRerun: true,
  },
]);
