import { canonicalSha256, currentOperationContext } from "@relay/core";
import type {
  ChangeProofExecutionConsumedReceipt,
  EvidenceCollectionPolicy,
  OfflineTestPreflightReport,
} from "@relay/protocol";
import { HttpError } from "./http.js";
import { frozenProofEvidencePolicy } from "./proof-evidence-policy-authority.js";

export type AppMapProofExecutionAuthority = {
  executionRiskDigest: string;
  evidencePolicyDigest: string;
  confirmationReceipt?: ChangeProofExecutionConsumedReceipt;
  humanInterventionEvidence?: {
    schemaVersion: 1;
    executionId: string;
    proofId: string;
    cellId: string;
    stepId: string;
    evidenceDigest: string;
    recordedBy: string;
    recordedAt: number;
    requestId: string;
  };
};

/**
 * Validate the proof-only confirmation membrane after the offline Test
 * preflight. This helper deliberately has no target, lease, or enqueue access;
 * the caller remains responsible for admission ordering.
 */
export function appMapProofExecutionAdmission(input: {
  authority?: AppMapProofExecutionAuthority;
  preflight: OfflineTestPreflightReport;
}): EvidenceCollectionPolicy | undefined {
  const authority = input.authority;
  const proofEvidencePolicy = authority
    ? frozenProofEvidencePolicy(authority.evidencePolicyDigest)
    : undefined;
  if (!authority) return proofEvidencePolicy;

  const actualRiskDigest = canonicalSha256(input.preflight.executionRisk);
  if (actualRiskDigest !== authority.executionRiskDigest) {
    throw new HttpError(409, "Proof cell execution risk no longer matches its frozen authority", {
      code: "PROOF_EXECUTION_AUTHORITY_MISMATCH",
      expectedExecutionRiskDigest: authority.executionRiskDigest,
      actualRiskDigest,
      recovery:
        "Recompile the exact Test revision and review its execution authority before retrying the Proof.",
    });
  }

  const confirmationReceipt = authority.confirmationReceipt;
  const needsConfirmation =
    input.preflight.executionRisk.level !== "safe" ||
    input.preflight.executionRisk.confirmation !== "none";
  if (input.preflight.executionRisk.level === "prohibited") {
    throw new HttpError(409, "Proof execution is prohibited by its frozen authority", {
      code: "PROOF_CONFIRMATION_PROHIBITED",
      level: input.preflight.executionRisk.level,
      confirmation: input.preflight.executionRisk.confirmation,
      recovery: "Review the Test's external effects and compile a permitted Proof plan.",
    });
  }

  const humanInterventionEvidence = authority.humanInterventionEvidence;
  if (
    input.preflight.executionRisk.confirmation === "human-only" &&
    (!humanInterventionEvidence ||
      !humanInterventionEvidence.executionId.trim() ||
      !humanInterventionEvidence.proofId.trim() ||
      !humanInterventionEvidence.cellId.trim() ||
      !humanInterventionEvidence.stepId.trim() ||
      !humanInterventionEvidence.recordedBy.trim() ||
      !humanInterventionEvidence.requestId.trim() ||
      !/^sha256:[0-9a-f]{64}$/u.test(humanInterventionEvidence.evidenceDigest))
  ) {
    throw new HttpError(409, "Proof execution pauses for a human-only step", {
      code: "PROOF_CONFIRMATION_HUMAN_ONLY",
      level: input.preflight.executionRisk.level,
      confirmation: input.preflight.executionRisk.confirmation,
      recovery: "Complete the human-only step, then record its evidence before continuing.",
    });
  }
  if (needsConfirmation && !confirmationReceipt) {
    throw new HttpError(409, "Proof execution requires an exact confirmation receipt", {
      code: "PROOF_CONFIRMATION_REQUIRED",
      level: input.preflight.executionRisk.level,
      confirmation: input.preflight.executionRisk.confirmation,
      recovery: "Review the frozen Proof preview and submit its unexpired cell receipt.",
    });
  }
  if (!needsConfirmation && confirmationReceipt) {
    throw new HttpError(409, "Safe Proof execution cannot consume a confirmation receipt", {
      code: "PROOF_CONFIRMATION_INVALID",
    });
  }
  if (confirmationReceipt) {
    const operationActor = currentOperationContext()?.actorId;
    if (
      confirmationReceipt.actorId !== operationActor ||
      confirmationReceipt.action !== "proof.run" ||
      confirmationReceipt.expiresAt <= Date.now()
    ) {
      throw new HttpError(409, "Proof confirmation receipt is stale or actor-mismatched", {
        code: "PROOF_CONFIRMATION_EXPIRED",
        recovery: "Review a fresh Proof preview and issue a new receipt for this actor.",
      });
    }
    if (
      input.preflight.executionRisk.level === "destructive" &&
      (!confirmationReceipt.fixtureScope || !input.preflight.executionRisk.cleanupRequired)
    ) {
      throw new HttpError(409, "Destructive Proof execution requires fixture cleanup scope", {
        code: "PROOF_CONFIRMATION_INVALID",
        recovery: "Select the reviewed fixture and include its cleanup authority.",
      });
    }
  }
  return proofEvidencePolicy;
}
