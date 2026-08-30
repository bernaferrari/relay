import {
  changeMergeBaseSha,
  changeTestedSha,
  type ChangeProofDecision,
  type ChangeVerification,
} from "@relay/protocol";
import {
  CHANGE_PROOF_GOLDEN_DEMO,
  runChangeProofGoldenDemo,
  type ChangeProofGoldenDemoResult,
} from "./change-proof-golden-demo.js";

/** A clock supplied by the caller so benchmark output never depends on wall time. */
export type ChangeProofGoldenHarnessClock = Readonly<{
  now: () => number;
}>;

export type ChangeProofGoldenHarnessStep = Readonly<{
  id:
    | "bind-change"
    | "select-journey"
    | "run-pilot"
    | "detect-regression"
    | "return-repair-packet"
    | "supersede-proof"
    | "rerun-repaired-head"
    | "clear-merge";
  title: string;
  outcome: "passed" | "failed" | "not-measured";
  detail: string;
  evidence: readonly string[];
}>;

export type ChangeProofGoldenHarnessCheck = Readonly<{
  id: string;
  question: string;
  expectedAnswer: string;
  /** Human or agent responses are deliberately not invented by this fixture. */
  answer: null;
  status: "not-measured";
}>;

export type ChangeProofGoldenHarnessReport = Readonly<{
  schemaVersion: 1;
  kind: "change-proof-golden-harness";
  benchmark: Readonly<{
    status: "fixture-only";
    timing: Readonly<{
      clock: "injected";
      scope: "runChangeProofGoldenDemo";
      startedAt: number;
      finishedAt: number;
      durationMs: number;
    }>;
    oldHead: Readonly<{
      decision: ChangeProofDecision["decision"];
      executedCaseIds: readonly string[];
      requiredCaseCount: number;
    }>;
    repairedHead: Readonly<{
      decision: ChangeProofDecision["decision"];
      executedCaseIds: readonly string[];
      requiredCaseCount: number;
    }>;
    reusedCaseIds: readonly string[];
  }>;
  scenario: Readonly<{
    repository: string;
    baseSha: string;
    failedHeadSha: string;
    repairedHeadSha: string;
    journey: Readonly<{ appMapId: string; testId: string }>;
    targetCaseIds: readonly string[];
  }>;
  steps: readonly ChangeProofGoldenHarnessStep[];
  checks: readonly ChangeProofGoldenHarnessCheck[];
  limitations: Readonly<{
    unsupported: readonly Readonly<{ field: string; reason: string }>[];
    unmeasured: readonly Readonly<{ field: string; reason: string }>[];
  }>;
  /** The complete fixture result is retained for callers that need evidence. */
  demo: ChangeProofGoldenDemoResult;
}>;

function requiredCaseCount(proof: ChangeVerification): number {
  // The durable Proof owns the frozen execution cells. Never reconstruct a
  // journey × target product here: a cell also pins the exact build and
  // cleanup obligation used by the live decision.
  return proof.selection.cells?.length ?? 0;
}

