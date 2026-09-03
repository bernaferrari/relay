import type { ChangeVerification } from "@relay/protocol";
import { humanizeIdentifier } from "./humanize-identifier";

/**
 * Proof navigation is for choosing work, not inspecting database identity.
 * Exact repository and commit identities remain available in Technical details.
 */
export function proofDisplayTitle(proof: ChangeVerification): string {
  const claim = proof.change.agentClaim?.summary.trim();
  if (claim) return claim;
  if (proof.change.pullRequest) return `Pull request #${proof.change.pullRequest}`;

  const journey = proof.selection.affectedJourneys[0];
  if (journey) return humanizeIdentifier(journey.testId) ?? "Change proof";
  return "Change proof";
}
