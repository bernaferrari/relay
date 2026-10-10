import {
  cliResourceDescriptors,
  formatCommandUsage,
  mappedCommandDescriptors,
  operationLabel,
  type CommandPathDescriptor,
} from "./commands.js";
import { renamedFamily } from "./cli-renames.js";
import { UsageError } from "./errors.js";
import {
  everydayExitCodes,
  everydayHelpTopics,
  projectConfigHelp,
  renderEverydayHelp,
} from "./everyday-help.js";

/** The advanced surface: `relay <noun> <verb>`, one spelling per operation. */
const nouns = [
  ["test", "Saved Tests, their Variables, Data sets, and case stacks"],
  ["run", "Runs and execution jobs: watch, retry, review, share, repair"],
  ["plan", "Saved Plans (Variables × Tests), their campaigns, matrices, and schedules"],
  ["device", "Devices and browsers, leases, Lanes, pools, saved accounts, targets"],
  ["recording", "Record a Test step by step, then edit and commit the take"],
  ["map", "The App Map: screens, connections, flows, routines, proposals, Explore"],
  ["proof", "Change Proof lifecycle, evidence and privacy policy, PR reports"],
  ["build", "App builds: save, preflight, install, launch"],
  ["system", "Activity log, projects, and the local control database"],
] as const;

/** Commands parsed outside the operation registry, listed with their noun. */
const extraUsages: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  test: [
    [
      "test capture-plan <map-id> <test-id> --input-file <plan.json>",
      "Save a browser capture plan as a Test and its language Variable",
    ],
  ],
  proof: [
    [
      "proof verify --base <ref> [--config-file <path>] [--confirm]",
      "Prove the current Git change: plan, approve, and run one durable Proof",
    ],
    ["proof analyze run <runId...>", "Offline analysis of frozen Runs (never controls a device)"],
    ["proof analyze test <appMapId> <testId...>", "Offline analysis of saved Tests"],
    ["proof analyze revision <gitSha>", "Offline analysis of one source revision"],
    [
      "proof report --run <runId> [--format github-check]",
      "Pass / fail / unproven report for a pull request (exit 0, 9, 8)",
    ],
  ],
  system: [
    ["system db path", "Print the local control database path"],
    ["system db query <sql>", "Query the local control database"],
    ["system db events [--after <seq>]", "Print durable events"],
    ["system db shell", "Open sqlite3 on the local control database"],
  ],
};

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
  --timeout <ms>                   Request timeout (default 180s; env RELAY_TIMEOUT_MS). --budget on plan run overrides watch unless --timeout is set
  --out <dir>                      On run verbs: write result.json, stderr.log, checkpoint.png (dest wait-for, not leftover Close last-frame), and per-job dest PNGs
  --wait | --no-wait               Wait policy (env RELAY_WAIT)
  --target current                 Resolve the only connected Device for an advanced Test run
  --revision current               Resolve the latest saved topology revision for an advanced run
  --device <id>                    Choose a connected Device for an outcome command
  --map <id>                       Choose backing topology when more than one exists (advanced)
  --lane <id>                      Saved who+where on test run, plan run, interact, snapshot, or screenshot. Server resolves revision and overlay; --input-file is not needed

Screenshot, snapshot, and compile output:
  --file <path>                    Save screenshot PNG or snapshot JSON to a file
  --full                           On snapshots, print the raw tree; on test compile, print full plan JSON
  --binary                         Write raw PNG bytes to stdout
  --force                          Overwrite an existing --file target or a non-empty survey --dir
  --mark <x>,<y>                   Draw a tap preview ring on a screenshot (no tap)
  --preview                        On interact: show selection overlay, do not tap
  --confirm                        Confirm a reviewed-origin or destructive operation
  --history                        Include immutable Proof history on proof inspect
  -h, --help                       Print help for the root or the given family

${everydayExitCodes}

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

