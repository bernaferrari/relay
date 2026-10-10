import type { ServerConnection } from "./server.js";

export type CredentialSource = { type: "none" } | { type: "env"; name: string };

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

export type McpConfig = {
  connection: ServerConnection;
  credentialSource: CredentialSource;
  timeoutMs: number;
  profile: RelayMcpProfile;
  runtime?: { workspaceRoot: string; port?: number };
};

export declare function parseMcpConfig(
  argv: readonly string[],
  env?: Record<string, string | undefined>,
  processId?: number,
): McpConfig;
export declare function redactedMcpConfig(config: McpConfig): Record<string, unknown>;
