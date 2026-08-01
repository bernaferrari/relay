import {
  cliResourceDescriptors,
  formatCommandUsage,
  mappedCommandDescriptors,
  operationLabel,
  type CommandPathDescriptor,
} from "./commands.js";
import { UsageError } from "./errors.js";

const familyGroups = [
  ["App Map", ["map", "screen", "connect", "flow"]],
  ["Create", ["proposal", "routine"]],
  ["Operate", ["device", "run", "activity"]],
  ["Automation", ["schedule", "matrix"]],
  ["Workspace", ["policy", "data", "workspace", "project", "build", "device-pool", "lease"]],
  ["System", ["generation", "system"]],
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
  --wait | --no-wait               Wait policy (env RELAY_WAIT)

Screenshot output:
  --file <path>                    Save screenshot PNG to a file
  --binary                         Write raw PNG bytes to stdout
  --force                          Overwrite an existing --file target`;

type FriendlyPath = {
  descriptor: CommandPathDescriptor;
  label: string;
};

function friendlyPaths(): FriendlyPath[] {
  return [
    ...mappedCommandDescriptors.flatMap(({ operationId, paths }) =>
      paths.map((descriptor) => ({ descriptor, label: operationLabel(operationId) })),
    ),
    ...cliResourceDescriptors.map(({ path: descriptor, label }) => ({ descriptor, label })),
  ];
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
    "map list",
    "map get",
    "screen list",
    "connect list",
    "flow run",
    "device list",
    "device screenshot",
    "proposal create",
    "proposal record",
    "proposal replay",
    "proposal accept",
    "run watch",
    "activity follow",
  ];

  return `Relay — App Maps for humans and agents

Usage:
  relay <family> <command> [arguments] [--input <json>] [global options]
  relay operation invoke <operationId> --input <json> [global options]
  relay <family> --help

Command families:
${groups}

Start here:
${usages(workflowCommands).join("\n")}

An App Map contains screens, connections, and named flows. Proposals turn live device
interactions into reviewable map changes. Every interface invokes the same Relay operations.

${globalOptions}

Friendly commands default --input to '{}'. Explicit path arguments such as <serial> and <sessionId>
are required where shown. Relay does not start a server automatically.
`;
}

function renderDetails(descriptor: CommandPathDescriptor): string {
  const lines: string[] = [];
  if (descriptor.argumentHelp?.length) {
    lines.push("      Arguments:");
    for (const argument of descriptor.argumentHelp) {
      lines.push(
        `        <${argument.name}> (${argument.type}, required)  ${argument.description}`,
      );
    }
  }
  if (descriptor.inputHelp?.length) {
    lines.push("      --input fields:");
    for (const field of descriptor.inputHelp) {
      lines.push(
        `        ${field.name} (${field.type}, ${field.required ? "required" : "optional"})  ${field.description}`,
      );
    }
  }
  if (descriptor.note) lines.push(`      Note: ${descriptor.note}`);
  if (descriptor.examples?.length) {
    lines.push("      Examples:");
    for (const example of descriptor.examples) lines.push(`        ${example}`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
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
      ({ descriptor, label }) =>
        `  relay ${formatCommandUsage(descriptor)}\n      ${descriptor.summary ?? label}${renderDetails(descriptor)}`,
    )
    .join("\n");
  const aliasNote =
    family === "screen" || family === "connect" || family === "flow"
      ? "\nScreen, connection, and flow edits use revision-safe whole App Map documents.\n"
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
