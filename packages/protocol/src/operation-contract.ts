export type OperationMode = "query" | "command" | "stream";
export type OperationIdempotency = "none" | "optional" | "required" | "inherent";
export type OperationConfirmation = "none" | "confirm" | "dangerous";

export const projectRoles = ["viewer", "author", "runner", "admin"] as const;
export type ProjectRole = (typeof projectRoles)[number];

const projectRoleRank: Record<ProjectRole, number> = {
  viewer: 0,
  author: 1,
  runner: 2,
  admin: 3,
};

export function projectRoleAllows(actual: ProjectRole, required: ProjectRole): boolean {
  return projectRoleRank[actual] >= projectRoleRank[required];
}

export type OperationCategory =
  | "system"
  | "target"
  | "authoring"
  | "execution"
  | "evidence"
  | "workspace"
  | "discovery";

export type RuntimeParser<T> = {
  readonly description: string;
  parse(value: unknown): T;
};

/**
 * One input contract serves programmatic callers, the HTTP boundary, and agent
 * presentation. Adapters may add transport-only fields (for example MCP's
 * confirmation bit), but they may not maintain a second operation schema.
 */
export type OperationInputContract<T> = RuntimeParser<T> & {
  readonly presentation: z.ZodObject;
};

export type OperationTransport = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
};

export type OperationDefinition<Id extends string = string, Input = unknown, Output = unknown> = {
  id: Id;
  version: 1;
  label: string;
  category: OperationCategory;
  mode: OperationMode;
  input: OperationInputContract<Input>;
  output: RuntimeParser<Output>;
  idempotency: OperationIdempotency;
  targetCapabilities: readonly string[];
  lease: "none" | "shared" | "exclusive";
  confirmation: OperationConfirmation;
  /** Lowest project role allowed to invoke this operation. */
  minimumRole: ProjectRole;
  progress: boolean;
  cancellable: boolean;
  transport: OperationTransport;
};

export type OperationRecord = Record<string, unknown>;
import type * as z from "zod/v4";
