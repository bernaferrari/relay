import {
  createChangeProofExecutionCoordinator,
  type ChangeProofExecutionCoordinator,
} from "@relay/core";
import type { ChangeProofTerminalPublisher } from "./change-proof-publication-worker.js";

export const defaultProofExecutionCoordinator = createChangeProofExecutionCoordinator();

const publicationCoordinators = new WeakMap<
  ChangeProofTerminalPublisher,
  Map<string, ChangeProofExecutionCoordinator>
>();

/** Keep one coordinator per publisher/details destination so active
 * cancellation and the frozen terminal publication intent survive across
 * route calls without leaking provider configuration into the core API. */
export function proofExecutionCoordinator(runtime?: {
  executionCoordinator?: ChangeProofExecutionCoordinator;
  publishTerminal?: ChangeProofTerminalPublisher;
  publicationDetailsUrl?: string;
}): ChangeProofExecutionCoordinator {
  if (runtime?.executionCoordinator) return runtime.executionCoordinator;
  if (!runtime?.publishTerminal) return defaultProofExecutionCoordinator;
  const detailsKey = runtime.publicationDetailsUrl ?? "";
  let byDetails = publicationCoordinators.get(runtime.publishTerminal);
  if (!byDetails) {
    byDetails = new Map();
    publicationCoordinators.set(runtime.publishTerminal, byDetails);
  }
  let coordinator = byDetails.get(detailsKey);
  if (!coordinator) {
    coordinator = createChangeProofExecutionCoordinator({
      publication: {
        provider: "github",
        ...(runtime.publicationDetailsUrl ? { detailsUrl: runtime.publicationDetailsUrl } : {}),
      },
    });
    byDetails.set(detailsKey, coordinator);
  }
  return coordinator;
}
