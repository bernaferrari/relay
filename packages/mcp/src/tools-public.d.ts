export type RelayMcpProfile =
  | "operator"
  | "outcome"
  | "qa"
  | "control"
  | "map"
  | "observe"
  | "author"
  | "test"
  | "run"
  | "locale"
  | "review"
  | "admin"
  | "proof"
  | "full";

export type RelayMcpToolAnnotations = {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
};

export type RelayMcpToolDescriptor = {
  readonly name: `relay_${string}`;
  readonly operationId: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: RelayMcpToolAnnotations;
  readonly requiresConfirmation: boolean;
  readonly inputSchema: unknown;
};

export declare const relayMcpProfiles: readonly RelayMcpProfile[];
export declare const defaultRelayMcpProfile: RelayMcpProfile;
export declare function relayToolName(operationId: string): `relay_${string}`;
export declare const relayMcpTools: readonly RelayMcpToolDescriptor[];
export declare function relayMcpToolsForProfile(
  profile?: RelayMcpProfile,
): readonly RelayMcpToolDescriptor[];
export type RelayMcpOperationCatalogEntry = {
  readonly operationId: string;
  readonly task: string;
  readonly role: string;
  readonly confirmation: string;
  readonly capabilities?: readonly string[];
  readonly profiles: readonly RelayMcpProfile[];
};
export declare function relayMcpOperationCatalog(): readonly RelayMcpOperationCatalogEntry[];
export declare function assertRelayMcpToolParity(tools?: readonly RelayMcpToolDescriptor[]): void;
