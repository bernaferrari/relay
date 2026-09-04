import type { DebugBugOutcome, DebugBugOutcomeIntent } from "@relay/workflows/types";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

type AgentDebugStartIntent = Extract<DebugBugOutcomeIntent, { action: "start" }>;
type AgentDebugStartOutcome = Extract<DebugBugOutcome, { action: "start" }>;

/** Browser-safe UI adapter for Agent Debug's recording entry point. The full
 * outcome facade also includes offline Proof analysis, which must not enter
 * the renderer dependency graph. */
export type AgentDebugProductService = {
  debugBug(intent: AgentDebugStartIntent): Promise<AgentDebugStartOutcome>;
};

export function createAgentDebugProductService(platform: Platform): AgentDebugProductService {
  let runtimePromise:
    | Promise<{
        actorId: string;
        jobs: ReturnType<
          (typeof import("@relay/workflows/recording-outcomes"))["createRelayRecordingOutcomeJobs"]
        >;
        startDebugBugRecording: (typeof import("@relay/workflows/recording-outcomes"))["startDebugBugRecording"];
      }>
    | undefined;
  const runtime = () =>
    (runtimePromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/workflows/recording-outcomes"),
    ]).then(([{ client, actorId }, outcomes]) => ({
      actorId,
      jobs: outcomes.createRelayRecordingOutcomeJobs(client, { actorId }),
      startDebugBugRecording: outcomes.startDebugBugRecording,
    })));
  return {
    async debugBug(intent) {
      const { actorId, jobs, startDebugBugRecording } = await runtime();
      return startDebugBugRecording(jobs, actorId, intent);
    },
  };
}