const familyNotes: Readonly<Record<string, string>> = {
  run: `relay run <test> runs one saved Test (see 'relay help'). The verbs above act on runs
and execution jobs; a Test named like a verb runs with 'relay test run <app> <test>'.`,
  map: "Screen, connection, and flow edits are granular, revision-safe App Map operations.",
  test: `Capture plans contain name, expectedRevision, language (observed options and reviewed
picker navigation), and views (id, name, steps). Each view ends with a screenshot.`,
  proof: `proof verify is the ordinary live Change Proof entry point. It reads the reviewed
.relay/change-proof.json (or --config-file, alias --config), resolves exact local Git
base/HEAD SHAs and changed files, compiles an explained Verification Plan, and creates
one durable Proof only with --confirm. proof run <proof-id> runs or resumes an approved
Proof; human approval remains required at the frozen plan boundary. proof analyze is
read-only offline analysis; it never controls a Device or creates a live Proof.
proof report reads persisted runs from disk and needs no server.`,
  system: `system db reads the local control-plane SQLite file (leases, maps, durable events)
directly, without the HTTP server.`,
};

/** One line per verb: plain verbs first, then each sub-noun (`map screen …`)
 * grouped together, keeping registry order inside a group. */
function nounLines(noun: string): string[] {
  const rows: (readonly [string, string])[] = [
    ...friendlyPaths()
      .filter(({ descriptor }) => descriptor.command.split(" ")[0] === noun)
      .map(
        ({ descriptor, label }) =>
          [formatCommandUsage(descriptor), descriptor.summary ?? label] as const,
      ),
    ...(extraUsages[noun] ?? []),
  ];
  const words = (usage: string) => usage.split(" ").filter((word) => /^[a-z]/u.test(word));
  const group = (usage: string) => (words(usage).length > 2 ? words(usage)[1]! : "");
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (left, right) =>
        group(left.row[0]).localeCompare(group(right.row[0])) || left.index - right.index,
    )
    .map(({ row: [usage, summary] }) => {
      const command = `  relay ${usage}`;
      const short = summary.split(/\. (?=[A-Z-])|; /u)[0]!;
      return command.length < 56 ? `${command.padEnd(56)}${short}` : `${command}  ${short}`;
    });
}

function renderRootHelp(): string {
  return `Relay — check that what your app must do still works, on websites, Android, and iOS

Everyday:
  relay new "<what should work>" --url <website>   Write and save a Test from a sentence
  relay apply <test.yaml | folder>                 Save test files (name, url, steps)
  relay show "<test>"                              Print a Test as its file
  relay run <test> [--app <name>] [--device ios]   Run one Test and show each step's result
  relay ci [<app>] --output result.json            Run every ready Test (for CI)
  relay apps                                       Your apps
  relay tests [<app>]                              An app's Tests and whether each is ready
  relay runs [<app>]                               Recent runs
  relay devices                                    Connected phones, simulators, and browsers
  relay guide [topic]                              Step-by-step guides (no server needed)

Also:
  relay record "<title>" [--app <name>] --confirm  Record a Test by using the app
  relay connect [device] | relay observe [device]  Open a device and look at it
  relay inspect <runId>                            What happened in a run
  relay review [--app <name>]                      Review screenshots that changed
  relay export <runId> --out ./review              Save a run's evidence
  relay doctor                                     Check that Relay is set up
  relay --version
  relay <command> -h, --help                       Help for one command

Apps, Tests, and devices can be named the way you see them ("Checkout works",
"Shop"), by id, or for devices simply ios, android, or browser.

relay run options:
  --app <name>        Which app, when the Test name is not unique
  --device <device>   ios, android, browser, a device name, or an id
  --out <dir>         Write result.json, stderr.log, and the run's screenshots
  --json              Machine output; the result includes the verdict
  --confirm           Allow steps marked risky

${projectConfigHelp}

${everydayExitCodes}

Machine output (--json): {"type":"result","ok":true,"operationId":"...","result":{...}}
  failures: {"type":"error","ok":false,"error":{"message":"...","exitCode":2}}

Advanced: 'relay help advanced' lists relay <noun> <verb> for test, run, plan,
device, recording, map, proof, build, and system. 'relay <noun> --help' shows one.
`;
}

