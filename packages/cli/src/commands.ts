import { operationDefinitions, type OperationId } from "@relay/protocol";
import {
  appMapAuthoringCommandDescriptors,
  appMapRoutineCommandDescriptors,
} from "./app-map-commands.js";
import { appMapRunPlanCommandDescriptors } from "./app-map-run-plan-commands.js";
import { authoringSessionCommandDescriptors } from "./authoring-session-commands.js";
import { campaignCapacityCommandDescriptors } from "./campaign-capacity-commands.js";
import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
  type CommandBehavior,
  type CommandPathDescriptor,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { UsageError } from "./errors.js";
import { cliResourceDescriptors } from "./resource-commands.js";
import { runEvidenceCommandDescriptors } from "./run-share-commands.js";
import { targetCommandDescriptors } from "./target-commands.js";

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
export const cliOperationDescriptors: readonly CliOperationDescriptor[] = [
  mapped("system.health.get", path("system health")),
  mapped("system.doctor.get", path("system doctor")),
  mapped(
    "system.audit.list",
    path("system audit list"),
    path("activity audit", [], undefined, {
      summary: "List operation audit records",
    }),
  ),
  mapped(
    "event.stream",
    path("system events follow", [], undefined, { behavior: "event-stream" }),
    path("activity follow", [], undefined, {
      summary: "Follow live project activity",
      examples: ["relay activity follow --ndjson"],
      behavior: "event-stream",
    }),
  ),
  mapped(
    "activity.export",
    path("activity export", [], undefined, {
      summary: "Export the complete attributed project activity log",
      examples: ["relay activity export --json > relay-activity.json"],
    }),
  ),
  {
    operationId: "activity.list",
    exclusion: "internal",
    reason: "Activity list uses the CLI's bounded, cursor-aware read-only resource router.",
  },
  {
    operationId: "target.stream.open",
    exclusion: "internal",
    reason: "Live target video is a media stream, not a CLI command.",
  },
  {
    operationId: "target.observation.capture",
    exclusion: "internal",
    reason: "The public relay observe outcome owns durable bounded target observation.",
  },

  mapped("workspace.privacy.get", path("policy privacy get")),
  mapped("workspace.privacy.update", path("policy privacy update")),
  mapped("workspace.evidence.get", path("policy evidence get")),
  mapped("workspace.evidence.update", path("policy evidence update")),
  mapped("workspace.apple-device.update", path("workspace apple-device update")),
  mapped("workspace.apple-live-preview.update", path("workspace apple-live-preview update")),
  mapped("workspace.variables.get", path("data variables get")),
  mapped("workspace.variables.update", path("data variables update")),

  ...targetCommandDescriptors,

  mapped("project.list", path("project list")),
  mapped("project.save", path("project save")),
  mapped("build.list", path("build list")),
  mapped("build.save", path("build save")),
  mapped("build.preflight", path("build preflight", ["buildId"])),
  mapped("build.install", path("build install", ["buildId", "serial"])),
  mapped("build.launch", path("build launch", ["buildId", "serial"])),
  mapped("device-pool.list", path("device-pool list")),
  mapped("device-pool.save", path("device-pool save")),
  mapped("device-pool.preflight", path("device-pool preflight", ["poolId"])),
  mapped("target-worker.list", path("target worker list")),
  ...campaignCapacityCommandDescriptors,
  mapped(
    "lease.list",
    path(
      "lease list",
      [],
      { status: "active" },
      {
        summary: "List active target leases",
      },
    ),
    path(
      "lease history",
      [],
      { status: "all" },
      {
        summary: "List active and historical target leases",
      },
    ),
  ),
  mapped(
    "lease.create",
    path(
      "lease create",
      ["deviceSerial"],
      { poolId: "local" },
      {
        summary: "Take exclusive control of a local device for 2 hours",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "expiresAt",
            type: "number",
            description: "Optional Unix time in milliseconds; defaults to 2 hours from now",
          },
        ],
        examples: [
          "relay lease create 00008110 --actor human:bernardo",
          "relay lease create emulator-5554 --actor agent:mapper --json",
        ],
        note: "Use the same --actor for subsequent device input. Read-only observation and screenshots do not require a lease.",
      },
    ),
    path("lease create-in-pool", ["poolId", "deviceSerial"], undefined, {
      summary: "Take exclusive control of a device from a named pool for 2 hours",
      argumentHelp: [
        { name: "pool", type: "string", description: "Device-pool identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional Unix time in milliseconds; defaults to 2 hours from now",
        },
      ],
      examples: ["relay lease create-in-pool cloud-ios iphone-16 --actor agent:mapper"],
    }),
  ),
  mapped(
    "lease.takeover",
    path("lease takeover", ["leaseId"], undefined, {
      summary: "Explicitly take control from an observed active lease",
      argumentHelp: [
        { name: "leaseId", type: "string", description: "Exact active lease to replace" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional new lease expiry; defaults to 2 hours from now",
        },
        { name: "reason", type: "string", required: true, description: "Auditable handoff reason" },
        { name: "confirm", type: "true", required: true, description: "Explicit user approval" },
      ],
    }),
  ),
  mapped("lease.release", path("lease release", ["leaseId"])),

  ...appMapAuthoringCommandDescriptors,
  mapped(
    "app-map.variable.infer",
    path("variable infer", ["appMapId", "variableId"], undefined, {
      summary: "Infer remaining Variable rows from 1-8 taught examples",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "variableId", type: "string", description: "Stable Variable identifier" },
      ],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "target",
          type: "object",
          required: true,
          description:
            'Leased control target, e.g. {"kind":"device","platform":"android","targetId":"<serial>"}',
        },
        {
          name: "taughtRows",
          type: "array",
          required: true,
          description:
            "1-8 already-taught option rows ({id, identifier?, label?, text?}) to infer the rest from",
        },
        {
          name: "leaseId",
          type: "string",
          required: true,
          description: "Actor-owned target lease identifier",
        },
        { name: "name", type: "string", description: "Optional Variable display name" },
        {
          name: "kind",
          type: "string",
          description: "Optional Variable kind (language, account, theme, …)",
        },
        {
          name: "apply",
          type: "object",
          description: "Optional reviewed actions that open the value list",
        },
      ],
      examples: [
        `relay variable infer grok-android language --input '${JSON.stringify({
          expectedRevision: 4,
          leaseId: "<lease>",
          target: { kind: "device", platform: "android", targetId: "<serial>" },
          taughtRows: [
            { id: "en", label: "English" },
            { id: "it", label: "Italiano" },
          ],
        })}'`,
      ],
      note: "Requires an active exclusive lease on the target. Taught rows seed inference; the server walks the apply path and reads the remaining options.",
    }),
  ),
  ...appMapRunPlanCommandDescriptors,
  ...appMapRoutineCommandDescriptors,

  ...authoringSessionCommandDescriptors,
  {
    operationId: "authoring.take.edit",
    exclusion: "internal",
    reason: "The Test-first edit-recording outcome owns this canonical typed mutation.",
  },

  mapped("schedule.list", path("schedule list")),
  mapped("schedule.create", path("schedule create")),
  mapped("schedule.delete", path("schedule delete", ["scheduleId"])),
  mapped("matrix.list", path("matrix list")),
  mapped("matrix.create", path("matrix create")),
  mapped("matrix.update", path("matrix update", ["matrixId"])),
  mapped("matrix.delete", path("matrix delete", ["matrixId"])),
  mapped("matrix.import", path("matrix import")),
  mapped("matrix.resolve", path("matrix resolve", ["matrixId"])),

  mapped("presence.list", path("presence list")),
  mapped("presence.upsert", path("presence upsert")),
  mapped("presence.clear", path("presence clear", ["actorId"])),

  mapped("discovery.list", path("discovery list")),
  mapped("discovery.create", path("discovery create")),
  mapped("discovery.get", path("discovery get", ["sessionId"])),
  mapped("discovery.rename", path("discovery rename", ["sessionId"])),
  mapped("discovery.status.update", path("discovery status update", ["sessionId"])),
  mapped("discovery.capture", path("discovery capture", ["sessionId", "serial"])),
  mapped("discovery.interact", path("discovery interact", ["sessionId", "serial"])),
  mapped("discovery.here", path("discovery here", ["sessionId"])),
  mapped("discovery.do", path("discovery do", ["sessionId", "serial"])),
  mapped("discovery.suggestion", path("discovery suggestion", ["sessionId"])),
  mapped("discovery.coverage", path("discovery coverage", ["sessionId"])),
  mapped("discovery.exploration-timeline", path("discovery exploration-timeline", ["sessionId"])),
  mapped("discovery.export", path("discovery export", ["sessionId"])),
  mapped("discovery.start", path("discovery start", ["sessionId"])),
  mapped("discovery.cancel", path("discovery cancel", ["sessionId"])),
  mapped("discovery.promote", path("discovery promote", ["sessionId"])),

  mapped("job.list", path("job list")),
  mapped(
    "job.get",
    path("job get", ["jobId"]),
    path("job watch", ["jobId"], undefined, { behavior: "job-watch" }),
    path("run watch", ["jobId"], undefined, {
      summary: "Watch an execution job until it finishes",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
      behavior: "job-watch",
    }),
  ),
  mapped(
    "job.start",
    path("job start"),
    path("run start", ["recipe"], undefined, {
      summary: "Run a compiled job (prefer relay flow run for map paths)",
      argumentHelp: [
        {
          name: "recipe",
          type: "string",
          description: "Compiled job identifier when not starting from a map flow",
        },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Optional target device serial" },
        { name: "platform", type: "ios | android", description: "Target platform" },
        { name: "targetKind", type: "device | browser", description: "Execution target kind" },
        {
          name: "variables",
          type: "object",
          description: "Per-run variable overrides; private values stay out of tracked files",
        },
      ],
      examples: [
        'relay flow run checkout main --input \'{"serial":"<phone-serial>","platform":"ios"}\'',
        'relay run start <compiled-job-id> --input \'{"serial":"<phone-serial>","platform":"android"}\'',
      ],
    }),
  ),
  mapped(
    "job.retry",
    path("job retry", ["jobId"]),
    path("run retry", ["jobId"], undefined, {
      summary: "Retry an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.cancel",
    path("job cancel", ["jobId"]),
    path("run cancel", ["jobId"], undefined, {
      summary: "Cancel an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.pause",
    path("job pause", ["jobId"]),
    path("run pause", ["jobId"], undefined, {
      summary: "Pause an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.resume",
    path("job resume", ["jobId"]),
    path("run resume", ["jobId"], undefined, {
      summary: "Resume an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped("job.active.cancel", path("job active cancel")),
  mapped("job.matrix.start", path("job matrix start")),
  mapped("job.compatibility-matrix.start", path("job compatibility-matrix start")),
  mapped("job.soak.start", path("job soak start")),
  mapped(
    "job.combine.start",
    path("job combine start", [], undefined, {
      summary: "Run every selected Variable value × every selected Test",
      examples: [
        'relay combine run grok-ios language-x-settings --cell ja --input \'{"serial":"<device>","platform":"ios"}\'',
        'relay combine run grok-ios language-x-settings --all --input \'{"serial":"<device>","platform":"ios"}\'',
      ],
      note: "Default is one cell. Pass --cell to choose a world, or --all to run every selected cell. A default serial/target fills missing cell bindings. Per-cell cellRuntimeProfiles and cellTargetBindings remain overrides. For a local multi-target campaign, pass cellTargetBindings plus the shared localAdmission object. Missing Variable, empty selection, or a Variable that cannot apply still return 409 and queue nothing.",
      behavior: "job-start-watch",
    }),
    path("combine run", ["appMapId", "combineId"], undefined, {
      summary: "Run one cell of a saved Combine (Variables × Tests)",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved Combine" },
      ],
      inputHelp: [
        {
          name: "serial",
          type: "string",
          description:
            "Legacy one-target device serial. Omit it when cellTargetBindings is supplied; Relay will not infer a local target.",
        },
        {
          name: "platform",
          type: "android | ios",
          description:
            "Required with the legacy serial path. Each explicit local target binding carries its own platform.",
        },
        {
          name: "selected",
          type: "object",
          description:
            'Optional value ids selected per Variable, for example {"language":["it"]} to run Italian only',
        },
        {
          name: "strategy",
          type: "zip | cartesian | pairwise",
          description: "Value coverage strategy",
        },
        {
          name: "executionMode",
          type: "pilot | all",
          description: "Pilot is the default. Pass --all to run every selected world.",
        },
        {
          name: "cellRuntimeProfiles",
          type: "array",
          description:
            "Explicit {testId, values, targetProfileId} bindings for every selected Test × world cell",
        },
        {
          name: "cellTargetBindings",
          type: "array",
          description:
            "Explicit [{testId, values, target}] local execution targets for every selected cell. A target is a versioned local-device Android/iOS reference; provider sessions are not capacity.",
        },
        {
          name: "localAdmission",
          type: "object",
          description:
            "Shared LocalCampaignAdmissionRequest: {deadlineMs, durationEvidence, setupHeadroomMs?, recoveryHeadroomMs?}. Evidence must be fresh observed p50/p95 data for every bound target × Test/action cohort.",
        },
        {
          name: "selectedCellIds",
          type: "array",
          description: "Optional subset of cell IDs to queue after offline preparation",
        },
        {
          name: "cell",
          type: "string",
          description: "World selector such as ja. Default without --all is one cell.",
        },
      ],
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "job.combine.campaign.get",
    path("combine campaign get", ["batchId"], undefined, {
      summary: "Inspect pilot, pending cases, problems, and resume state",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
    }),
  ),
  {
    operationId: "job.combine.campaign.repeat.active",
    exclusion: "internal",
    reason: "The Repeat workflow uses this read-only lookup to adopt durable unfinished work.",
  },
  mapped(
    "job.combine.campaign.resume",
    path("combine campaign resume", ["batchId"], undefined, {
      summary: "Resume only untouched cases from current App Map truth",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
      inputHelp: [
        {
          name: "reviewed",
          type: "boolean",
          description: "Required after a pilot problem has been reviewed or repaired",
        },
      ],
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "job.combine.campaign.cancel",
    path("combine campaign cancel", ["batchId"], undefined, {
      summary: "Cancel active work and leave untouched cases unscheduled",
      argumentHelp: [{ name: "batchId", type: "string", description: "Combine campaign ID" }],
    }),
  ),
  mapped(
    "job.combine.export",
    path("combine export", ["batchId"], undefined, {
      summary: "Export a Combine screenshot pack",
      examples: ["relay combine export <batch-id>"],
      note: "Writes <locale>/screenshots/ plus <locale>/accessibility/*.json as a portable review folder.",
    }),
    path("job combine export", ["batchId"], undefined, {
      summary: "Export a Combine screenshot pack",
    }),
  ),
  mapped(
    "job.combine.analysis",
    path("combine analyze", ["batchId"], undefined, {
      summary: "Read durable findings from a Variable × Test Combine",
      note: "Reads the current Combine evidence without writing a pack.",
    }),
  ),

  ...runEvidenceCommandDescriptors,
  mapped(
    "run.trace-pack.get",
    path("run trace-pack get", ["runId"], undefined, {
      summary: "Export one content-addressed Run TracePack for offline analysis",
    }),
  ),
  mapped(
    "run.repair.list",
    path("repair list", [], undefined, {
      summary: "List addressable failed-check repair targets",
    }),
    path("run repair list"),
  ),
  mapped(
    "run.repair.get",
    path("repair get", ["runId", "checkId"], undefined, {
      summary: "Inspect one complete failed-check repair package",
    }),
    path("run repair get", ["runId", "checkId"]),
  ),
  mapped(
    "run.repair.retry",
    path("repair retry", ["runId", "checkId"], undefined, {
      summary: "Retry only one failed check from immutable run evidence",
      behavior: "job-start-watch",
      note: "Proves the live origin, then runs only the warm failed check. No setup or app launch is replayed; the original run and saved Test remain unchanged.",
    }),
    path("run repair retry", ["runId", "checkId"], undefined, {
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "run.repair.propose",
    path("repair propose", ["runId", "checkId"], undefined, {
      summary: "Create a reversible review branch from one failed check",
      inputHelp: [
        {
          name: "kind",
          type: "retarget | accept-current | disable",
          required: true,
          description: "Reviewed document change; never mutates the source run",
        },
        { name: "reason", type: "string", required: true, description: "Audit reason" },
        {
          name: "selector",
          type: "object",
          description: "Exact successful runtime selector; required only for retarget",
        },
        {
          name: "equivalentTargets",
          type: "array",
          description: "Same-diff run/check pairs reviewed together without merging their evidence",
        },
      ],
      examples: [
        'relay repair propose <run-id> <check-id> --input \'{"kind":"retarget","reason":"Reviewed current accessibility id","selector":{"identifier":"settings-row"}}\'',
      ],
    }),
  ),
  mapped(
    "run.replay",
    path("run replay", ["runId"], undefined, {
      summary: "Replay a persisted run's recorded device actions",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      examples: ["relay run replay <run-id>"],
      note: "Requires exclusive control of the original target and watches the replay job to completion.",
      behavior: "job-start-watch",
    }),
  ),
  mapped("run.catalog.rebuild", path("run catalog rebuild")),
  mapped("run.retention.apply", path("run retention apply")),
  mapped(
    "run.review",
    path("run review", ["runId"], undefined, {
      summary: "Approve or reject a deferred verification",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        {
          name: "action",
          type: '"approve" | "reject"',
          required: true,
          description: "Approve the check as correct or reject it",
        },
        { name: "note", type: "string", description: "Optional reviewer note" },
      ],
      examples: ['relay run review <run-id> --input \'{"action":"approve"}\''],
    }),
  ),
  mapped(
    "run.visual-baseline.update",
    path("run visual-baseline update", ["runId"], { action: "approve-new-baseline" }),
    path(
      "run approve",
      ["runId"],
      { action: "approve-new-baseline" },
      {
        summary: "Approve a run as the visual baseline",
        argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      },
    ),
  ),
  mapped("run.visual.compare", path("run visual compare", ["runId"])),
  mapped("run.visual.review", path("run visual review", ["runId"])),
  mapped("run.visual-policy.get", path("run visual-policy get", ["runId"])),
  mapped("run.visual-policy.update", path("run visual-policy update", ["runId"])),
  mapped(
    "run.pin.update",
    path("run pin update", ["runId"]),
    path("run pin", ["runId"], undefined, {
      summary: "Pin or unpin a run",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [{ name: "pinned", type: "boolean", description: "Defaults to true" }],
    }),
  ),
  mapped("step.run", path("run step", ["serial"])),
  mapped("generation.create", path("generation create")),
  mapped(
    "action.run",
    path("action run", ["actionId", "serial"]),
    path("routine run", ["actionId", "serial"], undefined, {
      summary: "Run a reusable routine on a device",
      argumentHelp: [
        { name: "routineId", type: "string", description: "Reusable action identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      examples: ["relay routine run login emulator-5554"],
    }),
  ),
];

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
): ResolvedCommand {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const tokens = candidate.command.split(" ");
      const argumentKeys = candidate.arguments ?? [];
      if (positionals.length !== tokens.length + argumentKeys.length) continue;
      if (!tokens.every((token, index) => positionals[index] === token)) continue;

      let constructed = mergeRecords({}, input);
      if (candidate.fixedInput) constructed = mergeRecords(constructed, candidate.fixedInput);
      argumentKeys.forEach((key, index) => {
        setInputPath(constructed, key, positionals[tokens.length + index]!);
      });
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
    const missingArguments = argumentKeys.slice(providedArguments);
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
  throw new UsageError(`Unknown command: ${positionals.join(" ")}. Run 'relay help'.`);
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
