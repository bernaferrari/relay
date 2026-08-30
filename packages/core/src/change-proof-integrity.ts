import {
  VERIFY_CHANGE_POLICY as VERIFY_CHANGE_POLICY_IDENTITY,
  changeVerificationPolicySchema,
  parseChangeVerification,
  materializeChangeRef,
  type ChangeVerification,
  type ChangeVerificationDecision,
} from "@relay/protocol";
import { canonicalSha256, type CanonicalSha256 } from "./canonical-json.js";
import { VERIFY_CHANGE_POLICY_DEFINITION } from "./change-decision-policy.js";

/** The complete, server-owned definition for the live Change Proof policy.
 *
 * `changeVerification.policy` intentionally stores only the identity. This
 * frozen definition is the version-dispatched implementation that identity
 * names, and its digest is what makes a durable Proof portable across hosts.
 * Keep `ruleIds` in lock-step with the ruleIds emitted by decideChangeVerification. */
export { VERIFY_CHANGE_POLICY_DEFINITION } from "./change-decision-policy.js";

type VerifyChangePolicyDefinition = Readonly<{
  id: string;
  version: number;
  ruleIds: readonly string[];
  [key: string]: unknown;
}>;

const LEGACY_VERIFY_CHANGE_POLICY_V1 = Object.freeze({
  id: VERIFY_CHANGE_POLICY_IDENTITY.id,
  version: 1,
  ruleIds: Object.freeze([
    "exact-head-and-build",
    "all-required-cases",
    "mandatory-evidence-complete",
    "deterministic-selector-resolution",
    "reconciled-input-outcomes",
    "cleanup-restored",
  ] as const),
});

const POLICY_DEFINITIONS: ReadonlyMap<string, VerifyChangePolicyDefinition> = new Map<
  string,
  VerifyChangePolicyDefinition
>([
  [
    `${VERIFY_CHANGE_POLICY_DEFINITION.id}@${VERIFY_CHANGE_POLICY_DEFINITION.version}`,
    VERIFY_CHANGE_POLICY_DEFINITION,
  ],
  [`${LEGACY_VERIFY_CHANGE_POLICY_V1.id}@1`, LEGACY_VERIFY_CHANGE_POLICY_V1],
  // Historical durable fixtures used this identity. It remains an explicit,
  // versioned server-owned definition so they cannot inject arbitrary rules;
  // newly unknown ids/versions are still rejected before persistence.
  [
    "relay.default@3",
    Object.freeze({
      id: "relay.default",
      version: 3,
      ruleIds: LEGACY_VERIFY_CHANGE_POLICY_V1.ruleIds,
    }),
  ],
]);

const TERMINAL_STATES = new Set<ChangeVerification["state"]>([
  "proved",
  "rejected",
  "needs-review",
  "insufficient-evidence",
]);

export class ChangeProofIntegrityError extends Error {
  readonly code:
    | "POLICY_UNSUPPORTED"
    | "POLICY_IDENTITY_MISSING"
    | "POLICY_DIGEST_MISSING"
    | "POLICY_DIGEST_MISMATCH"
    | "PLAN_DIGEST_MISSING"
    | "PLAN_DIGEST_MISMATCH"
    | "DECISION_DIGEST_MISSING"
    | "DECISION_DIGEST_MISMATCH"
    | "DECISION_DIGEST_UNEXPECTED";

  constructor(code: ChangeProofIntegrityError["code"], message: string) {
    super(message);
    this.name = "ChangeProofIntegrityError";
    this.code = code;
  }
}

function policyKey(policy: { id: string; version: number }): string {
  return `${policy.id}@${policy.version}`;
}

/** Resolve a caller-supplied policy identity through the server-owned version
 * registry. Call this before opening a persistence transaction. */
export function resolveVerifyChangePolicy(policy: unknown): VerifyChangePolicyDefinition {
  const identity = changeVerificationPolicySchema.parse(policy);
  const definition = POLICY_DEFINITIONS.get(policyKey(identity));
  if (!definition) {
    throw new ChangeProofIntegrityError(
      "POLICY_UNSUPPORTED",
      `Unsupported Change Proof policy ${identity.id}.v${identity.version}`,
    );
  }
  return definition;
}

export function verifyChangePolicyDigest(policy: unknown): CanonicalSha256 {
  return canonicalSha256(resolveVerifyChangePolicy(policy));
}

function terminalDecisionForState(
  state: ChangeVerification["state"],
): ChangeVerificationDecision | undefined {
  return TERMINAL_STATES.has(state) ? (state as ChangeVerificationDecision) : undefined;
}

/** The exact immutable plan materialized by the Proof. Deliberately exclude
 * policy and lifecycle metadata: those have their own identities. */
export function verifyChangePlanPayload(proof: ChangeVerification): unknown {
  return {
    change: proof.change,
    builds: proof.builds,
    selection: proof.selection,
  };
}

export function verifyChangePlanDigest(proof: ChangeVerification): CanonicalSha256 {
  return canonicalSha256(verifyChangePlanPayload(proof));
}

/** A terminal decision is a digest of the durable decision inputs and outputs,
 * rather than a caller-provided label. This binds terminal authority to the
 * exact Proof plan, run/evidence identities, and deterministic decision facts. */
export function verifyChangeDecisionPayload(proof: ChangeVerification): unknown {
  const decision = terminalDecisionForState(proof.state);
  if (!decision) throw new TypeError("A Change Proof decision digest requires a terminal state");
  return {
    policyDigest: proof.policyDigest ?? null,
    planDigest: proof.planDigest ?? null,
    state: proof.state,
    decision,
    runIds: proof.runIds,
    evidenceDigests: proof.evidenceDigests,
    firstCausalFailure: proof.firstCausalFailure ?? null,
    coverageGaps: proof.coverageGaps,
    residualRisk: proof.residualRisk,
    smallestNextVerification: proof.smallestNextVerification ?? null,
  };
}