function renderAdvancedHelp(): string {
  const sections = nouns
    .map(([noun, about]) => `${noun} — ${about}\n${nounLines(noun).join("\n")}`)
    .join("\n\n");
  return `Relay advanced commands

For everyday use see 'relay help'. Advanced commands read relay <noun> <verb>.
'relay <noun> --help' shows each verb's arguments, --input fields, and examples.
Friendly commands default --input to '{}'; path arguments such as <serial> are required.

Choosing a saved Test:
  relay test list <appId> adds discovery.status and platform context. Recorded means a saved
  route exists; it does not mean a target is connected or every selector has passed preflight.
  Explicit drafts say needs-recording; unbound actions say needs-binding. Choose one saved
  targetProfileId from discovery.savedTargetProfiles when compiling
  (relay test compile <appId> <testId> --input '{"targetProfileId":"<saved-profile>"}'),
  then inspect preflight.summary.blockers.
  map get is a compact overview. map export <appId> --json includes the full saved graph as YAML.

${sections}

Durable workflows (start from one client, inspect or cancel from another):
  relay repeat <testId> --each <dimension>=<values|supported|all> [--each ...]
    [--strategy <cartesian|zip|pairwise>] [--pilot <representative|first|dimension=value,...>]
    [--resume <untouched|failed|all>] [--map <id>] [--device <id>] [--confirm]
  relay continue-repeat <workflowId> <expectedVersion> --confirm
  relay cancel-run <workflowId> <expectedVersion> --confirm
  relay inspect-failure <runId>
  relay propose-repair <runId> <checkId> <accept-current|disable> <reason>
  relay edit-recording <workflowId> <expectedVersion> <remove|reorder|replace|merge|split|rename> ...
  relay goal run --url <url> --goal <task> [--value <key=value>] --confirm
  relay goal inspect|resume|cancel|reproduce|promote <sessionId> [--confirm]
  relay explore --url <url> --goal <task> [--mission <mission>...] --confirm [--agents <1-4>]
    [--judge jev] [--model <openrouter-model>] [--auth-fixture <reference>]
  relay explore --resume <explorationId> --confirm | relay explore --inspect <explorationId>

These resolve the sole connected Device and current Test workspace automatically. Use
--device, or the advanced --map option, only when selection is ambiguous.

${globalOptions}

Outcome commands start or reuse the default loopback Relay daemon when RELAY_URL and
--server are unset. Explicit server URLs remain caller-managed.
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
  if (family === "edit-recording")
    return `Relay recording edits

Usage:
  relay edit-recording <workflowId> <expectedVersion> remove <actionId,...>
  relay edit-recording <workflowId> <expectedVersion> reorder <actionId,...>
  relay edit-recording <workflowId> <expectedVersion> replace <actionId> '<interaction JSON>'
  relay edit-recording <workflowId> <expectedVersion> merge <actionId,...> [intent]
  relay edit-recording <workflowId> <expectedVersion> split <actionId> <stepPosition>
  relay edit-recording <workflowId> <expectedVersion> rename <actionId> <intent>

Inspect the workflow with the same --actor to read its current version and
action IDs. Replacement retains the action ID and captured source evidence;
the edited Take needs replay before it can be saved.

${globalOptions}`;
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
    const moved = renamedFamily(family);
    throw new UsageError(
      moved.length
        ? `relay ${family} is gone; its commands moved to ${moved.map((noun) => `relay ${noun}`).join(", ")}. Run 'relay ${moved[0]} --help'.`
        : `Unknown command family: ${family}. Run 'relay help advanced'.`,
    );
  }
  const commands = [
    ...paths.map(
      ({ descriptor, label }) =>
        `  relay ${formatCommandUsage(descriptor)}\n      ${descriptor.summary ?? label}${renderDetails(descriptor)}`,
    ),
    ...(extraUsages[family] ?? []).map(([usage, summary]) => `  relay ${usage}\n      ${summary}`),
  ].join("\n");
  const note = familyNotes[family] ? `\n${familyNotes[family]}\n` : "";

  return `Relay ${family} commands

Usage:
  relay ${family} <command> [arguments] [--input <json> | --input-file <path>] [global options]

Commands:
${commands}
${note}
Path arguments override the same fields in --input. Friendly commands default --input to '{}'.

${globalOptions}
`;
}

export function renderHelp(family?: string): string {
  if (!family) return renderRootHelp();
  if (family === "advanced") return renderAdvancedHelp();
  if (everydayHelpTopics().includes(family)) return renderEverydayHelp(family);
  return renderFamilyHelp(family);
}

export const HELP = renderHelp();
