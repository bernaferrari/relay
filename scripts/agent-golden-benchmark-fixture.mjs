/** Fixed agent-task contract for the golden-loop benchmark. */

export const AGENT_GOLDEN_BENCHMARK_VERSION = 2;
export const AGENT_GOLDEN_TASK_COUNT = 30;
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
  targetList: "target.devices.list",
  targetPreflight: "target.preflight",
  snapshotCapture: "target.snapshot.capture",
  observationCapture: "target.observation.capture",
  runReview: "run.review",
  runEvidence: "run.evidence.get",
  jobPause: "job.pause",
  jobResume: "job.resume",
  jobRetry: "job.retry",
  offlineReplay: "run.replay.offline",
  doctor: "system.doctor.get",
  activityList: "activity.list",
  activityExport: "activity.export",
  mapList: "app-map.list",
  mapExport: "app-map.export",
  repairPropose: "run.repair.propose",
  repairRetry: "run.repair.retry",
  shareCreate: "run.share.create",
  shareList: "run.share.list",
  shareRevoke: "run.share.revoke",
  visualCompare: "run.visual.compare",
  visualReview: "run.visual.review",
  jobCancel: "job.cancel",
  targetHealth: "target.health.get",
  targetRecover: "target.recover",
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
  {
    id: "discover-and-preflight-target",
    title: "Discover and preflight a target",
    expectedTools: [TOOL.targetList, TOOL.targetPreflight],
    terminalEvent: "target-preflighted",
  },
  {
    id: "capture-observation-evidence",
    title: "Capture observation evidence",
    expectedTools: [TOOL.snapshotCapture, TOOL.observationCapture],
    terminalEvent: "observation-evidence-captured",
  },
  {
    id: "review-capture-results",
    title: "Review capture results",
    expectedTools: [TOOL.runReview],
    terminalEvent: "capture-review-ready",
  },
  {
    id: "inspect-run-evidence",
    title: "Inspect run evidence",
    expectedTools: [TOOL.runEvidence],
    terminalEvent: "run-evidence-inspected",
  },
  {
    id: "pause-and-resume-a-run",
    title: "Pause and resume a run",
    expectedTools: [TOOL.jobPause, TOOL.jobResume],
    terminalEvent: "run-resumed",
  },
  {
    id: "retry-a-failed-run",
    title: "Retry a failed run",
    expectedTools: [TOOL.jobRetry],
    terminalEvent: "run-retried",
  },
  {
    id: "replay-offline-evidence",
    title: "Replay evidence offline",
    expectedTools: [TOOL.offlineReplay],
    terminalEvent: "offline-replay-complete",
  },
  {
    id: "inspect-system-doctor",
    title: "Inspect system readiness",
    expectedTools: [TOOL.doctor],
    terminalEvent: "system-readiness-inspected",
  },
  {
    id: "export-activity-history",
    title: "Export activity history",
    expectedTools: [TOOL.activityList, TOOL.activityExport],
    terminalEvent: "activity-exported",
  },
  {
    id: "export-app-map",
    title: "Export an App Map",
    expectedTools: [TOOL.mapList, TOOL.mapExport],
    terminalEvent: "app-map-exported",
  },
  {
    id: "propose-and-retry-repair",
    title: "Propose and retry a repair",
    expectedTools: [TOOL.repairPropose, TOOL.repairRetry],
    terminalEvent: "repair-retried",
  },
  {
    id: "share-and-revoke-evidence",
    title: "Share and revoke evidence",
    expectedTools: [TOOL.shareCreate, TOOL.shareList, TOOL.shareRevoke],
    terminalEvent: "evidence-share-revoked",
  },
  {
    id: "compare-and-review-visual-evidence",
    title: "Compare and review visual evidence",
    expectedTools: [TOOL.visualCompare, TOOL.visualReview],
    terminalEvent: "visual-review-recorded",
  },
  {
    id: "run-without-a-provider",
    title: "Run a provider-independent proof",
    expectedTools: [TOOL.proofPrepare, TOOL.proofRun, TOOL.runEvidence],
    terminalEvent: "provider-independent-proof-complete",
  },
  {
    id: "cancel-a-stale-run",
    title: "Cancel a stale run",
    expectedTools: [TOOL.jobCancel],
    terminalEvent: "stale-run-cancelled",
  },
  {
    id: "recover-an-unhealthy-target",
    title: "Recover an unhealthy target",
    expectedTools: [TOOL.targetHealth, TOOL.targetRecover],
    terminalEvent: "target-recovered",
  },
]);
