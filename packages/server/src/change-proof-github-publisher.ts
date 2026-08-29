import {
  providerCheckForStoredChangeProof,
  readChangeProofPublications,
  readChangeVerification,
  readChangeVerificationHistory,
  recordChangeProofPublication,
  type ChangeVerificationScope,
} from "@relay/core";
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
    config: GitHubProofCheckConfig;
    detailsUrl?: string;
    fetchImpl?: typeof fetch;
    now?: () => number;
  },
) {
  const proof = input.proofVersion
    ? (await readChangeVerificationHistory(input, input.proofId)).find(
        ({ version }) => version === input.proofVersion,
      )
    : await readChangeVerification(input, input.proofId);
  if (!proof) throw new ProofCheckPublishError("Change Verification not found in this project");
  const repository = exactRepository(input.config);
  if (repository !== proof.change.repository) {
    throw new ProofCheckPublishError(
      "Configured GitHub repository does not match the exact Proof repository",
    );
  }
  const check = providerCheckForStoredChangeProof({
    proof,
    ...(input.detailsUrl ? { detailsUrl: input.detailsUrl } : {}),
  });
  const previous = (await readChangeProofPublications(input, proof.id)).at(-1);
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
    proofVersion: proof.version,
    repository,
    check,
    provider: published.provider,
    checkRunId: published.checkRunId,
    externalId: published.externalId,
    headSha: published.headSha,
    ...(published.htmlUrl ? { htmlUrl: published.htmlUrl } : {}),
    publishedAt: (input.now ?? Date.now)(),
  });
  return { check, published, receipt };
}
