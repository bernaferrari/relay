import type { DebugBugOutcome, DebugBugOutcomeIntent, RelayInvokeClient } from "@relay/workflows";
import {
  createRelayRecordingOutcomeJobs,
  startDebugBugRecording,
} from "@relay/workflows/recording-outcomes";

export type AgentDebugRecordingProductService = {
  readonly debugBug: (
    intent: Extract<DebugBugOutcomeIntent, { action: "start" }>,
  ) => Promise<Extract<DebugBugOutcome, { action: "start" }>>;
};

/** Browser-safe Agent Debug entry point for renderers that only start a
 * recording. The product boundary owns workflow construction so UI adapters
 * do not assemble domain jobs themselves. */
export function createAgentDebugRecordingProductService(
  client: RelayInvokeClient,
  options: { readonly actorId: string },
): AgentDebugRecordingProductService {
  if (!options.actorId.trim()) throw new TypeError("Agent Debug requires an actor identity.");
  const jobs = createRelayRecordingOutcomeJobs(client, options);
  return {
    debugBug: (intent) => startDebugBugRecording(jobs, options.actorId, intent),
  };
}
