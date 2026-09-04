import {
  agentRepairPacketSchema,
  changeProofCaseResultSchema,
  changeProofDecisionSchema,
  changeProofProviderCheckSchema,
  executionRiskSchema,
  parseChangeVerification,
  changeTestedSha,
  type ExecutionRisk,
  type AgentRepairPacket,
  type ChangeProofCaseResult,
  type ChangeProofDecision,
  type ChangeProofProviderCheck,
  type ChangeVerification,
} from "@relay/protocol";
import {
  advanceChangeVerification,
  readChangeVerification,
  type ChangeVerificationScope,
} from "./change-verification-store.js";
import {
  verifyChangeDecisionDigest,
  verifyChangePlanDigest,
  verifyChangePolicyDigest,
  verifyDurableChangeVerification,
  materializeChangeVerificationIntegrity,
} from "./change-proof-integrity.js";
import { evaluateChangeDecisionPolicy } from "./change-decision-policy.js";
import { canonicalSha256 } from "./canonical-json.js";

function legacyIdentityKey(value: {
  appMapId: string;
  testId: string;
  targetCaseId: string;
}): string {
  return `${value.appMapId}\0${value.testId}\0${value.targetCaseId}`;
}

function cellForResult(
  proof: ChangeVerification,
  result: ChangeProofCaseResult,
): NonNullable<ChangeVerification["selection"]["cells"]>[number] {
  const cells = proof.selection.cells ?? [];
  const matching = result.cellId
    ? cells.filter(({ id }) => id === result.cellId)
    : cells.filter(
        (cell) =>
          cell.journey.appMapId === result.appMapId &&
          cell.journey.testId === result.testId &&
          cell.targetCaseId === result.targetCaseId,
      );
  if (matching.length !== 1) {
    throw new Error(
      `Run ${result.runId} must identify exactly one frozen Verification Cell; found ${matching.length}`,
    );
  }
  const cell = matching[0]!;
  if (
    cell.journey.appMapId !== result.appMapId ||
    cell.journey.testId !== result.testId ||
    cell.targetCaseId !== result.targetCaseId
  ) {
    throw new Error(`Run ${result.runId} identity disagrees with Verification Cell ${cell.id}`);
  }
  return cell;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function bounded(values: readonly string[], limit = 128): string[] {
  const result = unique(values);
  if (result.length <= limit) return result;
  return [...result.slice(0, limit - 1), `Additional items omitted: ${result.length - limit + 1}`];
}

const INFRASTRUCTURE_GAP_PREFIX = "Infrastructure failure in Run ";

type FrozenVerificationCell = NonNullable<ChangeVerification["selection"]["cells"]>[number];

const RISK_RANK: Record<ExecutionRisk["level"], number> = {
  safe: 0,
  guarded: 1,
  destructive: 2,
  prohibited: 3,
};

const CONFIRMATION_RANK: Record<ExecutionRisk["confirmation"], number> = {
  none: 0,
  "once-per-run": 1,
  "per-step": 2,
  "human-only": 3,
};

/** Read the immutable risk authority from the Proof cells. Missing or forged
 * authority is a review condition, never permission to use a safe default. */
function aggregateCellExecutionRisk(cells: readonly FrozenVerificationCell[]): {
  risk?: ExecutionRisk;
  invalidCellIds: string[];
} {
  const invalidCellIds: string[] = [];
  const values: ExecutionRisk[] = [];
  for (const cell of cells) {
    if (!cell.executionRisk || !cell.executionRiskDigest || !cell.evidencePolicyDigest) {
      invalidCellIds.push(cell.id);
      continue;
    }
    try {
      const risk = executionRiskSchema.parse(cell.executionRisk);
      if (
        canonicalSha256(risk) !== cell.executionRiskDigest ||
        risk.cleanupRequired !== cell.cleanupRequired
      ) {
        invalidCellIds.push(cell.id);
        continue;
      }
      values.push(risk);
    } catch {
      invalidCellIds.push(cell.id);
    }
  }
  if (invalidCellIds.length || !values.length) return { invalidCellIds };
  const level = values.reduce(
    (current, risk) => (RISK_RANK[risk.level] > RISK_RANK[current] ? risk.level : current),
    "safe" as ExecutionRisk["level"],
  );
  const confirmation = values.reduce(
    (current, risk) =>
      CONFIRMATION_RANK[risk.confirmation] > CONFIRMATION_RANK[current]
        ? risk.confirmation
        : current,
    "none" as ExecutionRisk["confirmation"],
  );
  return {
    risk: {
      schemaVersion: 1,
      level,
      reasons: values.flatMap((risk) => risk.reasons),
      externalEffects: [...new Set(values.flatMap((risk) => risk.externalEffects))],
      confirmation,
      expectedAppBoundaries: [...new Set(values.flatMap((risk) => risk.expectedAppBoundaries))],
      cleanupRequired: values.some((risk) => risk.cleanupRequired),
    },
    invalidCellIds,
  };
}

function providerClassification(
  proof: ChangeVerification,
  decision?: ChangeProofDecision,
): ChangeProofProviderCheck["classification"] {
  if (proof.state === "superseded") return "superseded";
  if (proof.state === "cancelled") return "cancelled";
  const durableDecision = decision?.decision ?? proof.decision;
  const gaps = decision?.coverageGaps ?? proof.coverageGaps;
  if (
    durableDecision === "insufficient-evidence" &&
    gaps.some((gap) => gap.startsWith(INFRASTRUCTURE_GAP_PREFIX))
  ) {
    return "infrastructure-failure";
  }
  if (!durableDecision) throw new Error("A provider check requires a terminal Proof decision");
  return durableDecision;
}

function platformForTargetCase(
  targetCase: ChangeVerification["selection"]["targetCases"][number],
): ChangeVerification["builds"][number]["platform"] {
  return targetCase.executionTarget.platform === "browser"
    ? "web"
    : targetCase.executionTarget.platform;
}

function validateCaseResults(
  proof: ChangeVerification,
  values: readonly unknown[],
): ChangeProofCaseResult[] {
  if (values.length > 1_000) throw new Error("Proof decisions are bounded to 1,000 Run results");
  const results = values.map((value) => changeProofCaseResultSchema.parse(value));
  const keys = results.map((result) =>
    result.cellId ? `cell:${result.cellId}` : `legacy:${legacyIdentityKey(result)}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error("Proof Run result identities must be unique");
  const journeys = new Set(
    proof.selection.affectedJourneys.map(({ appMapId, testId }) => `${appMapId}\0${testId}`),
  );
  const cells = proof.selection.cells;
  if (!cells?.length) throw new Error("Proof has no frozen Verification Cells");
  const targetCases = new Map(proof.selection.targetCases.map((item) => [item.id, item]));
  const builds = new Map(proof.builds.map((item) => [item.id, item]));
  for (const result of results) {
    if (!journeys.has(`${result.appMapId}\0${result.testId}`)) {
      throw new Error(`Run ${result.runId} does not belong to an affected journey`);
    }
    const targetCase = targetCases.get(result.targetCaseId);
    if (!targetCase) throw new Error(`Run ${result.runId} does not belong to a frozen target case`);
    const build = builds.get(result.buildId);
    if (!build) throw new Error(`Run ${result.runId} does not use a frozen Proof build`);
    if (build.platform !== platformForTargetCase(targetCase)) {
      throw new Error(`Run ${result.runId} build platform does not match its frozen target case`);
    }
    if (
      result.sourceSha !== changeTestedSha(proof.change) ||
      result.sourceSha !== build.sourceSha ||
      result.artifactDigest !== build.artifactDigest
    ) {
      throw new Error(`Run ${result.runId} provenance does not match the exact Proof build`);
    }
    const cell = cellForResult(proof, result);
    if (cell.buildId !== result.buildId) {
      throw new Error(`Run ${result.runId} does not match its frozen Verification Cell`);
    }
    if (cell.cleanupRequired && result.cleanup === "not-required") {
      throw new Error(`Run ${result.runId} omits cleanup proof required by its Verification Cell`);
    }
  }
  return results;
}

/** Aggregate immutable per-cell Run facts. A definitive product regression
 * rejects; ambiguity requires review; every other missing proof channel
 * remains insufficient evidence. Only every explicit frozen cell can prove. */
export function decideChangeVerification(input: {
  proof: unknown;
  caseResults: readonly unknown[];
}): ChangeProofDecision {
  const proof = parseChangeVerification(input.proof);
  if (!proof.planApproval)
    throw new Error("A Proof decision requires an approved Verification Plan");
  const results = validateCaseResults(proof, input.caseResults);
  const requiredCellIds = proof.selection
    .cells!.filter(({ requirement }) => requirement === "required")
    .map(({ id }) => id);
  const byCellId = new Map(results.map((result) => [cellForResult(proof, result).id, result]));
  const requiredResults = requiredCellIds
    .map((cellId) => byCellId.get(cellId))
    .filter((result): result is ChangeProofCaseResult => result !== undefined);
  const missing = requiredCellIds.filter((cellId) => !byCellId.has(cellId));
  const firstMissingCell = proof.selection.cells!.find(({ id }) => id === missing[0]);
  const advisory = results.filter(
    (result) => cellForResult(proof, result).requirement === "advisory",
  );
  const firstRejected = requiredResults.find(({ outcome }) => outcome === "rejected");
  const firstReview = requiredResults.find(
    (result) =>
      result.outcome === "needs-review" ||
      result.selectorResolution === "ambiguous" ||
      result.inputOutcome === "unreconciled",
  );
  const firstInfrastructure = requiredResults.find(
    ({ outcome }) => outcome === "infrastructure-failure",
  );
  const insufficient = requiredResults.filter(
    (result) =>
      result.outcome === "insufficient-evidence" ||
      result.outcome === "infrastructure-failure" ||
      !result.evidenceComplete ||
      result.selectorResolution === "unproven" ||
      (result.cleanup !== "restored" && result.cleanup !== "not-required"),
  );
  const coverageGaps = bounded([
    ...proof.coverageGaps,
    ...missing.map((cellId) => `Missing required Run for Verification Cell ${cellId}.`),
    ...insufficient.map(({ runId }) => `Run ${runId} did not produce complete mandatory proof.`),
    ...(firstInfrastructure?.failure
      ? [
          `${INFRASTRUCTURE_GAP_PREFIX}${firstInfrastructure.runId}: ${firstInfrastructure.failure.summary}`,
        ]
      : []),
  ]);
  const residualRisk = bounded([
    ...proof.residualRisk,
    ...advisory
      .filter(({ outcome }) => outcome !== "passed")
      .map(
        ({ targetCaseId, runId }) =>
          `Advisory target case ${targetCaseId} did not pass (${runId}).`,
      ),
  ]);

  // Durable cells are an adapter of the same policy input consumed by
  // offline verify-change. Risk is read from the frozen cell authority; a
  // missing or forged authority must never be replaced with a safe default.
  const requiredCells = proof.selection.cells!.filter(
    ({ requirement }) => requirement === "required",
  );
  const authority = aggregateCellExecutionRisk(requiredCells);
  if (authority.invalidCellIds.length || !authority.risk) {
    const authorityCoverageGaps = bounded([
      ...coverageGaps,
      ...authority.invalidCellIds.map(
        (cellId) => `Verification Cell ${cellId} has missing or mismatched execution authority.`,
      ),
    ]);
    const authorityDecision = firstRejected ? ("rejected" as const) : ("needs-review" as const);
    const authorityFailure = firstRejected?.failure
      ? {
          runId: firstRejected.runId,
          testId: firstRejected.testId,
          targetCaseId: firstRejected.targetCaseId,
          ...(firstRejected.failure.checkId ? { checkId: firstRejected.failure.checkId } : {}),
          summary: firstRejected.failure.summary,
          evidenceRefs: firstRejected.failure.evidenceRefs,
        }
      : undefined;
    return changeProofDecisionSchema.parse({
      schemaVersion: 1,
      decision: authorityDecision,
      state: authorityDecision,
      summary: {
        required: requiredCellIds.length,
        passed: requiredResults.filter(({ outcome }) => outcome === "passed").length,
        rejected: requiredResults.filter(({ outcome }) => outcome === "rejected").length,
        needsReview: requiredResults.filter(({ outcome }) => outcome === "needs-review").length,
        insufficient: insufficient.length,
        missing: missing.length,
      },
      runIds: unique(results.map(({ runId }) => runId)),
      evidenceDigests: unique(results.flatMap(({ evidenceDigests }) => evidenceDigests)),
      ...(authorityFailure ? { firstCausalFailure: authorityFailure } : {}),
      coverageGaps: authorityCoverageGaps,
      residualRisk,
      smallestNextVerification: {
        kind: "review",
        reason: "Review the frozen execution authority before this Proof can authorize merge.",
      },
      ruleIds: ["execution.authority-missing"],
    });
  }
  const policyDecision = evaluateChangeDecisionPolicy({
    schemaVersion: 1,
    policy: proof.policy,
    executionRisk: authority.risk,
    confirmationSatisfied: authority.risk.confirmation === "none",
    evidence: {
      status: coverageGaps.length === 0 && insufficient.length === 0 ? "complete" : "partial",
      requiredChannels: ["frozen-run", "trace-pack"],
      missing: coverageGaps,
      tracePackDigests: unique(results.flatMap(({ evidenceDigests }) => evidenceDigests)),
      runIds: unique(results.map(({ runId }) => runId)),
      evidenceRefs: unique(
        results.flatMap(({ evidenceDigests, failure }) => [
          ...evidenceDigests,
          ...(failure?.evidenceRefs ?? []),
        ]),
      ),
    },
    verification: {
      requiredPaths: firstRejected
        ? "failed"
        : requiredResults.length === requiredCellIds.length &&
            requiredResults.every(({ outcome }) => outcome === "passed")
          ? "passed"
          : "unproven",
      selectorResolution: firstReview
        ? "ambiguous"
        : requiredResults.some(({ selectorResolution }) => selectorResolution === "unproven")
          ? "unproven"
          : "deterministic",
      unresolved: [
        ...missing.map((cellId) => `missing:${cellId}`),
        ...insufficient.map(({ runId }) => `incomplete:${runId}`),
      ],
    },
    findings: requiredResults.flatMap((result) =>
      result.outcome === "rejected"
        ? [
            {
              id: `${result.runId}:rejected`,
              runId: result.runId,
              category: "assertion" as const,
              severity: "regression" as const,
              summary: result.failure?.summary ?? `Run ${result.runId} rejected.`,
              evidenceRefs: unique([
                ...result.evidenceDigests,
                ...(result.failure?.evidenceRefs ?? []),
              ]),
            },
          ]
        : [],
    ),
  });
  const decision = policyDecision.decision;
  const firstCausalFailure = firstRejected?.failure
    ? {
        runId: firstRejected.runId,
        testId: firstRejected.testId,
        targetCaseId: firstRejected.targetCaseId,
        ...(firstRejected.failure.checkId ? { checkId: firstRejected.failure.checkId } : {}),
        summary: firstRejected.failure.summary,
        evidenceRefs: firstRejected.failure.evidenceRefs,
      }
    : undefined;
  const next =
    decision === "proved"
      ? { kind: "none" as const, reason: "Every policy-required case has complete proof." }
      : decision === "rejected"
        ? firstRejected
          ? {
              kind: "review" as const,
              reason:
                "Repair the first causal regression, then create a new Proof for the new head.",
              appMapId: firstRejected.appMapId,
              testId: firstRejected.testId,
              targetCaseId: firstRejected.targetCaseId,
            }
          : {
              kind: "review" as const,
              reason: "Review the execution authority before retrying this Proof.",
            }
        : decision === "needs-review"
          ? {
              kind: "review" as const,
              reason: "A human decision is required before this Proof can authorize merge.",
              ...(firstReview
                ? {
                    appMapId: firstReview.appMapId,
                    testId: firstReview.testId,
                    targetCaseId: firstReview.targetCaseId,
                  }
                : {}),
            }
          : {
              kind: "expand" as const,
              reason: "Run the smallest missing or incomplete required case.",
              ...(firstMissingCell
                ? {
                    appMapId: firstMissingCell.journey.appMapId,
                    testId: firstMissingCell.journey.testId,
                    targetCaseId: firstMissingCell.targetCaseId,
                  }
                : insufficient[0]
                  ? {
                      appMapId: insufficient[0].appMapId,
                      testId: insufficient[0].testId,
                      targetCaseId: insufficient[0].targetCaseId,
                    }
                  : {}),
            };

  return changeProofDecisionSchema.parse({
    schemaVersion: 1,
    decision,
    state: decision,
    summary: {
      required: requiredCellIds.length,
      passed: requiredResults.filter(({ outcome }) => outcome === "passed").length,
      rejected: requiredResults.filter(({ outcome }) => outcome === "rejected").length,
      needsReview: requiredResults.filter(({ outcome }) => outcome === "needs-review").length,
      insufficient: insufficient.length,
      missing: missing.length,
    },
    runIds: unique(results.map(({ runId }) => runId)),
    evidenceDigests: unique(results.flatMap(({ evidenceDigests }) => evidenceDigests)),
    ...(firstCausalFailure ? { firstCausalFailure } : {}),
    coverageGaps,
    residualRisk,
    smallestNextVerification: next,
    ruleIds: [
      "exact-head-and-build",
      "all-required-cases",
      "mandatory-evidence-complete",
      "deterministic-selector-resolution",
      "reconciled-input-outcomes",
      "cleanup-restored",
    ],
  });
}

export function agentRepairPacketForDecision(input: {
  proof: unknown;
  caseResults: readonly unknown[];
}): AgentRepairPacket | undefined {
  const proof = parseChangeVerification(input.proof);
  const results = validateCaseResults(proof, input.caseResults);
  const decision = decideChangeVerification({ proof, caseResults: results });
  if (decision.decision !== "rejected" || !decision.firstCausalFailure) return undefined;
  const failed = results.find(({ runId }) => runId === decision.firstCausalFailure!.runId);
  if (!failed?.failure) return undefined;
  return agentRepairPacketSchema.parse({
    schemaVersion: 1,
    proofId: proof.id,
    headSha: changeTestedSha(proof.change),
    runId: failed.runId,
    appMapId: failed.appMapId,
    testId: failed.testId,
    targetCaseId: failed.targetCaseId,
    firstCausalFailure: failed.failure.summary,
    ...(failed.failure.expected ? { expected: failed.failure.expected } : {}),
    ...(failed.failure.observed ? { observed: failed.failure.observed } : {}),
    evidenceRefs: failed.failure.evidenceRefs,
    relevantLogs: failed.failure.relevantLogs ?? [],
    suggestedScope: failed.failure.suggestedScope ?? [],
    rerun: { operationId: "proof.rerun-affected", proofId: proof.id },
  });
}

/** Project a repair packet from the coordinator's durable per-cell results.
 * This keeps packet assembly in the decision authority instead of allowing a
 * route, workflow, or renderer to synthesize failure details. Incomplete or
 * tampered execution cells fail closed through the canonical decision parser. */
export function agentRepairPacketForExecution(input: {
  proof: unknown;
  execution: { cells: readonly { result?: unknown }[] };
}): AgentRepairPacket | undefined {
  return agentRepairPacketForDecision({
    proof: input.proof,
    caseResults: input.execution.cells.flatMap((cell) =>
      cell.result === undefined ? [] : [cell.result],
    ),
  });
}

export function providerCheckForChangeProof(input: {
  proof: unknown;
  decision: unknown;
  detailsUrl?: string;
}): ChangeProofProviderCheck {
  const proof = parseChangeVerification(input.proof);
  const decision = changeProofDecisionSchema.parse(input.decision);
  const classification = providerClassification(proof, decision);
  const policyDigest = proof.policyDigest ?? verifyChangePolicyDigest(proof.policy);
  const planDigest = proof.planDigest ?? verifyChangePlanDigest(proof);
  const terminalProof = {
    ...proof,
    state: decision.state,
    decision: decision.decision,
    runIds: decision.runIds,
    evidenceDigests: decision.evidenceDigests,
    firstCausalFailure: decision.firstCausalFailure,
    coverageGaps: decision.coverageGaps,
    residualRisk: decision.residualRisk,
    smallestNextVerification: decision.smallestNextVerification,
    policyDigest,
    planDigest,
  } as ChangeVerification;
  const decisionDigest = verifyChangeDecisionDigest(terminalProof);
  const conclusion =
    decision.decision === "proved"
      ? "success"
      : decision.decision === "rejected"
        ? "failure"
        : "action-required";
  const title = `Relay Proof — ${classification.toUpperCase().replaceAll("-", " ")}`;
  const lines = [
    `Head: ${changeTestedSha(proof.change)}`,
    `Required cases: ${decision.summary.passed}/${decision.summary.required} passed`,
    `Evidence objects: ${decision.evidenceDigests.length}`,
    `Policy: ${proof.policy.id}.v${proof.policy.version}`,
    ...(decision.firstCausalFailure
      ? [`First causal failure: ${decision.firstCausalFailure.summary}`]
      : []),
    ...(decision.coverageGaps.length
      ? ["", "Coverage gaps:", ...decision.coverageGaps.map((gap) => `- ${gap}`)]
      : []),
    ...(decision.residualRisk.length
      ? ["", "Residual risk:", ...decision.residualRisk.map((risk) => `- ${risk}`)]
      : []),
  ];
  return changeProofProviderCheckSchema.parse({
    schemaVersion: 1,
    name: "Relay Proof",
    externalId: proof.id,
    headSha: changeTestedSha(proof.change),
    status: "completed",
    conclusion,
    classification,
    title,
    summary: decision.smallestNextVerification.reason,
    text: lines.join("\n"),
    policyDigest,
    planDigest,
    decisionDigest,
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
  });
}

/** Project a completed provider check exclusively from the durable terminal
 * Proof. This is the publication boundary: callers cannot supply a friendlier
 * summary than Relay actually persisted. */
export function providerCheckForStoredChangeProof(input: {
  proof: unknown;
  detailsUrl?: string;
}): ChangeProofProviderCheck {
  const rawProof = parseChangeVerification(input.proof);
  let proof = verifyDurableChangeVerification(rawProof);
  // Historical terminal documents are projected as review-required, with
  // identities materialized only for this non-authorizing provider view. A
  // planning/running document remains an invalid publication target.
  const rawTerminal =
    rawProof.state === "proved" ||
    rawProof.state === "rejected" ||
    rawProof.state === "needs-review" ||
    rawProof.state === "insufficient-evidence" ||
    rawProof.state === "cancelled" ||
    rawProof.state === "superseded";
  if (!rawProof.policyDigest || !rawProof.planDigest || (rawTerminal && !rawProof.decisionDigest)) {
    if (
      rawProof.state !== "proved" &&
      rawProof.state !== "rejected" &&
      rawProof.state !== "needs-review" &&
      rawProof.state !== "insufficient-evidence" &&
      rawProof.state !== "cancelled" &&
      rawProof.state !== "superseded"
    ) {
      throw new Error("A provider check requires a terminal Proof");
    }
    proof = materializeChangeVerificationIntegrity(proof);
  }
  if (
    !proof.policyDigest ||
    !proof.planDigest ||
    (proof.state !== "cancelled" && proof.state !== "superseded" && !proof.decisionDigest)
  ) {
    throw new Error("A provider check requires a terminal Proof with verified integrity digests");
  }
  const classification = providerClassification(proof);
  const conclusion =
    classification === "proved"
      ? "success"
      : classification === "rejected"
        ? "failure"
        : "action-required";
  // A legacy approved Proof without cells is migrated to needs-review by the
  // protocol parser, so this count can never grant it green authority.
  const requiredCases =
    proof.selection.cells?.filter(({ requirement }) => requirement === "required").length ?? 0;
  const lines = [
    `Head: ${changeTestedSha(proof.change)}`,
    `Required cases: ${requiredCases}`,
    `Recorded Runs: ${proof.runIds.length}`,
    `Evidence objects: ${proof.evidenceDigests.length}`,
    `Policy: ${proof.policy.id}.v${proof.policy.version}`,
    ...(proof.state === "superseded" && proof.supersededByProofId
      ? [`Superseded by Proof: ${proof.supersededByProofId}`]
      : []),
    ...(proof.state === "cancelled" && proof.cancellation
      ? [`Cancelled: ${proof.cancellation.reason}`]
      : []),
    ...(proof.firstCausalFailure
      ? [`First causal failure: ${proof.firstCausalFailure.summary}`]
      : []),
    ...(proof.coverageGaps.length
      ? ["", "Coverage gaps:", ...proof.coverageGaps.map((gap) => `- ${gap}`)]
      : []),
    ...(proof.residualRisk.length
      ? ["", "Residual risk:", ...proof.residualRisk.map((risk) => `- ${risk}`)]
      : []),
  ];
  return changeProofProviderCheckSchema.parse({
    schemaVersion: 1,
    name: "Relay Proof",
    externalId: proof.id,
    headSha: changeTestedSha(proof.change),
    status: "completed",
    conclusion,
    classification,
    title: `Relay Proof — ${classification.toUpperCase().replaceAll("-", " ")}`,
    summary:
      classification === "superseded"
        ? `This Proof was superseded by ${proof.supersededByProofId}. Merge authority belongs to the replacement head.`
        : classification === "cancelled"
          ? "This Proof was cancelled and cannot authorize the tested head."
          : (proof.smallestNextVerification?.reason ??
            (classification === "proved"
              ? "Every policy-required case has complete proof."
              : "Review the durable Proof before merge.")),
    text: lines.join("\n"),
    policyDigest: proof.policyDigest,
    planDigest: proof.planDigest,
    ...(proof.decisionDigest ? { decisionDigest: proof.decisionDigest } : {}),
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
  });
}

/** Project non-authorizing queued/running status from one durable active Proof.
 * Progress never carries a conclusion; only the terminal projector above can
 * authorize success, failure, or action-required. */
export function providerProgressCheckForStoredChangeProof(input: {
  proof: unknown;
  detailsUrl?: string;
}): ChangeProofProviderCheck {
  const proof = verifyDurableChangeVerification(parseChangeVerification(input.proof));
  const inProgress = ["running-pilot", "awaiting-expansion", "running"].includes(proof.state);
  if (!inProgress && !["planning", "awaiting-build", "ready"].includes(proof.state)) {
    throw new Error("A progress provider check requires an active nonterminal Proof");
  }
  if (!proof.policyDigest || !proof.planDigest) {
    throw new Error("A progress provider check requires verified policy and plan digests");
  }
  const status = inProgress ? "in_progress" : "queued";
  return changeProofProviderCheckSchema.parse({
    schemaVersion: 1,
    name: "Relay Proof",
    externalId: proof.id,
    headSha: changeTestedSha(proof.change),
    status,
    classification: inProgress ? "in-progress" : "queued",
    title: `Relay Proof — ${inProgress ? "IN PROGRESS" : "QUEUED"}`,
    summary:
      proof.smallestNextVerification?.reason ??
      (inProgress
        ? "Relay is executing the frozen Verification Plan."
        : "Relay queued the frozen Verification Plan."),
    text: [
      `Head: ${changeTestedSha(proof.change)}`,
      `Proof state: ${proof.state}`,
      `Recorded Runs: ${proof.runIds.length}`,
      `Evidence objects: ${proof.evidenceDigests.length}`,
      `Policy: ${proof.policy.id}.v${proof.policy.version}`,
    ].join("\n"),
    policyDigest: proof.policyDigest,
    planDigest: proof.planDigest,
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
  });
}

/** Server-owned terminal transition. Callers supply immutable Run facts; this
 * function recomputes the decision before appending Run/evidence identities. */
export async function recordChangeVerificationDecision(
  input: ChangeVerificationScope & {
    proofId: string;
    expectedVersion: number;
    caseResults: readonly unknown[];
    actorId: string;
    requestId: string;
    requestDigest: ChangeVerification["lastMutation"]["requestDigest"];
    at: number;
  },
): Promise<ChangeVerification> {
  const proof = await readChangeVerification(input, input.proofId);
  if (!proof) throw new Error("Change Verification not found in this project");
  const decision = decideChangeVerification({ proof, caseResults: input.caseResults });
  return advanceChangeVerification({
    organizationId: input.organizationId,
    projectId: input.projectId,
    proofId: input.proofId,
    expectedVersion: input.expectedVersion,
    state: decision.state,
    actorId: input.actorId,
    requestId: input.requestId,
    requestDigest: input.requestDigest,
    action: "record-decision",
    at: input.at,
    runIds: unique([...proof.runIds, ...decision.runIds]),
    evidenceDigests: unique([...proof.evidenceDigests, ...decision.evidenceDigests]),
    firstCausalFailure: decision.firstCausalFailure,
    coverageGaps: decision.coverageGaps,
    residualRisk: decision.residualRisk,
    smallestNextVerification: decision.smallestNextVerification,
  });
}
