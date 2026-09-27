import {
  createAgentDebugRecordingProductService,
  type AgentDebugRecordingProductService,
} from "@relay/product/agent-debug-recording";
import type { DebugBugOutcomeIntent } from "@relay/workflows/types";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";

type AgentDebugStartIntent = Extract<DebugBugOutcomeIntent, { action: "start" }>;
export type AgentDebugProductService = AgentDebugRecordingProductService;

export function createAgentDebugProductService(platform: Platform): AgentDebugProductService {
  let runtimePromise: Promise<AgentDebugRecordingProductService> | undefined;
  const runtime = () =>
    (runtimePromise ??= productClientForPlatform(platform).then(({ client, actorId }) =>
      createAgentDebugRecordingProductService(client, { actorId }),
    ));
  return {
    async debugBug(intent) {
      return (await runtime()).debugBug(intent as AgentDebugStartIntent);
    },
  };
}
