import { createHash } from "node:crypto";
import {
  changeProofProviderCheckSchema,
  changeProofPublicationReceiptSchema,
  parseChangeVerification,
  type ChangeProofPublicationReceipt,
} from "@relay/protocol";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import type { ChangeVerificationScope } from "./change-verification-store.js";

export class ChangeProofPublicationConflictError extends Error {
  readonly code:
    | "PUBLICATION_IDENTITY_MISMATCH"
    | "PUBLICATION_TIME_REVERSED"
    | "PROOF_DECISION_REQUIRED";

  constructor(code: ChangeProofPublicationConflictError["code"], message: string) {
    super(message);
    this.name = "ChangeProofPublicationConflictError";
    this.code = code;
  }
}

function checkDigest(check: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(check), "utf8").digest("hex")}`;
}

function samePublication(
  left: ChangeProofPublicationReceipt,
  right: ChangeProofPublicationReceipt,
): boolean {
  return (
    left.checkDigest === right.checkDigest &&
    left.conclusion === right.conclusion &&
    left.htmlUrl === right.htmlUrl
  );
}

function assertFrozenIdentity(
  receipt: ChangeProofPublicationReceipt,
  expected: Omit<ChangeProofPublicationReceipt, "sequence" | "checkDigest" | "conclusion">,
): void {
  if (
    receipt.organizationId !== expected.organizationId ||
    receipt.projectId !== expected.projectId ||
    receipt.proofId !== expected.proofId ||
    receipt.provider !== expected.provider ||
    receipt.repository !== expected.repository ||
    receipt.headSha !== expected.headSha ||
    receipt.externalId !== expected.externalId ||
    receipt.checkRunId !== expected.checkRunId
  ) {
    throw new ChangeProofPublicationConflictError(
      "PUBLICATION_IDENTITY_MISMATCH",
      "a Proof publication cannot change provider, check, repository, or head identity",
    );
  }
}

export async function readChangeProofPublications(
  scope: ChangeVerificationScope,
  proofId: string,
): Promise<ChangeProofPublicationReceipt[]> {
  return readControlStore((store) => {
    const rawProof = store.changeVerification(proofId);
    if (!rawProof) return [];
    const proof = parseChangeVerification(rawProof);
    if (proof.organizationId !== scope.organizationId || proof.projectId !== scope.projectId) {
      return [];
    }
    return store
      .changeProofPublications(proofId, "github")
      .map((receipt) => changeProofPublicationReceiptSchema.parse(receipt));
  });
}

/** Append the safe acknowledgement returned by a provider. The Proof document
 * remains immutable; repeated payloads are idempotent and changed conclusions
 * retain a new receipt against the same provider check-run identity. */
export async function recordChangeProofPublication(
  input: ChangeVerificationScope & {
    proofId: string;
    repository: string;
    check: unknown;
    provider: "github";
    checkRunId: number;
    externalId: string;
    headSha: string;
    htmlUrl?: string;
    publishedAt: number;
  },
): Promise<ChangeProofPublicationReceipt> {
  const check = changeProofProviderCheckSchema.parse(input.check);
  return withControlStore((store) => {
    const rawProof = store.changeVerification(input.proofId);
    if (!rawProof) throw new Error("Change Verification not found in this project");
    const proof = parseChangeVerification(rawProof);
    if (proof.organizationId !== input.organizationId || proof.projectId !== input.projectId) {
      throw new Error("Change Verification not found in this project");
    }
    if (
      input.repository !== proof.change.repository ||
      input.headSha !== proof.change.headSha ||
      input.externalId !== proof.id ||
      check.headSha !== proof.change.headSha ||
      check.externalId !== proof.id
    ) {
      throw new ChangeProofPublicationConflictError(
        "PUBLICATION_IDENTITY_MISMATCH",
        "the provider acknowledgement does not identify this exact Proof head",
      );
    }
    const expectedConclusion =
      proof.decision === "proved"
        ? "success"
        : proof.decision === "rejected"
          ? "failure"
          : proof.decision === "needs-review" || proof.decision === "insufficient-evidence"
            ? "action-required"
            : undefined;
    if (!expectedConclusion || check.conclusion !== expectedConclusion) {
      throw new ChangeProofPublicationConflictError(
        "PROOF_DECISION_REQUIRED",
        "a completed provider check must match the Proof's deterministic terminal decision",
      );
    }

    const previous = store
      .changeProofPublications(proof.id, input.provider)
      .map((receipt) => changeProofPublicationReceiptSchema.parse(receipt));
    const latest = previous.at(-1);
    const identity = {
      schemaVersion: 1 as const,
      organizationId: input.organizationId,
      projectId: input.projectId,
      proofId: proof.id,
      provider: input.provider,
      repository: input.repository,
      headSha: input.headSha,
      externalId: input.externalId,
      checkRunId: input.checkRunId,
      ...(input.htmlUrl ? { htmlUrl: input.htmlUrl } : {}),
      publishedAt: input.publishedAt,
    };
    if (latest) {
      assertFrozenIdentity(latest, identity);
      if (input.publishedAt < latest.publishedAt) {
        throw new ChangeProofPublicationConflictError(
          "PUBLICATION_TIME_REVERSED",
          "Proof publication receipts cannot move backwards in time",
        );
      }
    }
    const receipt = changeProofPublicationReceiptSchema.parse({
      ...identity,
      sequence: (latest?.sequence ?? 0) + 1,
      checkDigest: checkDigest(check),
      conclusion: check.conclusion,
    });
    if (latest && samePublication(latest, receipt)) return latest;
    if (!store.insertChangeProofPublication(receipt)) {
      throw new Error("Proof publication receipt could not be appended");
    }
    return receipt;
  });
}
