import {
  cliResourceDescriptors,
  formatCommandUsage,
  mappedCommandDescriptors,
  operationLabel,
  type CommandPathDescriptor,
} from "./commands.js";
import { dbHelp } from "./db-commands.js";
import { UsageError } from "./errors.js";

const familyGroups = [
  ["App Map", ["map", "screen", "connect", "flow"]],
  ["Author", ["variable", "test", "combine", "proposal", "routine", "case-stack"]],
  ["Explore", ["discovery"]],
  ["Operate", ["device", "run", "activity"]],
  ["Automation", ["schedule", "matrix"]],
  ["Workspace", ["policy", "data", "workspace", "project", "build", "device-pool", "lease"]],
  ["System", ["generation", "system", "db"]],
] as const;

const globalOptions = `Global options:
  --server <url>                    Relay server (env RELAY_URL)
  --organization <id>              Organization scope (env RELAY_ORGANIZATION_ID)
  --project <id>                   Project scope (env RELAY_PROJECT_ID)
  --credential-source <source>     none or env:NAME (env RELAY_CREDENTIAL_SOURCE)
  --actor <id>                     Actor identity (env RELAY_ACTOR_ID)
  --input <json>                   JSON object input
  --input-file <path>              Read the same JSON object from a file
  --json | --ndjson                Machine-readable output
  --quiet                          Suppress stderr diagnostics
  --timeout <ms>                   Request timeout (env RELAY_TIMEOUT_MS)
  --wait | --no-wait               Wait policy (env RELAY_WAIT)

Screenshot output:
  --file <path>                    Save screenshot PNG to a file
  --binary                         Write raw PNG bytes to stdout
  --force                          Overwrite an existing --file target
  --mark <x>,<y>                   Draw a tap preview ring on a screenshot (no tap)
  --preview                        On interact: show selection overlay, do not tap`;

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
  return new Set([
    ...friendlyPaths().map(({ descriptor }) => descriptor.command.split(" ")[0]!),
    "db",
  ]);
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
    "map teach",
    "screen list",
    "connect list",
    "device list",
    "device screenshot",
    "test run",
    "variable save",
    "combine run",
    "proposal create",
    "proposal record",
    "session replay",
    "proposal accept",
    "run watch",
    "activity follow",
  ];

  return `Relay — App Maps for humans and agents

Usage:
  relay <family> <command> [arguments] [--input <json> | --input-file <path>] [global options]
  relay operation invoke <operationId> (--input <json> | --input-file <path>) [global options]
  relay <family> --help

Command families:
${groups}

Start here:
${usages(workflowCommands).join("\n")}

An App Map is screens and paths. A Variable is a list plus the recorded steps that apply
one value (language, account, model). A Test is what you run. A Combine connects them:
every selected value × every selected Test. Run one cell or the whole grid.

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
  if (family === "db") return dbHelp();
  if (family === "operation") {
    return `Relay operation commands

Usage:
  relay operation invoke <operationId> (--input <json> | --input-file <path>) [global options]

Unlike friendly commands, operation invoke always requires --input or --input-file.

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
      ? "\nScreen, connection, and flow edits are granular, revision-safe App Map operations.\n"
      : "";

  return `Relay ${family} commands

Usage:
  relay ${family} <command> [arguments] [--input <json> | --input-file <path>] [global options]

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
