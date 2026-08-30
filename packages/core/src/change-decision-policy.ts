import type {
  ApprovalPolicyDecision,
  ApprovalPolicyFinding,
  ApprovalPolicyInput,
} from "@relay/protocol";

export type ChangeDecision = "proved" | "rejected" | "needs-review" | "insufficient-evidence";

/** The shared, durable vocabulary returned by the authoritative evaluator. */
export type ChangeDecisionPolicyResult = Omit<ApprovalPolicyDecision, "decision"> & {
  decision: ChangeDecision;
};

const DEFINITIVE_FAILURES = new Set<ApprovalPolicyFinding["category"]>([
  "crash",
  "path-loss",
  "assertion",
  "security",
  "privacy",
  "policy",
]);

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.some((value) => typeof value !== "string") ||
    right.some((value) => typeof value !== "string") ||
    new Set(left).size !== left.length ||
    new Set(right).size !== right.length
  ) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

/**
 * A finding review is an authority over one immutable evidence observation,
 * not a free-standing boolean. Keep this validation next to policy evaluation
 * so every adapter gets the same fail-closed behavior, including callers that
 * do not pass through an operation parser first.
 */
export function approvalPolicyFindingReviewIsValid(
  input: ApprovalPolicyInput,
  finding: ApprovalPolicyFinding,
): boolean {
  const review = finding.review;
  if (!review || review.schemaVersion !== 1) return false;
  if (
    typeof finding.id !== "string" ||
    !finding.id.trim() ||
    typeof finding.runId !== "string" ||
    !finding.runId.trim() ||
    typeof review.decisionId !== "string" ||
    !review.decisionId.trim() ||
    typeof review.reviewedBy !== "string" ||
    !review.reviewedBy.trim() ||
    typeof review.reason !== "string" ||
    !review.reason.trim() ||
    !Number.isSafeInteger(review.reviewedAt) ||
    review.reviewedAt < 0
  ) {
    return false;
  }
  if (
    !review.scope ||
    review.scope.findingId !== finding.id ||
    review.scope.runId !== finding.runId ||
    !Array.isArray(review.scope.evidenceRefs) ||
    !exactStringSet(finding.evidenceRefs, finding.evidenceRefs) ||
    !finding.evidenceRefs.every((ref) => review.scope.evidenceRefs.includes(ref))
  ) {
    return false;
  }
  const currentRunIds = input.evidence.runIds;
  const currentEvidenceRefs = input.evidence.evidenceRefs;
  return (
    Array.isArray(currentRunIds) &&
    currentRunIds.includes(finding.runId) &&
    Array.isArray(currentEvidenceRefs) &&
    exactStringSet(review.scope.evidenceRefs, currentEvidenceRefs)
  );
}

function result(
  input: ApprovalPolicyInput,
  value: Omit<ChangeDecisionPolicyResult, "schemaVersion" | "policy" | "evidenceRefs">,
): ChangeDecisionPolicyResult {
  return {
    schemaVersion: 1,
    policy: input.policy,
    ...value,
    evidenceRefs: unique([
      ...(input.evidence.tracePackDigest ? [input.evidence.tracePackDigest] : []),
      ...(input.evidence.tracePackDigests ?? []),
      ...input.findings.flatMap((finding) => finding.evidenceRefs),
    ]),
  };
}

/**
 * The one authoritative merge-policy evaluator.
 *
 * Offline Run evidence and durable Change Proof cells are deliberately
 * adapters of the same input shape. This function owns precedence: prohibited
 * execution, definitive failure, confirmation, incomplete evidence, human
 * review, unresolved verification, and finally proof. Keeping that ordering
 * behind one small interface prevents the two product surfaces from drifting.
 */