export function verifyChangeDecisionDigest(proof: ChangeVerification): CanonicalSha256 {
  return canonicalSha256(verifyChangeDecisionPayload(proof));
}

function failClosedLegacyProof(
  proof: ChangeVerification,
  reasons: readonly string[],
): ChangeVerification {
  const migrationGap = reasons.join(" ");
  const active = proof.state !== "cancelled" && proof.state !== "superseded";
  const state = active ? "needs-review" : proof.state;
  const coverageGaps = proof.coverageGaps.includes(migrationGap)
    ? proof.coverageGaps
    : proof.coverageGaps.length >= 128
      ? proof.coverageGaps
      : [...proof.coverageGaps, migrationGap];
  return parseChangeVerification({
    ...proof,
    state,
    ...(state === "needs-review" ? { decision: "needs-review" } : { decision: undefined }),
    ...(active ? { planApproval: undefined } : {}),
    coverageGaps,
    smallestNextVerification: active
      ? { kind: "review", reason: migrationGap }
      : proof.smallestNextVerification,
  });
}

function missingIdentityReasons(proof: ChangeVerification): string[] {
  const reasons: string[] = [];
  if (!proof.policyDigest) reasons.push("policyDigest is missing.");
  if (!proof.planDigest) reasons.push("planDigest is missing.");
  if (terminalDecisionForState(proof.state) && !proof.decisionDigest) {
    reasons.push("decisionDigest is missing.");
  }
  return reasons;
}

/** Verify a durable Proof after it has crossed a storage boundary. Missing
 * identities are historical data: return an explicit review-needed projection
 * so old records can never silently authorize execution or merge. A present,
 * mismatching digest is treated as tampering and throws. */
export function verifyDurableChangeVerification(value: unknown): ChangeVerification {
  const proof = parseChangeVerification(value);
  const missing = missingIdentityReasons(proof);
  if (missing.length) {
    return failClosedLegacyProof(proof, [
      "This Proof has no complete server-owned integrity identity;",
      "review is required before execution or merge.",
      ...missing,
    ]);
  }
  const expectedPolicyDigest = verifyChangePolicyDigest(proof.policy);
  if (proof.policyDigest !== expectedPolicyDigest) {
    throw new ChangeProofIntegrityError(
      "POLICY_DIGEST_MISMATCH",
      "Change Proof policyDigest does not match the server-owned policy definition",
    );
  }
  const expectedPlanDigest = verifyChangePlanDigest(proof);
  if (proof.planDigest !== expectedPlanDigest) {
    throw new ChangeProofIntegrityError(
      "PLAN_DIGEST_MISMATCH",
      "Change Proof planDigest does not match its immutable change, builds, and selection",
    );
  }
  if (terminalDecisionForState(proof.state)) {
    const expectedDecisionDigest = verifyChangeDecisionDigest(proof);
    if (proof.decisionDigest !== expectedDecisionDigest) {
      throw new ChangeProofIntegrityError(
        "DECISION_DIGEST_MISMATCH",
        "Change Proof decisionDigest does not match its durable terminal decision",
      );
    }
  } else if (proof.decisionDigest !== undefined) {
    throw new ChangeProofIntegrityError(
      "DECISION_DIGEST_UNEXPECTED",
      "A non-terminal Change Proof cannot carry a decisionDigest",
    );
  }
  return proof;
}

/** Materialize identities for a new or revised server-owned document. Existing
 * identities are checked rather than overwritten, so a forged mutation cannot
 * repair its own digest while entering persistence. */
export function materializeChangeVerificationIntegrity(value: unknown): ChangeVerification {
  const parsed = parseChangeVerification(value);
  // Freeze the source identity before computing plan/decision digests. Legacy
  // callers still provide baseSha/headSha; the protocol helper maps those
  // aliases to mergeBaseSha/testedSha while preserving the aliases for old
  // readers. New callers can provide the complete provider-neutral ChangeRef.
  const proof = parsed.change
    ? ({ ...parsed, change: materializeChangeRef(parsed.change) } as ChangeVerification)
    : parsed;
  const expectedPolicyDigest = verifyChangePolicyDigest(proof.policy);
  if (proof.policyDigest && proof.policyDigest !== expectedPolicyDigest) {
    throw new ChangeProofIntegrityError(
      "POLICY_DIGEST_MISMATCH",
      "Change Proof policyDigest does not match the server-owned policy definition",
    );
  }
  const expectedPlanDigest = verifyChangePlanDigest(proof);
  if (proof.planDigest && proof.planDigest !== expectedPlanDigest) {
    throw new ChangeProofIntegrityError(
      "PLAN_DIGEST_MISMATCH",
      "Change Proof planDigest does not match its immutable plan",
    );
  }
  const terminal = terminalDecisionForState(proof.state);
  const expectedDecisionDigest = terminal
    ? verifyChangeDecisionDigest({
        ...proof,
        policyDigest: expectedPolicyDigest,
        planDigest: expectedPlanDigest,
      })
    : undefined;
  if (proof.decisionDigest && proof.decisionDigest !== expectedDecisionDigest) {
    throw new ChangeProofIntegrityError(
      "DECISION_DIGEST_MISMATCH",
      "Change Proof decisionDigest does not match its terminal decision",
    );
  }
  return parseChangeVerification({
    ...proof,
    policyDigest: expectedPolicyDigest,
    planDigest: expectedPlanDigest,
    ...(expectedDecisionDigest ? { decisionDigest: expectedDecisionDigest } : {}),
  });
}
