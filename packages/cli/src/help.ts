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
  ["Proof", ["proof", "prove"]],
  ["Operate", ["device", "run", "report", "activity"]],
  ["Automation", ["schedule", "matrix"]],
  [
    "Workspace",
    ["policy", "data", "workspace", "project", "build", "device-pool", "lane", "lease"],
  ],
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
  --timeout <ms>                   Request timeout (default 180s; env RELAY_TIMEOUT_MS). --budget on plan/combine run overrides watch unless --timeout is set
  --out <dir>                      On run verbs: write result.json, stderr.log, checkpoint.png (dest wait-for, not leftover Close last-frame), and per-job dest PNGs
  --wait | --no-wait               Wait policy (env RELAY_WAIT)
  --target current                 Resolve the only connected Device for an advanced Test run
  --revision current               Resolve the latest saved topology revision for an advanced run
  --device <id>                    Choose a connected Device for an outcome command
  --map <id>                       Choose backing topology when more than one exists (advanced)
  --lane <id>                      Saved who+where on test run, combine/plan run, interact, snapshot, or screenshot. Server resolves revision and overlay; --input-file is not needed

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
  10 verification incomplete (collection finished but captures still await human review)

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
    "prove",
    // Kept so `relay verify-change --help` remains a useful migration aid;
    // it is intentionally absent from the ordinary command groups below.
    "verify-change",
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
    "plan run",
    "plan findings",
    "plan capture review",
    "plan capture review apply",
    "proposal create",
    "proposal record",
    "session replay",
    "proposal accept",
    "run watch",
    "activity follow",
    "proof list",
  ];

  return `Relay — turn important journeys into repeatable, reviewable evidence

Show or tell Relay what to exercise. Run it on the accounts and devices you
choose. Review what happened together. Reuse the path next time.

Everyday tasks:
  Open and observe        relay connect [device]
                          relay observe [device]
  Record a journey        relay record <title> --confirm
  Edit the recording      relay edit-recording <workflowId> <expectedVersion> <verb> ...
  Run a saved Test        relay run <testId> --lane <lane>   (account + browser + profile)
  Run across accounts     relay repeat <testId> --each <dimension>=<values|all>
  Run a saved Plan        relay plan run <planId> [--lane <lane>]
  Ask Relay to explore    relay explore --url <url> --goal <goal> --confirm
  Inspect a Run           relay inspect <runOrWorkflowId>
  Review captured shots   relay plan capture review <batchId>
  Export the evidence     relay export <runId>
  Verify a change         relay prove --base <ref> [--confirm]

Full command reference:
  relay connect [device]
  relay observe [device]
  relay explore --url <url> --goal <goal> --confirm [--agents <1-4>] [--max-steps <n>] [--max-ms <n>]
    [--judge jev] [--model <openrouter-model>]
  relay explore --resume <explorationId> --confirm
  relay explore --inspect <explorationId>
  relay goal resume <sessionId> --confirm
  relay goal inspect <sessionId>
  relay goal cancel <sessionId> --confirm
  relay goal run --url https://app.test --goal "Open settings" --value name=Ada --confirm
  relay explore --url https://app.test --goal "Explore" --mission "Member permissions" --mission "Signed-out recovery" --confirm
  relay goal reproduce <sessionId> --confirm
  relay goal promote <sessionId> --confirm [--map <id>] [--title <name>]
  relay record <title> [--map <id>] [--device <id>] --confirm
  relay edit-recording <workflowId> <expectedVersion> <remove|reorder|replace|merge|split|rename> ...
  relay run <testId> [--map <id>] [--lane <lane> | --device <id>] [--confirm]
  relay repeat <testId> --each <dimension>=<values|supported|all> [--each ...]
    [--strategy <cartesian|zip|pairwise>] [--pilot <representative|first|dimension=value,...>]
    [--resume <untouched|failed|all>] [--map <id>] [--device <id>] [--confirm]
  relay continue-repeat <workflowId> <expectedVersion> --confirm
  relay inspect <workflowId|legacyV1Ref> | relay inspect-workflow <workflowId>
  relay cancel-run <workflowId> <expectedVersion> --confirm
  relay inspect-failure <runId>
  relay propose-repair <runId> <checkId> <accept-current|disable> <reason>
  relay export <runId> | relay export-evidence <runId>
  relay replay-lab <compare|visual-localization|all> <oldest.tracepack.json> <newest.tracepack.json> [...]
  relay prove --base <ref> [--config-file <path>] [--confirm]
  relay prove <proof-id> [--wait | --no-wait]
  relay proof analyze run <runId...>
  relay proof analyze test <appMapId> <testId...>
  relay proof analyze revision <gitSha>
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

Goal exploration options:
  --judge jev                    Use the OpenRouter-hosted Typesafe Jev decision model
  --model <id>                   Override the OpenRouter model alias or pinned model id
  --auth-fixture <reference>     Bind one existing managed browser fixture (single worker only)

Outcome commands:
  connect, observe, explore, goal, record, edit-recording, run, repeat, continue-repeat, inspect-workflow, cancel-run,
  inspect-failure, propose-repair,
  export-evidence, replay-lab

These resolve the sole connected Device and current Test workspace automatically. Use --device, or
the advanced --map option, only when selection is ambiguous. The first Record creates its backing
topology automatically. Record acquires control only after --confirm and never displaces another
person or agent. The current command is Control and record: interactions pass through Relay.

Proof commands:
  prove, proof analyze, proof start, proof list, proof inspect, proof approve-plan,
  proof continue, proof cancel, proof rerun-affected

Replay Lab reads only the explicitly named local TracePack JSON files. It does not start the Relay
daemon, read a Device or workspace, contact a network service, or mutate Tests and evidence.

Advanced command families:
${groups}

Compatibility:
  relay verify-change --base <ref> [--config-file <path>] [--confirm]
  relay verify-change run|test|revision ...
  verify-change is deprecated. Use prove for live Change Proofs and
  proof analyze for offline analysis; compatibility aliases use the same
  fail-closed implementation and emit a deprecation notice.

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
  if (family === "browser")
    return `Relay browser commands

  relay browser open <target-id>
  relay browser navigate <target-id> <url>
  relay browser snapshot <target-id> --json
  relay browser click <target-id> <accessible-name>
  relay browser screenshot <target-id> --file <image.png>
  relay browser capture-plan <map-id> <test-id> --input-file <plan.json>

