import type { OperationId } from "@relay/protocol";

export type CliExclusionReason = "ui-only" | "internal" | "unsafe";

export type CommandBehavior = "event-stream" | "job-start-watch" | "job-watch" | "screenshot";

export type CommandArgumentHelp = {
  name: string;
  type: string;
  description: string;
};

export type CommandInputHelp = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

export type CommandHelp = {
  summary?: string;
  argumentHelp?: readonly CommandArgumentHelp[];
  inputHelp?: readonly CommandInputHelp[];
  examples?: readonly string[];
  note?: string;
  behavior?: CommandBehavior;
};

export type CommandPathDescriptor = {
  command: string;
  arguments?: readonly string[];
  fixedInput?: Readonly<Record<string, unknown>>;
} & CommandHelp;

export type MappedOperationDescriptor = {
  operationId: OperationId;
  paths: readonly CommandPathDescriptor[];
};

export type ExcludedOperationDescriptor = {
  operationId: OperationId;
  exclusion: CliExclusionReason;
  reason: string;
};

export type CliOperationDescriptor = MappedOperationDescriptor | ExcludedOperationDescriptor;

export function commandPath(
  command: string,
  arguments_: readonly string[] = [],
  fixedInput?: Readonly<Record<string, unknown>>,
  help: CommandHelp = {},
): CommandPathDescriptor {
  return {
    command,
    ...(arguments_.length ? { arguments: arguments_ } : {}),
    ...(fixedInput ? { fixedInput } : {}),
    ...help,
  };
}

export function mappedOperation(
  operationId: OperationId,
  ...paths: readonly CommandPathDescriptor[]
): MappedOperationDescriptor {
  return { operationId, paths };
}
