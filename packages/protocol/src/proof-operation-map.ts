import type { VerificationPlan } from "./change-impact.js";
import type {
  ChangeProofExecutionConfirmationReceipt,
  ChangeProofExecutionHumanInterventionEvidence,
  ChangeProofExecutionPreview,
  ChangeProofExecutionSummary,
  ChangeProofRunHumanEvidenceInput,
  ChangeProofRunInput,
  ChangeProofRunOutput,
} from "./change-proof-execution.js";
import type { ChangeVerification } from "./change-verification.js";
import type { ProofSetupIntent, ProofSetupPreview } from "./proof-setup.js";

export type ProofOperationMap = {
  "proof.setup.inspect": {
    input: { baseRef?: string };
    output: unknown;
  };
  "proof.setup.preview": { input: ProofSetupIntent; output: ProofSetupPreview };
  "proof.setup.apply": {
    input: ProofSetupPreview & { confirm: true };
    output: {
      preview: ProofSetupPreview;
      registeredBuild: { id: string; sourceSha: string; sourceSha256: string; status: "ready" };
      plan: VerificationPlan;
      blockers: readonly string[];
    };
  };
  "proof.run": { input: ChangeProofRunInput; output: ChangeProofRunOutput };
  "proof.run.confirm": {
    input: {
      proofId: string;
      expectedVersion: number;
      cellId: string;
      previewDigest: string;
      fixtureScope?: {
        targetCaseId: string;
        targetProfileId: string;
        cleanupCheckIds: readonly string[];
      };
      ttlMs?: number;
      confirm: true;
    };
    output: {
      proofId: string;
      preview: ChangeProofExecutionPreview;
      receipt: ChangeProofExecutionConfirmationReceipt;
    };
  };
  "proof.run.human-evidence": {
    input: ChangeProofRunHumanEvidenceInput;
    output: {
      proof: ChangeVerification;
      execution: ChangeProofExecutionSummary;
      evidence: ChangeProofExecutionHumanInterventionEvidence;
    };
  };
};
