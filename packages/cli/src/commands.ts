import { operationDefinitions, type OperationId } from "@relay/protocol";
import {
  type CommandBehavior,
  type CommandPathDescriptor,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { UsageError } from "./errors.js";
import { closestMatch } from "./cli-suggest.js";
import { cliResourceDescriptors } from "./resource-commands.js";
import { cliOperationDescriptors } from "./cli-operation-descriptors.js";
export { cliOperationDescriptors } from "./cli-operation-descriptors.js";

export type {
  CliExclusionReason,
  CliOperationDescriptor,
  CommandArgumentHelp,
  CommandBehavior,
  CommandHelp,
  CommandInputHelp,
  CommandPathDescriptor,
  ExcludedOperationDescriptor,
  MappedOperationDescriptor,
} from "./command-descriptors.js";

/**
 * The canonical human CLI vocabulary. This is routing metadata only: it may
 * construct an operation input, but it must never implement domain behavior.
 * Keep each registry operation in exactly one descriptor; aliases belong in
 * that descriptor's paths array.
 */
export { cliResourceDescriptors, type CliResourceDescriptor } from "./resource-commands.js";

export const mappedCommandDescriptors = cliOperationDescriptors.filter(
  (descriptor): descriptor is MappedOperationDescriptor => "paths" in descriptor,
);

const operationById = new Map(
  operationDefinitions.map((definition) => [definition.id, definition]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
  }
  return result;
}

function setInputPath(input: Record<string, unknown>, keyPath: string, value: string): void {
  const keys = keyPath.split(".");
  let current = input;
  for (const key of keys.slice(0, -1)) {
    const existing = current[key];
    const next = isRecord(existing) ? { ...existing } : {};
    current[key] = next;
    current = next;
  }
  current[keys.at(-1)!] = value;
}

export type ResolvedCommand = {
  operationId: OperationId;
  commandPath: string;
  input: Record<string, unknown>;
  behavior?: CommandBehavior;
};

export type ResolvedResourceCommand = {
  resourceId: string;
  commandPath: string;
  resourcePath: string;
};

export function resolveCommand(
  positionals: readonly string[],
  input: Readonly<Record<string, unknown>> = {},
  options: { laneSelected?: boolean } = {},
): ResolvedCommand {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const tokens = candidate.command.split(" ");
      const argumentKeys = candidate.arguments ?? [];
      const laneFillsSerial =
        options.laneSelected === true &&
        argumentKeys[0] === "serial" &&
        !positionals[tokens.length];
      if (positionals.length !== tokens.length + argumentKeys.length - (laneFillsSerial ? 1 : 0))
        continue;
      if (!tokens.every((token, index) => positionals[index] === token)) continue;

      let constructed = mergeRecords({}, input);
      if (candidate.fixedInput) constructed = mergeRecords(constructed, candidate.fixedInput);
      if (laneFillsSerial) {
        argumentKeys.slice(1).forEach((key, index) => {
          setInputPath(constructed, key, positionals[tokens.length + index]!);
        });
      } else {
        argumentKeys.forEach((key, index) => {
          setInputPath(constructed, key, positionals[tokens.length + index]!);
        });
      }
      return {
        operationId: descriptor.operationId,
        commandPath: candidate.command,
        input: constructed,
        ...(candidate.behavior ? { behavior: candidate.behavior } : {}),
      };
    }
  }

  const incomplete = mappedCommandDescriptors
    .flatMap((descriptor) => descriptor.paths)
    .map((candidate) => ({ candidate, tokens: candidate.command.split(" ") }))
    .filter(({ tokens }) => tokens.every((token, index) => positionals[index] === token))
    .sort((left, right) => right.tokens.length - left.tokens.length)[0];
  if (incomplete) {
    const argumentKeys = incomplete.candidate.arguments ?? [];
    const providedArguments = Math.max(0, positionals.length - incomplete.tokens.length);
    // With --lane selected the serial positional is optional for the
    // Lane-aware operations; the server fills it from the saved Lane.
    const laneOptionalSerial =
      options.laneSelected === true && argumentKeys[0] === "serial" && providedArguments === 0;
    const missingArguments = laneOptionalSerial ? [] : argumentKeys.slice(providedArguments);
    if (missingArguments.length) {
      const required = missingArguments
        .map((key, index) => {
          const help = incomplete.candidate.argumentHelp?.[providedArguments + index];
          return `<${help?.name ?? key.split(".").at(-1)}>`;
        })
        .join(", ");
      throw new UsageError(`${incomplete.candidate.command} requires ${required}`);
    }
    throw new UsageError(`Expected: relay ${formatCommandUsage(incomplete.candidate)}`);
  }

  const family = positionals[0];
  const familyPaths = mappedCommandDescriptors.flatMap((descriptor) =>
    descriptor.paths.filter((candidate) => candidate.command.split(" ")[0] === family),
  );
  if (familyPaths.length) {
    const sessionLoop = new Set([
      "session begin",
      "session tap",
      "session stop",
      "session replay",
      "session commit",
    ]);
    const ordered =
      family === "session"
        ? [
            ...familyPaths.filter((candidate) => sessionLoop.has(candidate.command)),
            ...familyPaths.filter((candidate) => !sessionLoop.has(candidate.command)),
          ]
        : familyPaths;
    const usages = ordered
      .slice(0, 5)
      .map((candidate) => formatCommandUsage(candidate))
      .join(", ");
    throw new UsageError(
      `Invalid ${family} command. Expected one of: ${usages}. Run 'relay ${family} --help' for the full list.`,
    );
  }
  const suggestion = family ? closestMatch(family, knownFamilies()) : undefined;
  throw new UsageError(
    `Unknown command: ${positionals.join(" ")}.${suggestion ? ` Did you mean 'relay ${suggestion}'?` : ""} Run 'relay help'.`,
  );
}

