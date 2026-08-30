import { recoverChangeProofPublicationOutbox, readChangeVerificationHistory } from "@relay/core";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import { drainChangeProofPublicationOutbox } from "./change-proof-publication-worker.js";
import { publishChangeProofToGitHub } from "./change-proof-github-publisher.js";

export type ProofPublicationWorker = {
  recover: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

export function createProofPublicationWorker(
  runtime?: Partial<ChangeVerificationRouteRuntime>,
): ProofPublicationWorker {
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    const publishTerminal = runtime?.publishTerminal;
    if (!publishTerminal || running) return;
    running = true;
    try {
      await drainChangeProofPublicationOutbox({
        publish: publishTerminal,
        loadProof: async (record) => {
          const history = await readChangeVerificationHistory(
            { organizationId: record.organizationId, projectId: record.projectId },
            record.proofId,
          );
          return history.find(({ version }) => version === record.proofVersion);
        },
      });
    } catch (error) {
      console.warn(
        `Proof publication worker failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };

  return {
    recover: async () => {
      if (runtime?.publishTerminal) await recoverChangeProofPublicationOutbox();
    },
    start: () => {
      if (!runtime?.publishTerminal || timer) return;
      timer = setInterval(() => void run(), 5_000);
      timer.unref();
      void run();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

/** Resolve optional host-owned GitHub publication from process configuration. */
export function proofPublicationRuntimeFromEnvironment():
  | Partial<ChangeVerificationRouteRuntime>
  | undefined {
  const proofRepository = process.env.RELAY_GITHUB_REPOSITORY?.trim();
  const proofToken = process.env.RELAY_GITHUB_TOKEN?.trim();
  if (Boolean(proofRepository) !== Boolean(proofToken)) {
    throw new Error(
      "GitHub Proof publication requires both RELAY_GITHUB_REPOSITORY and RELAY_GITHUB_TOKEN",
    );
  }
  const repositoryParts = proofRepository?.split("/") ?? [];
  if (proofRepository && (repositoryParts.length !== 2 || repositoryParts.some((part) => !part))) {
    throw new Error("RELAY_GITHUB_REPOSITORY must be exactly owner/repository");
  }
  const proofDetailsUrl = process.env.RELAY_PROOF_DETAILS_URL?.trim();
  return proofRepository && proofToken
    ? {
        ...(proofDetailsUrl ? { publicationDetailsUrl: proofDetailsUrl } : {}),
        publishTerminal: async ({ scope, intent }) => {
          await publishChangeProofToGitHub({
            ...scope,
            proofId: intent.proofId,
            proofVersion: intent.proofVersion,
            intent,
            config: {
              owner: repositoryParts[0]!,
              repository: repositoryParts[1]!,
              token: proofToken,
            },
          });
        },
      }
    : undefined;
}