Capture plans contain name, expectedRevision, language (observed options and
reviewed picker navigation), and views (id, name, steps). Each view ends with
a screenshot. Run the saved Test with --in <test-id>-language=en,fr, then use
combine export <batch-id> for screenshots, trees and side-by-side comparison.

${globalOptions}`;
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
  if (family === "prove") {
    return `Relay prove commands

Usage:
  relay prove --base <ref> [--config-file <path>] [--confirm]
  relay prove <proof-id> [--wait | --no-wait]

The --base form is the ordinary live Change Proof entry point. It reads the
reviewed .relay/change-proof.json (or --config-file), resolves exact local
Git base/HEAD SHAs and changed files, compiles an explained Verification Plan,
and creates one durable Proof only with --confirm. A proof id runs or resumes
the already approved server-owned Proof. Human approval remains required at
the frozen plan boundary.

Options:
  --base <ref>                     Exact local Git base ref
  --config-file <path>             Reviewed JSON config (default .relay/change-proof.json)
  --config <path>                  Alias for --config-file
  --confirm                        Authorize Proof creation and its live local lifecycle

${globalOptions}
`;
  }
  if (family === "proof") {
    return `Relay proof commands

Usage:
  relay prove --base <ref> [--config-file <path>] [--confirm]
  relay proof prepare [--input <json>]
  relay proof analyze run <runId...>
  relay proof analyze test <appMapId> <testId...>
  relay proof analyze revision <gitSha>
  relay proof start --input-file ./proof.json
  relay proof list
  relay proof inspect <proof-id> [--history]
  relay proof approve-plan <proof-id> --confirm --input <json>
  relay proof continue <proof-id> --input <json>
  relay proof cancel <proof-id> --confirm --input <json>
  relay proof rerun-affected <proof-id> --input-file ./replacement-proof.json

proof analyze is read-only offline analysis of explicitly selected frozen
Runs, Tests, or source metadata. It never controls a Device or creates a live
Proof. Low-level lifecycle operations stay under proof; ordinary live work
uses prove.

${globalOptions}
`;
  }
  if (family === "verify-change") {
    return `Relay verify-change compatibility commands (deprecated)

Usage:
  relay verify-change --base <ref> [--config-file <path>] [--confirm]
  relay verify-change run <runId...>
  relay verify-change test <appMapId> <testId...>
  relay verify-change revision <gitSha>

The --base form reads the reviewed .relay/change-proof.json (or --config-file),
resolves exact local Git base/HEAD SHAs and changed files, compiles an explained
Verification Plan, and creates one durable Proof only with --confirm. For a
complete executable plan, --confirm also requests human approval, runs the
deterministic local pilot, records its persisted Run, and expands required cases
sequentially. The server derives the terminal Proof decision from Run evidence;
provider-session targets fail closed.

Options for the --base form:
  --base <ref>                     Exact local Git base ref (required)
  --config-file <path>             Reviewed JSON config (default .relay/change-proof.json)
  --config <path>                  Alias for --config-file
  --confirm                        Authorize Proof creation and its live local lifecycle

Use relay prove for live Change Proofs, or relay proof analyze for offline
analysis. This compatibility spelling emits a deprecation notice.

${globalOptions}
`;
  }

  const paths = friendlyPaths().filter(
    ({ descriptor }) => descriptor.command.split(" ")[0] === family,
  );
  if (!paths.length) {
    // goal/explore are fallback intents parsed after the operation registry;
    // give them a real usage surface instead of an unknown-family error.
    if (family === "goal" || family === "explore") {
      return `Relay ${family} commands

Goal-first execution without a saved Test or Map. Sessions are server-owned:
start from one client, inspect or cancel from another.

Usage:
  relay goal run --url <url> --goal <task> --value <key=value> [--auth-fixture <reference>] --confirm
  relay goal inspect <sessionId>
  relay goal resume <sessionId> --confirm
  relay goal cancel <sessionId> --confirm
  relay goal reproduce <sessionId> --confirm
  relay goal promote <sessionId> --confirm [--map <id>] [--title <name>]
  relay explore --url <url> --goal <task> --mission <mission>... --confirm [--agents <1-4>]
  relay explore --resume <explorationId> --confirm
  relay explore --inspect <explorationId>

See 'relay help' for the full command list.

${globalOptions}
`;
    }
    throw new UsageError(`Unknown command family: ${family}. Run 'relay help'.`);
  }
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
