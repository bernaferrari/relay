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
  ["Topology", ["map", "screen", "connect", "flow"]],
  ["Authoring", ["variable", "test", "combine", "proposal", "session", "routine", "case-stack"]],
  ["Explore", ["discovery"]],
  ["Proof", ["proof"]],
  ["Operate", ["device", "run", "report", "activity"]],
  ["Automation", ["schedule", "matrix"]],
  ["Workspace", ["policy", "data", "workspace", "project", "build", "device-pool", "lease"]],
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
  --target current                 Resolve the only connected Device for an advanced Test run
  --revision current               Resolve the latest saved topology revision for an advanced run
  --device <id>                    Choose a connected Device for an outcome command
  --map <id>                       Choose backing topology when more than one exists (advanced)

Screenshot and snapshot output:
  --file <path>                    Save screenshot PNG or snapshot JSON to a file
  --full                           On snapshot stdout: print the raw accessibility tree
  --binary                         Write raw PNG bytes to stdout
  --force                          Overwrite an existing --file target or a non-empty survey --dir
  --mark <x>,<y>                   Draw a tap preview ring on a screenshot (no tap)
  --preview                        On interact: show selection overlay, do not tap
  --confirm                        Confirm a reviewed-origin or destructive operation
  --history                        Include immutable Proof history on proof inspect
  -h, --help                       Print help for the root or the given family

Exit codes:
  0  success
  2  usage (bad arguments; also Unknown option)
  3  connection (server unreachable, timeout)
  4  auth (401/403)
  5  validation (client-side input problem: bad flags, malformed payload)
  6  conflict (Device control unavailable, stale revision)
  7  cancelled (SIGINT/SIGTERM)
  8  server error (the call did not run to a verdict)
  9  operation failed (it ran and reported failure: { ok: false } or job status error)

Machine envelopes (--json / --ndjson):
  success: {"type":"result","ok":true,"operationId":"...","result":{...}}
  failure: {"type":"error","ok":false,"operationId":"...","error":{"message":"...","exitCode":9,"details":{...}}}`;

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
    "report",
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
    "proof list",
  ];

  return `Relay — record once, prove every build

Usage:
  relay connect [device]
  relay observe [device]
  relay record <title> [--map <id>] [--device <id>] --confirm
  relay edit-recording <workflowId> <expectedVersion> <remove|reorder|replace|merge|split|rename> ...
  relay run <testId> [--map <id>] [--device <id>] [--confirm]
  relay repeat <testId> --each <dimension>=<values|supported|all> [--each ...]
    [--strategy <cartesian|zip|pairwise>] [--pilot <representative|first|dimension=value,...>]
    [--resume <untouched|failed|all>] [--map <id>] [--device <id>] [--confirm]
  relay continue-repeat <workflowId> <expectedVersion> --confirm
  relay inspect-workflow <workflowId|legacyV1Ref>
  relay cancel-run <workflowId> <expectedVersion> --confirm
  relay inspect-failure <runId>
  relay propose-repair <runId> <checkId> <accept-current|disable> <reason>
  relay export-evidence <runId>
  relay replay-lab <compare|visual-localization|all> <oldest.tracepack.json> <newest.tracepack.json> [...]
  relay verify-change run <runId...>
  relay verify-change test <appMapId> <testId...>
  relay verify-change revision <gitSha>
  relay proof start --input-file ./proof.json
  relay proof list
  relay proof inspect <proof-id> [--history]
  relay proof approve-plan <proof-id> --confirm --input <json>
  relay proof continue <proof-id> --input <json>
  relay proof cancel <proof-id> --confirm --input <json>
  relay proof rerun-affected <proof-id> --input-file ./replacement-proof.json
  relay <family> <command> [arguments] [--input <json> | --input-file <path>] [global options]
  relay operation invoke <operationId> (--input <json> | --input-file <path>) [global options]
  relay <family> --help

Outcome commands:
  connect, observe, record, edit-recording, run, repeat, continue-repeat, inspect-workflow, cancel-run,
  inspect-failure, propose-repair,
  export-evidence, replay-lab, verify-change

These resolve the sole connected Device and current Test workspace automatically. Use --device, or
the advanced --map option, only when selection is ambiguous. The first Record creates its backing
topology automatically. Record acquires control only after --confirm and never displaces another
person or agent. The current command is Control and record: interactions pass through Relay.

Proof commands:
  proof start, proof list, proof inspect, proof approve-plan, proof continue,
  proof cancel, proof rerun-affected

Replay Lab reads only the explicitly named local TracePack JSON files. It does not start the Relay
daemon, read a Device or workspace, contact a network service, or mutate Tests and evidence.

Advanced command families:
${groups}

Advanced examples:
${usages(workflowCommands).join("\n")}

Start with App, Device, Test, Checkpoint, Run, and Report. Record, Repeat, Explore, and Verify are
actions. Topology, scheduling, and Device-control commands below are advanced operations for repair,
migration, and trusted orchestration.

${globalOptions}

Friendly commands default --input to '{}'. Explicit path arguments such as <serial> and <sessionId>
are required where shown. Outcome commands start or reuse the default loopback Relay daemon when
RELAY_URL and --server are unset. Explicit server URLs remain caller-managed.
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
  if (family === "report") {
    return `Relay report commands

Turn a completed run into a proof report for a pull request: a machine
verdict (pass / fail / unproven) plus a compact markdown summary suitable
for GitHub check-run output. \`unproven\` means Relay could not execute
(no device, no build); it is deliberately distinct from fail.

Usage:
  relay report emit --run <runId> [--format github-check] [--json]

Exit codes follow operation semantics: 0 pass, 9 fail, 8 unproven.

${globalOptions}
`;
  }
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
