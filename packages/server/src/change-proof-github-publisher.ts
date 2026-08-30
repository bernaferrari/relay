import {
  providerCheckForStoredChangeProof,
  canonicalSha256,
  readChangeProofPublications,
  readChangeVerification,
  readChangeVerificationHistory,
  recordChangeProofPublication,
  type ChangeVerificationScope,
} from "@relay/core";
import {
  changeProofPublicationIntentSchema,
  changeTestedSha,
  type ChangeProofPublicationIntent,
} from "@relay/protocol";
import {
  ProofCheckPublishError,
  publishGitHubProofCheck,
  type GitHubProofCheckConfig,
  type PublishedProofCheck,
} from "./github-proof-check.js";

function exactRepository(config: GitHubProofCheckConfig): string {
  return `${config.owner.trim()}/${config.repository.trim()}`;
}

/** Publish the stored terminal Proof through the configured GitHub boundary,
 * update an already acknowledged check in place, then append its token-free
 * provider receipt to Relay's control store. */
export async function publishChangeProofToGitHub(
  input: ChangeVerificationScope & {
    proofId: string;
    proofVersion?: number;
    /** The outbox supplies the complete frozen provider request. Mutable
     * process configuration may provide credentials and the endpoint only;
     * it must not rewrite this identity or check. */
    intent?: ChangeProofPublicationIntent;
    config: GitHubProofCheckConfig;
    detailsUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  },
) {
  const intent = input.intent ? changeProofPublicationIntentSchema.parse(input.intent) : undefined;
  if (
    intent &&
    (intent.organizationId !== input.organizationId ||
      intent.projectId !== input.projectId ||
      intent.proofId !== input.proofId ||
      (input.proofVersion !== undefined && intent.proofVersion !== input.proofVersion))
  ) {
    throw new ProofCheckPublishError(
      "The frozen Proof publication intent does not match the requested Proof",
    );
  }
  const proof = input.proofVersion
    ? (await readChangeVerificationHistory(input, input.proofId)).find(
        ({ version }) => version === input.proofVersion,
      )
    : await readChangeVerification(input, input.proofId);
  if (!proof) throw new ProofCheckPublishError("Change Verification not found in this project");
  const repository = exactRepository(input.config);
  if (repository !== (intent?.repository ?? proof.change.repository)) {
    throw new ProofCheckPublishError(
      "Configured GitHub repository does not match the exact Proof repository",
    );
  }
  if (
    intent &&
    (proof.id !== intent.proofId ||
      proof.version !== intent.proofVersion ||
      proof.change.repository !== intent.repository ||
      changeTestedSha(proof.change) !== intent.headSha)
  ) {
    throw new ProofCheckPublishError(
      "The frozen Proof publication intent does not match the historical Proof",
    );
  }
  const check = intent
    ? intent.check
    : providerCheckForStoredChangeProof({
        proof,
        ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
      });
  const previousReceipts = await readChangeProofPublications(input, proof.id);
  const previous = intent
    ? previousReceipts
        .filter(
          (receipt) =>
            receipt.proofVersion === intent.proofVersion &&
            receipt.repository === intent.repository &&
            receipt.headSha === intent.headSha &&
            receipt.externalId === intent.externalId &&
            receipt.checkDigest === canonicalSha256(intent.check),
        )
        .at(-1)
    : previousReceipts.at(-1);
  const existing: PublishedProofCheck | undefined = previous
    ? {
        provider: "github",
        checkRunId: previous.checkRunId,
        externalId: previous.externalId,
        headSha: previous.headSha,
        ...(previous.htmlUrl ? { htmlUrl: previous.htmlUrl } : {}),
      }
    : undefined;
  const published = await publishGitHubProofCheck({
    check,
    config: input.config,
    ...(existing ? { existing } : {}),
    reconcileUnacknowledged: !existing,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const receipt = await recordChangeProofPublication({
    organizationId: input.organizationId,
    projectId: input.projectId,
    proofId: proof.id,
    proofVersion: intent?.proofVersion ?? proof.version,
    repository: intent?.repository ?? repository,
    check,
    provider: published.provider,
    checkRunId: published.checkRunId,
    externalId: intent?.externalId ?? published.externalId,
    headSha: intent?.headSha ?? published.headSha,
    ...(published.htmlUrl ? { htmlUrl: published.htmlUrl } : {}),
    publishedAt: (input.now ?? Date.now)(),
  });
  return { check, published, receipt };
}