export function evaluateChangeDecisionPolicy(
  input: ApprovalPolicyInput,
): ChangeDecisionPolicyResult {
  if (input.executionRisk.level === "prohibited") {
    return result(input, {
      execution: "blocked",
      decision: "rejected",
      ruleIds: ["execution.prohibited"],
      reasons: input.executionRisk.reasons.map((reason) => reason.explanation),
      unresolvedVerification: input.verification.unresolved,
      confidence: { value: 1, basis: "deterministic-policy" },
    });
  }

  const activeFindings = input.findings.filter(
    (finding) => !approvalPolicyFindingReviewIsValid(input, finding),
  );
  const definitiveFailures = activeFindings.filter(
    (finding) =>
      finding.severity === "blocker" ||
      (finding.severity === "regression" && DEFINITIVE_FAILURES.has(finding.category)),
  );
  // Missing corroborating channels can prevent approval, but they cannot
  // soften a failure already proved by the evidence that is present.
  if (input.verification.requiredPaths === "failed" || definitiveFailures.length > 0) {
    return result(input, {
      execution: "allowed",
      decision: "rejected",
      ruleIds: unique([
        ...(input.verification.requiredPaths === "failed"
          ? ["verification.required-path-lost"]
          : []),
        ...definitiveFailures.map((finding) => `finding.${finding.category}`),
      ]),
      reasons: [
        ...(input.verification.requiredPaths === "failed"
          ? ["A required path failed deterministic replay."]
          : []),
        ...definitiveFailures.map((finding) => finding.summary),
      ],
      unresolvedVerification: input.verification.unresolved,
      confidence: { value: 1, basis: "deterministic-policy" },
    });
  }

  if (input.executionRisk.confirmation !== "none" && !input.confirmationSatisfied) {
    return result(input, {
      execution: "confirmation-required",
      decision: "needs-review",
      ruleIds: [
        input.executionRisk.confirmation === "human-only"
          ? "execution.human-only"
          : "execution.confirmation-required",
      ],
      reasons: ["The frozen Test requires confirmation before device mutation."],
      unresolvedVerification: input.verification.unresolved,
    });
  }

  if (input.evidence.status !== "complete" || input.evidence.missing.length > 0) {
    return result(input, {
      execution: "allowed",
      decision: "insufficient-evidence",
      ruleIds: ["evidence.incomplete"],
      reasons: [
        input.evidence.missing.length > 0
          ? `Required evidence is missing: ${input.evidence.missing.join(", ")}.`
          : "The evidence manifest is partial.",
      ],
      unresolvedVerification: unique([
        ...input.verification.unresolved,
        ...input.evidence.missing.map((item) => `missing:${item}`),
      ]),
    });
  }

  const reviewFindings = activeFindings.filter(
    (finding) => finding.severity === "review" || finding.severity === "regression",
  );
  if (input.verification.selectorResolution === "ambiguous" || reviewFindings.length > 0) {
    return result(input, {
      execution: "allowed",
      decision: "needs-review",
      ruleIds: unique([
        ...(input.verification.selectorResolution === "ambiguous"
          ? ["verification.selector-ambiguous"]
          : []),
        ...reviewFindings.map((finding) => `finding.${finding.category}.review`),
      ]),
      reasons: [
        ...(input.verification.selectorResolution === "ambiguous"
          ? ["Selector resolution is ambiguous."]
          : []),
        ...reviewFindings.map((finding) => finding.summary),
      ],
      unresolvedVerification: input.verification.unresolved,
    });
  }

  if (
    input.verification.requiredPaths !== "passed" ||
    input.verification.selectorResolution !== "deterministic" ||
    input.verification.unresolved.length > 0
  ) {
    return result(input, {
      execution: "allowed",
      decision: "insufficient-evidence",
      ruleIds: ["verification.unproven"],
      reasons: ["Required live verification is unresolved."],
      unresolvedVerification: input.verification.unresolved,
    });
  }

  return result(input, {
    execution: "allowed",
    decision: "proved",
    ruleIds: ["verification.proved"],
    reasons: ["Every required path and evidence channel passed deterministic policy."],
    unresolvedVerification: [],
    confidence: { value: 1, basis: "deterministic-policy" },
  });
}

/** Translate the canonical Proof decision back to the historical approval
 * policy contract. This is the only compatibility projection; no caller gets
 * a second implementation of merge precedence. */
export function approvalPolicyDecisionForChange(
  input: ApprovalPolicyInput,
): ApprovalPolicyDecision {
  return approvalPolicyDecisionFromChangeDecision(evaluateChangeDecisionPolicy(input));
}

/** Project an already evaluated canonical decision for legacy API consumers
 * without running or reimplementing merge policy a second time. */
export function approvalPolicyDecisionFromChangeDecision(
  decision: ChangeDecisionPolicyResult,
): ApprovalPolicyDecision {
  const approvalDecision =
    decision.decision === "proved"
      ? "approve"
      : decision.decision === "rejected"
        ? "reject"
        : decision.decision === "needs-review"
          ? "ask-human"
          : "insufficient-evidence";
  return { ...decision, decision: approvalDecision };
}

/** Descriptive alias for adapters that deal in Change Verification terms. */
export const evaluateChangeVerificationPolicy = evaluateChangeDecisionPolicy;
