import { canonicalSha256 } from "@relay/core";
import {
  materializeChangeRef,
  type ChangeVerification,
  type OperationInput,
} from "@relay/protocol";

export function proofRequestDigest(proofId: string | undefined, body: unknown): `sha256:${string}` {
  return canonicalSha256(proofId ? { proofId, body } : body);
}

/** `wait` only controls how long the HTTP request stays attached. It is not
 * part of the durable execution intent, so detaching cannot create a second
 * Proof execution identity. */
export function proofRunRequestDigest(
  proofId: string,
  body: Pick<OperationInput<"proof.run">, "expectedVersion" | "confirmationReceipts">,
): `sha256:${string}` {
  return canonicalSha256({
    proofId,
    expectedVersion: body.expectedVersion ?? null,
    confirmationReceipts: body.confirmationReceipts ?? [],
  });
}

export function sameProofStartIntent(
  proof: ChangeVerification,
  actorId: string,
  body: OperationInput<"proof.start">,
): boolean {
  return (
    proof.requestedBy === actorId &&
    canonicalSha256(materializeChangeRef(proof.change)) ===
      canonicalSha256(materializeChangeRef(body.change)) &&
    JSON.stringify(proof.builds) === JSON.stringify(body.builds ?? []) &&
    JSON.stringify(proof.selection) ===
      JSON.stringify(body.selection ?? { affectedJourneys: [], targetCases: [] }) &&
    JSON.stringify(proof.policy) === JSON.stringify(body.policy) &&
    JSON.stringify(proof.coverageGaps) === JSON.stringify(body.coverageGaps ?? []) &&
    JSON.stringify(proof.residualRisk) === JSON.stringify(body.residualRisk ?? []) &&
    JSON.stringify(proof.smallestNextVerification) === JSON.stringify(body.smallestNextVerification)
  );
}