/** Top-level words people type (the everyday verbs, then the extras root
 * help lists under "Also"); used only for "did you mean" suggestions. */
const everydayWords = [
  "new",
  "apply",
  "show",
  "run",
  "ci",
  "apps",
  "tests",
  "runs",
  "devices",
  "guide",
  "record",
  "connect",
  "observe",
  "inspect",
  "review",
  "export",
  "doctor",
];

function knownFamilies(): Set<string> {
  return new Set([
    ...everydayWords,
    ...mappedCommandDescriptors.flatMap((descriptor) =>
      descriptor.paths.map((candidate) => candidate.command.split(" ")[0]!),
    ),
    ...cliResourceDescriptors.map((descriptor) => descriptor.path.command.split(" ")[0]!),
  ]);
}

/**
 * Some words are both a command family and an everyday verb (`run`, `connect`).
 * A family subcommand typed with the wrong arguments (`run watch`) or slightly
 * misspelled (`run lsit`, `connect lst`) must fail here instead of falling
 * through to the verb, which would treat the word as a Test or Device name.
 * Returns "exact" when the subcommand exists, so the caller rethrows the
 * registry's own usage error.
 */
export function familySubcommandMistake(
  positionals: readonly string[],
): "exact" | UsageError | undefined {
  const [family, second] = positionals;
  if (!family || !second) return undefined;
  const subcommands = new Set(
    [
      ...mappedCommandDescriptors.flatMap((descriptor) =>
        descriptor.paths.map((candidate) => candidate.command),
      ),
      ...cliResourceDescriptors.map((descriptor) => descriptor.path.command),
    ]
      .map((command) => command.split(" "))
      .filter((tokens) => tokens.length > 1 && tokens[0] === family)
      .map((tokens) => tokens[1]!),
  );
  if (!subcommands.size) return undefined;
  if (subcommands.has(second)) return "exact";
  if (!/^[a-z][a-z-]*$/u.test(second)) return undefined;
  const suggestion = closestMatch(second, subcommands, { substring: false });
  if (!suggestion) return undefined;
  return new UsageError(
    `Unknown '${family}' command: ${second}. Did you mean 'relay ${family} ${suggestion}'? ` +
      `Run 'relay ${family} --help' for the list.` +
      (family === "run"
        ? ` To run a Test with this name, use 'relay test run <app> ${second}'.`
        : ""),
  );
}

export function resolveResourceCommand(
  positionals: readonly string[],
  input: Readonly<Record<string, unknown>> = {},
): ResolvedResourceCommand | undefined {
  for (const descriptor of cliResourceDescriptors) {
    const candidate = descriptor.path;
    const tokens = candidate.command.split(" ");
    const argumentKeys = candidate.arguments ?? [];
    if (positionals.length !== tokens.length + argumentKeys.length) continue;
    if (!tokens.every((token, index) => positionals[index] === token)) continue;

    const constructed = mergeRecords({}, input);
    argumentKeys.forEach((key, index) => {
      setInputPath(constructed, key, positionals[tokens.length + index]!);
    });
    return {
      resourceId: descriptor.resourceId,
      commandPath: candidate.command,
      resourcePath: descriptor.resourcePath(constructed),
    };
  }

  const incomplete = cliResourceDescriptors
    .map((descriptor) => ({ descriptor, tokens: descriptor.path.command.split(" ") }))
    .filter(({ tokens }) => tokens.every((token, index) => positionals[index] === token))
    .sort((left, right) => right.tokens.length - left.tokens.length)[0];
  if (incomplete) {
    const argumentKeys = incomplete.descriptor.path.arguments ?? [];
    const providedArguments = Math.max(0, positionals.length - incomplete.tokens.length);
    const missingArguments = argumentKeys.slice(providedArguments);
    if (missingArguments.length) {
      const required = missingArguments
        .map((key, index) => {
          const help = incomplete.descriptor.path.argumentHelp?.[providedArguments + index];
          return `<${help?.name ?? key.split(".").at(-1)}>`;
        })
        .join(", ");
      throw new UsageError(`${incomplete.descriptor.path.command} requires ${required}`);
    }
  }
  return undefined;
}

export function formatCommandUsage(descriptor: CommandPathDescriptor): string {
  const arguments_ = (descriptor.arguments ?? [])
    .map((key, index) => `<${descriptor.argumentHelp?.[index]?.name ?? key.split(".").at(-1)}>`)
    .join(" ");
  return `${descriptor.command}${arguments_ ? ` ${arguments_}` : ""}`;
}

export function operationLabel(operationId: OperationId): string {
  return operationById.get(operationId)?.label ?? operationId;
}
