import { canonicalSha256, getEvidenceCollectionPolicy } from "@relay/core";
import type { EvidenceCollectionPolicy } from "@relay/protocol";
import { HttpError } from "./http.js";

/** Freeze the exact active policy after matching the reviewed cell digest.
 * The returned snapshot is passed into the queued job so later settings
 * changes cannot alter evidence collection for this execution. */
export function frozenProofEvidencePolicy(expectedDigest: string): EvidenceCollectionPolicy {
  const policy = getEvidenceCollectionPolicy();
  const actualDigest = canonicalSha256(policy);
  if (actualDigest !== expectedDigest) {
    throw new HttpError(409, "Proof evidence policy no longer matches its frozen authority", {
      code: "PROOF_EVIDENCE_POLICY_MISMATCH",
      expectedEvidencePolicyDigest: expectedDigest,
      actualEvidencePolicyDigest: actualDigest,
      recovery: "Prepare and review a new Proof under the current privacy and evidence settings.",
    });
  }
  return policy;
}
