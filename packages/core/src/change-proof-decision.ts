import {
  agentRepairPacketSchema,
  changeProofCaseResultSchema,
  changeProofDecisionSchema,
  changeProofProviderCheckSchema,
  parseChangeVerification,
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

function identityKey(value: { appMapId: string; testId: string; targetCaseId: string }): string {
  return `${value.appMapId}\0${value.testId}\0${value.targetCaseId}`;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function bounded(values: readonly string[], limit = 128): string[] {
  const result = unique(values);
  if (result.length <= limit) return result;
  return [...result.slice(0, limit - 1), `Additional items omitted: ${result.length - limit + 1}`];
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
  const keys = results.map(identityKey);
  if (new Set(keys).size !== keys.length)
    throw new Error("Proof Run result identities must be unique");
  const journeys = new Set(
    proof.selection.affectedJourneys.map(({ appMapId, testId }) => `${appMapId}\0${testId}`),
  );
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
      result.sourceSha !== proof.change.headSha ||
      result.sourceSha !== build.sourceSha ||
      result.artifactDigest !== build.artifactDigest
    ) {
      throw new Error(`Run ${result.runId} provenance does not match the exact Proof build`);
    }
  }
  return results;
}

/** Aggregate immutable per-journey/per-target Run facts. A definitive product
 * regression rejects; ambiguity requires review; every other missing proof
 * channel remains insufficient evidence. Only the complete Cartesian set of
 * required journeys and target cases can become proved. */
export function decideChangeVerification(input: {
  proof: unknown;
  caseResults: readonly unknown[];
}): ChangeProofDecision {
  const proof = parseChangeVerification(input.proof);
  if (!proof.planApproval)
    throw new Error("A Proof decision requires an approved Verification Plan");
  const results = validateCaseResults(proof, input.caseResults);
  const requiredCases = proof.selection.targetCases.filter(({ required }) => required);
  const requiredIdentities = proof.selection.affectedJourneys.flatMap((journey) =>
    requiredCases.map((targetCase) => ({
      appMapId: journey.appMapId,
      testId: journey.testId,
      targetCaseId: targetCase.id,
    })),
  );
  const byIdentity = new Map(results.map((result) => [identityKey(result), result]));
  const requiredResults = requiredIdentities
    .map((identity) => byIdentity.get(identityKey(identity)))
    .filter((result): result is ChangeProofCaseResult => result !== undefined);
  const missing = requiredIdentities.filter((identity) => !byIdentity.has(identityKey(identity)));
  const advisory = results.filter((result) => {
    const target = proof.selection.targetCases.find(({ id }) => id === result.targetCaseId);
    return target?.required === false;
  });
  const firstRejected = requiredResults.find(({ outcome }) => outcome === "rejected");
  const firstReview = requiredResults.find(
    (result) =>
      result.outcome === "needs-review" ||
      result.selectorResolution === "ambiguous" ||
      result.inputOutcome === "unreconciled",
  );
  const insufficient = requiredResults.filter(
    (result) =>
      result.outcome === "insufficient-evidence" ||
      !result.evidenceComplete ||
      result.selectorResolution === "unproven" ||
      result.cleanup === "unproved",
  );
  const coverageGaps = bounded([
    ...proof.coverageGaps,
    ...missing.map(
      ({ appMapId, testId, targetCaseId }) =>
        `Missing required Run for ${appMapId}/${testId} on target case ${targetCaseId}.`,
    ),
    ...insufficient.map(({ runId }) => `Run ${runId} did not produce complete mandatory proof.`),
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

  const decision = firstRejected
    ? "rejected"
    : firstReview
      ? "needs-review"
      : coverageGaps.length || insufficient.length
        ? "insufficient-evidence"
        : "proved";
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
        ? {
            kind: "review" as const,
            reason: "Repair the first causal regression, then create a new Proof for the new head.",
            appMapId: firstRejected!.appMapId,
            testId: firstRejected!.testId,
            targetCaseId: firstRejected!.targetCaseId,
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
              ...(missing[0] ??
                (insufficient[0]
                  ? {
                      appMapId: insufficient[0].appMapId,
                      testId: insufficient[0].testId,
                      targetCaseId: insufficient[0].targetCaseId,
                    }
                  : {})),
            };

  return changeProofDecisionSchema.parse({
    schemaVersion: 1,
    decision,
    state: decision,
    summary: {
      required: requiredIdentities.length,
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
    headSha: proof.change.headSha,
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

export function providerCheckForChangeProof(input: {
  proof: unknown;
  decision: unknown;
  detailsUrl?: string;
}): ChangeProofProviderCheck {
  const proof = parseChangeVerification(input.proof);
  const decision = changeProofDecisionSchema.parse(input.decision);
  const conclusion =
    decision.decision === "proved"
      ? "success"
      : decision.decision === "rejected"
        ? "failure"
        : "action-required";
  const title = `Relay Proof — ${decision.decision.toUpperCase().replaceAll("-", " ")}`;
  const lines = [
    `Head: ${proof.change.headSha}`,
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
    headSha: proof.change.headSha,
    status: "completed",
    conclusion,
    title,
    summary: decision.smallestNextVerification.reason,
    text: lines.join("\n"),
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
  const proof = parseChangeVerification(input.proof);
  if (!proof.decision) throw new Error("A provider check requires a terminal Proof decision");
  const conclusion =
    proof.decision === "proved"
      ? "success"
      : proof.decision === "rejected"
        ? "failure"
        : "action-required";
  const requiredCases =
    proof.selection.affectedJourneys.length *
    proof.selection.targetCases.filter(({ required }) => required).length;
  const lines = [
    `Head: ${proof.change.headSha}`,
    `Required cases: ${requiredCases}`,
    `Recorded Runs: ${proof.runIds.length}`,
    `Evidence objects: ${proof.evidenceDigests.length}`,
    `Policy: ${proof.policy.id}.v${proof.policy.version}`,
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
    headSha: proof.change.headSha,
    status: "completed",
    conclusion,
    title: `Relay Proof — ${proof.decision.toUpperCase().replaceAll("-", " ")}`,
    summary:
      proof.smallestNextVerification?.reason ??
      (proof.decision === "proved"
        ? "Every policy-required case has complete proof."
        : "Review the durable Proof before merge."),
    text: lines.join("\n"),
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
