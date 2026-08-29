import {
  changeProofProviderCheckSchema,
  changeProofPublicationReceiptSchema,
  parseChangeVerification,
  type ChangeProofPublicationReceipt,
} from "@relay/protocol";
import { canonicalSha256 } from "./canonical-json.js";
import { readControlStore, withControlStore } from "./collaboration-store.js";
import { providerCheckForStoredChangeProof } from "./change-proof-decision.js";
import { verifyDurableChangeVerification } from "./change-proof-integrity.js";
import type { ChangeVerificationScope } from "./change-verification-store.js";

export class ChangeProofPublicationConflictError extends Error {
  readonly code:
    | "PUBLICATION_IDENTITY_MISMATCH"
    | "PUBLICATION_TIME_REVERSED"
    | "PROOF_DECISION_REQUIRED"
    | "PROOF_CHECK_MISMATCH";

  constructor(code: ChangeProofPublicationConflictError["code"], message: string) {
    super(message);
    this.name = "ChangeProofPublicationConflictError";
    this.code = code;
  }
}

function checkDigest(check: unknown): `sha256:${string}` {
  return canonicalSha256(check);
}

function samePublication(
  left: ChangeProofPublicationReceipt,
  right: ChangeProofPublicationReceipt,
): boolean {
  return (
    left.proofVersion === right.proofVersion &&
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
    const rawVersions = store.changeVerificationVersions(proofId);
    if (!rawVersions.length) return [];
    const parsedVersions = rawVersions.map((value) => parseChangeVerification(value));
    const parsedProof = parsedVersions.at(-1)!;
    if (
      parsedProof.organizationId !== scope.organizationId ||
      parsedProof.projectId !== scope.projectId
    ) {
      return [];
    }
    const proofs = parsedVersions.map((value) => verifyDurableChangeVerification(value));
    const receipts = store
      .changeProofPublications(proofId, "github")
      .map((receipt) => changeProofPublicationReceiptSchema.parse(receipt));
    for (const receipt of receipts) {
      const candidates = proofs.filter(
        (proof) =>
          (receipt.proofVersion === undefined || proof.version === receipt.proofVersion) &&
          receipt.policyDigest === proof.policyDigest &&
          receipt.planDigest === proof.planDigest &&
          (proof.state === "superseded" || receipt.decisionDigest === proof.decisionDigest),
      );
      if (candidates.length !== 1) {
        throw new ChangeProofPublicationConflictError(
          "PROOF_CHECK_MISMATCH",
          "a durable Proof publication does not identify one exact verified Proof version",
        );
      }
      const proof = candidates[0]!;
      if (
        receipt.policyDigest !== proof.policyDigest ||
        receipt.planDigest !== proof.planDigest ||
        (proof.state !== "superseded" && receipt.decisionDigest !== proof.decisionDigest)
      ) {
        throw new ChangeProofPublicationConflictError(
          "PROOF_CHECK_MISMATCH",
          "a durable Proof publication does not retain the verified Proof digests",
        );
      }
    }
    return receipts;
  });
}

/** Append the safe acknowledgement returned by a provider. The Proof document
 * remains immutable; repeated payloads are idempotent and changed conclusions
 * retain a new receipt against the same provider check-run identity. */
export async function recordChangeProofPublication(
  input: ChangeVerificationScope & {
    proofId: string;
    proofVersion?: number;
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
    const rawProof = input.proofVersion
      ? store
          .changeVerificationVersions(input.proofId)
          .find(({ version }) => version === input.proofVersion)
      : store.changeVerification(input.proofId);
    if (!rawProof) throw new Error("Change Verification not found in this project");
    const parsedProof = parseChangeVerification(rawProof);
    if (
      parsedProof.organizationId !== input.organizationId ||
      parsedProof.projectId !== input.projectId
    ) {
      throw new Error("Change Verification not found in this project");
    }
    const proof = verifyDurableChangeVerification(parsedProof);
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
      proof.state === "superseded"
        ? "action-required"
        : proof.decision === "proved"
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
    const canonicalCheck = providerCheckForStoredChangeProof({
      proof,
      ...(check.detailsUrl ? { detailsUrl: check.detailsUrl } : {}),
    });
    for (const field of ["policyDigest", "planDigest", "decisionDigest"] as const) {
      if (check[field] !== undefined && check[field] !== proof[field]) {
        throw new ChangeProofPublicationConflictError(
          "PROOF_CHECK_MISMATCH",
          `a provider acknowledgement has an incorrect ${field}`,
        );
      }
    }
    const normalizedCheck = changeProofProviderCheckSchema.parse({
      ...check,
      policyDigest: proof.policyDigest,
      planDigest: proof.planDigest,
      ...(proof.decisionDigest ? { decisionDigest: proof.decisionDigest } : {}),
    });
    if (JSON.stringify(normalizedCheck) !== JSON.stringify(canonicalCheck)) {
      throw new ChangeProofPublicationConflictError(
        "PROOF_CHECK_MISMATCH",
        "a provider acknowledgement must retain Relay's exact stored Proof projection",
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
      proofVersion: proof.version,
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
      checkDigest: checkDigest(canonicalCheck),
      conclusion: check.conclusion,
      policyDigest: proof.policyDigest,
      planDigest: proof.planDigest,
      ...(proof.decisionDigest ? { decisionDigest: proof.decisionDigest } : {}),
    });
    if (latest && samePublication(latest, receipt)) return latest;
    if (!store.insertChangeProofPublication(receipt)) {
      throw new Error("Proof publication receipt could not be appended");
    }
    return receipt;
  });
}
