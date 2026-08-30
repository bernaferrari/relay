import type { RelayMcpToolDescriptor } from "./tools.js";

export declare const relayMcpPromptNames: {
  readonly mapAppSafely: "relay_map_this_app_safely";
  readonly repairFailedConnection: "relay_repair_this_failed_connection";
  readonly reviewTake: "relay_review_this_take";
  readonly planCombine: "relay_plan_this_combine";
  readonly authorGraphTest: "relay_author_this_graph_test";
  readonly verifyChange: "relay_verify_this_change";
};

export type RelayMcpPromptDescriptor = {
  readonly name: (typeof relayMcpPromptNames)[keyof typeof relayMcpPromptNames];
  readonly title: string;
  readonly description: string;
  readonly requiredOperationIds: readonly string[];
};

export declare const relayMcpPrompts: readonly RelayMcpPromptDescriptor[];
export declare function relayMcpPromptsForTools(
  tools: readonly Pick<RelayMcpToolDescriptor, "operationId">[],
): readonly RelayMcpPromptDescriptor[];
export declare function registerRelayPrompts(
  server: unknown,
  scope: { projectId: string },
  tools: readonly RelayMcpToolDescriptor[],
): void;
