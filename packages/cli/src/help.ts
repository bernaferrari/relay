import {
  formatCommandUsage,
  mappedCommandDescriptors,
  operationLabel,
  type CommandPathDescriptor,
} from "./commands.js";
import { UsageError } from "./errors.js";

const familyGroups = [
  ["Journeys", ["journey", "screen", "connection"]],
  ["Authoring", ["session", "take"]],
  ["Targets", ["target", "action"]],
  ["Execution", ["collection", "run", "job", "schedule", "matrix"]],
  ["Workspace", ["discovery", "policy", "data", "workspace"]],
  ["Resources", ["project", "build", "device-pool", "lease", "generation", "system"]],
] as const;

const globalOptions = `Global options:
  --server <url>                    Relay server (env RELAY_URL)
  --organization <id>              Organization scope (env RELAY_ORGANIZATION_ID)
  --project <id>                   Project scope (env RELAY_PROJECT_ID)
  --credential-source <source>     none or env:NAME (env RELAY_CREDENTIAL_SOURCE)
  --actor <id>                     Actor identity (env RELAY_ACTOR_ID)
  --json | --ndjson                Machine-readable output
  --quiet                          Suppress stderr diagnostics
  --timeout <ms>                   Request timeout (env RELAY_TIMEOUT_MS)
  --wait | --no-wait               Wait policy (env RELAY_WAIT)`;

type FriendlyPath = {
  descriptor: CommandPathDescriptor;
  operationId: (typeof mappedCommandDescriptors)[number]["operationId"];
};

function friendlyPaths(): FriendlyPath[] {
  return mappedCommandDescriptors.flatMap(({ operationId, paths }) =>
    paths.map((descriptor) => ({ descriptor, operationId })),
  );
}

function familyNames(): Set<string> {
  return new Set(friendlyPaths().map(({ descriptor }) => descriptor.command.split(" ")[0]!));
}

function usages(commands: readonly string[]): string[] {
  const selected = new Set(commands);
  return friendlyPaths()
    .filter(({ descriptor }) => selected.has(descriptor.command))
    .map(({ descriptor }) => `  relay ${formatCommandUsage(descriptor)}`);
}

function renderRootHelp(): string {
  const available = familyNames();
  const groups = familyGroups
    .map(([label, families]) => {
      const present = families.filter((family) => available.has(family));
      return present.length ? `  ${label.padEnd(11)} ${present.join(", ")}` : undefined;
    })
    .filter((line): line is string => line !== undefined)
    .join("\n");
  const workflowCommands = [
    "target screenshot",
    "session create",
    "session start",
    "session screenshot",
    "session stop",
    "take trim",
    "take reorder",
    "take replay",
    "session commit",
    "session discard",
    "screen list",
    "screen update",
    "connection list",
    "connection update",
  ];

  return `Relay — server-first operation client

Usage:
  relay <family> <command> [arguments] [--input <json>] [global options]
  relay operation invoke <operationId> --input <json> [global options]
  relay <family> --help

Command families:
${groups}

Target and authoring workflows:
${usages(workflowCommands).join("\n")}

Screen and connection commands are aliases for Journey document operations.

${globalOptions}

Friendly commands default --input to '{}'. Explicit path arguments such as <serial> and <sessionId>
are required where shown. Relay does not start a server automatically.
`;
}

function renderFamilyHelp(family: string): string {
  if (family === "operation") {
    return `Relay operation commands

Usage:
  relay operation invoke <operationId> --input <json> [global options]

Unlike friendly commands, operation invoke always requires --input.

${globalOptions}
`;
  }

  const paths = friendlyPaths().filter(
    ({ descriptor }) => descriptor.command.split(" ")[0] === family,
  );
  if (!paths.length) throw new UsageError(`Unknown command family: ${family}. Run 'relay help'.`);
  const commands = paths
    .map(
      ({ descriptor, operationId }) =>
        `  relay ${formatCommandUsage(descriptor)}\n      ${operationLabel(operationId)}`,
    )
    .join("\n");
  const aliasNote =
    family === "screen" || family === "connection"
      ? "\nThese commands are aliases for Journey document operations.\n"
      : "";

  return `Relay ${family} commands

Usage:
  relay ${family} <command> [arguments] [--input <json>] [global options]

Commands:
${commands}
${aliasNote}
Path arguments override the same fields in --input. Friendly commands default --input to '{}'.

${globalOptions}
`;
}

export function renderHelp(family?: string): string {
  return family ? renderFamilyHelp(family) : renderRootHelp();
}

export const HELP = renderHelp();
