import type { RelayMcpToolDescriptor } from "./tools.js";

export declare const relayMcpPromptNames: {
  readonly verifyChange: "relay_prove_this_change";
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