function sha(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function exactHeadEvidence(proof: ChangeVerification): string[] {
  return [
    `base=${sha(changeMergeBaseSha(proof.change))}`,
    `tested=${sha(changeTestedSha(proof.change))}`,
    ...proof.builds.map(
      ({ id, sourceSha, artifactDigest }) =>
        `${id}: source=${sha(sourceSha)} artifact=${artifactDigest.slice(0, 15)}…`,
    ),
  ];
}

function stepsFor(demo: ChangeProofGoldenDemoResult): ChangeProofGoldenHarnessStep[] {
  const firstFailure = demo.oldDecision.firstCausalFailure;
  const journey = demo.oldProof.selection.affectedJourneys[0];
  const selected = Boolean(
    journey &&
    journey.appMapId === CHANGE_PROOF_GOLDEN_DEMO.appMapId &&
    journey.testId === CHANGE_PROOF_GOLDEN_DEMO.testId,
  );
  const oldStoppedAtFailure =
    firstFailure?.targetCaseId === "web-chromium-compact-ar" &&
    demo.initialExecutedCaseIds.length === 2;
  const completeRepair =
    demo.repairedDecision.decision === "proved" &&
    demo.repairedExecutedCaseIds.length === requiredCaseCount(demo.repairedProof);
  return [
    {
      id: "bind-change",
      title: "Bind the exact change and builds",
      outcome:
        changeMergeBaseSha(demo.oldProof.change) === CHANGE_PROOF_GOLDEN_DEMO.baseSha &&
        changeTestedSha(demo.oldProof.change) === CHANGE_PROOF_GOLDEN_DEMO.failedHeadSha &&
        demo.oldProof.builds.every(
          ({ sourceSha }) => sourceSha === changeTestedSha(demo.oldProof.change),
        )
          ? "passed"
          : "failed",
      detail: "The old Proof freezes base/head SHA and build source revisions before execution.",
      evidence: exactHeadEvidence(demo.oldProof),
    },
    {
      id: "select-journey",
      title: "Select the affected user journey",
      outcome: selected ? "passed" : "failed",
      detail: "The reviewed Settings language association selects one explainable journey.",
      evidence: selected
        ? [`${journey!.appMapId}/${journey!.testId}`, "classification=definitely-affected"]
        : [],
    },
    {
      id: "run-pilot",
      title: "Run the representative pilot",
      outcome: demo.initialExecutedCaseIds[0] === "android-pixel-9-ar" ? "passed" : "failed",
      detail:
        "The old head runs Android first, then the compact web case required to expose the seeded regression.",
      evidence: demo.initialExecutedCaseIds,
    },
    {
      id: "detect-regression",
      title: "Detect and block the regression",
      outcome:
        demo.oldDecision.decision === "rejected" && oldStoppedAtFailure ? "passed" : "failed",
      detail:
        firstFailure?.summary ??
        "The fixture did not produce the expected first causal compact-web failure.",
      evidence: firstFailure?.evidenceRefs ?? [],
    },
    {
      id: "return-repair-packet",
      title: "Return bounded causal repair evidence",
      outcome: demo.repairPacket.runId === firstFailure?.runId ? "passed" : "failed",
      detail: "The repair packet is scoped to the first causal Run and its evidence.",
      evidence: [...demo.repairPacket.evidenceRefs, ...demo.repairPacket.suggestedScope],
    },
    {
      id: "supersede-proof",
      title: "Create a new Proof for the repaired head",
      outcome:
        changeTestedSha(demo.oldProof.change) !== changeTestedSha(demo.repairedProof.change) &&
        changeMergeBaseSha(demo.repairedProof.change) === changeTestedSha(demo.oldProof.change)
          ? "passed"
          : "failed",
      detail:
        "The repaired head is immutable and based on the rejected head; the old Proof is not mutated.",
      evidence: exactHeadEvidence(demo.repairedProof),
    },
    {
      id: "rerun-repaired-head",
      title: "Rerun the repaired head",
      outcome: completeRepair && demo.reusedCaseIds.length === 0 ? "passed" : "failed",
      detail:
        "All required repaired-head cases use the new build identity. Cross-head evidence reuse is intentionally empty.",
      evidence: demo.repairedExecutedCaseIds,
    },
    {
      id: "clear-merge",
      title: "Produce the deterministic merge decision",
      outcome: demo.repairedDecision.decision === "proved" ? "passed" : "failed",
      detail:
        "The repaired Proof clears only after complete required evidence and exact-head checks.",
      evidence: [
        `old=${demo.oldDecision.decision}`,
        `repaired=${demo.repairedDecision.decision}`,
        `reused=${demo.reusedCaseIds.length}`,
      ],
    },
  ];
}

function comprehensionChecks(): ChangeProofGoldenHarnessCheck[] {
  return [
    {
      id: "explain-selection",
      question: "Why did Relay select the Settings language journey?",
      expectedAnswer:
        "The reviewed source association matches the changed Settings language resource and layout.",
      answer: null,
      status: "not-measured",
    },
    {
      id: "explain-block",
      question: "Why was the old head blocked?",
      expectedAnswer:
        "The compact Arabic web case found a 22px RTL overlap, so the old Proof was rejected.",
      answer: null,
      status: "not-measured",
    },
    {
      id: "explain-repair",
      question: "What evidence may be reused on the repaired head?",
      expectedAnswer:
        "None across heads unless a future policy explicitly proves it; this fixture reuses zero cases.",
      answer: null,
      status: "not-measured",
    },
    {
      id: "explain-coverage",
      question: "Does this fixture prove physical Android, iOS, or GitHub integration?",
      expectedAnswer:
        "No; it is a device-free core fixture and does not measure those integrations.",
      answer: null,
      status: "not-measured",
    },
  ];
}

const UNSUPPORTED = [
  {
    field: "physical-target-health",
    reason:
      "The fixture uses persisted Run documents and contacts no Android, iOS, or browser target.",
  },
  {
    field: "github-check-publication",
    reason: "The harness verifies the provider projection locally; it does not call GitHub.",
  },
] as const;

const UNMEASURED = [
  {
    field: "agent-comprehension",
    reason:
      "Questions are recorded with expected answers, but no participant or agent response is supplied.",
  },
  {
    field: "human-time-to-first-proof",
    reason: "No human authoring session is driven by the device-free fixture.",
  },
  {
    field: "runtime-latency",
    reason:
      "The injected clock measures the golden-demo call boundary, not device or browser latency.",
  },
  {
    field: "cross-head-evidence-reuse",
    reason:
      "The demo intentionally reports an empty reuse set; a selective reuse policy is not implemented here.",
  },
] as const;

/**
 * Produce a benchmark/usability report from the real golden Proof execution.
 * The clock only surrounds `runChangeProofGoldenDemo`; no scenario timing is
 * fabricated, and comprehension remains explicitly unmeasured.
 */
export async function runChangeProofGoldenHarness(input: {
  clock: ChangeProofGoldenHarnessClock;
}): Promise<ChangeProofGoldenHarnessReport> {
  const startedAt = input.clock.now();
  const demo = await runChangeProofGoldenDemo();
  const finishedAt = input.clock.now();
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    throw new Error("Golden harness clock must return finite, monotonic timestamps");
  }
  return {
    schemaVersion: 1,
    kind: "change-proof-golden-harness",
    benchmark: {
      status: "fixture-only",
      timing: {
        clock: "injected",
        scope: "runChangeProofGoldenDemo",
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
      },
      oldHead: {
        decision: demo.oldDecision.decision,
        executedCaseIds: demo.initialExecutedCaseIds,
        requiredCaseCount: requiredCaseCount(demo.oldProof),
      },
      repairedHead: {
        decision: demo.repairedDecision.decision,
        executedCaseIds: demo.repairedExecutedCaseIds,
        requiredCaseCount: requiredCaseCount(demo.repairedProof),
      },
      reusedCaseIds: demo.reusedCaseIds,
    },
    scenario: {
      repository: demo.oldProof.change.repository,
      baseSha: changeMergeBaseSha(demo.oldProof.change),
      failedHeadSha: changeTestedSha(demo.oldProof.change),
      repairedHeadSha: changeTestedSha(demo.repairedProof.change),
      journey: {
        appMapId: CHANGE_PROOF_GOLDEN_DEMO.appMapId,
        testId: CHANGE_PROOF_GOLDEN_DEMO.testId,
      },
      targetCaseIds: demo.repairedProof.selection.targetCases.map(({ id }) => id),
    },
    steps: stepsFor(demo),
    checks: comprehensionChecks(),
    limitations: { unsupported: UNSUPPORTED, unmeasured: UNMEASURED },
    demo,
  };
}
