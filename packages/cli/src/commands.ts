import { operationDefinitions, type OperationId } from "@relay/protocol";
import {
  appMapAuthoringCommandDescriptors,
  appMapRoutineCommandDescriptors,
} from "./app-map-commands.js";
import { appMapRunPlanCommandDescriptors } from "./app-map-run-plan-commands.js";
import { authoringSessionCommandDescriptors } from "./authoring-session-commands.js";
import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
  type CommandBehavior,
  type CommandPathDescriptor,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { UsageError } from "./errors.js";
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

  mapped("workspace.privacy.get", path("policy privacy get")),
  mapped("workspace.privacy.update", path("policy privacy update")),
  mapped("workspace.evidence.get", path("policy evidence get")),
  mapped("workspace.evidence.update", path("policy evidence update")),
  mapped("workspace.apple-device.update", path("workspace apple-device update")),
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
  ...appMapRunPlanCommandDescriptors,
  ...appMapRoutineCommandDescriptors,

  ...authoringSessionCommandDescriptors,

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
  mapped("discovery.suggestion", path("discovery suggestion", ["sessionId"])),
  mapped("discovery.coverage", path("discovery coverage", ["sessionId"])),
  mapped("discovery.export", path("discovery export", ["sessionId"])),
  mapped("discovery.promote", path("discovery promote", ["sessionId"])),

  mapped("corpus.list", path("corpus list")),
  mapped("corpus.create", path("corpus create")),
  mapped("corpus.get", path("corpus get", ["sessionId"])),
  mapped("corpus.rename", path("corpus rename", ["sessionId"])),
  mapped("corpus.status.update", path("corpus status update", ["sessionId"])),
  mapped("corpus.start", path("corpus start", ["sessionId"])),
  mapped("corpus.cancel", path("corpus cancel", ["sessionId"])),
  mapped("corpus.coverage", path("corpus coverage", ["sessionId"])),
  mapped("corpus.analysis", path("corpus analysis", ["sessionId"])),
  mapped("corpus.export", path("corpus export", ["sessionId"])),
  mapped("corpus.screen.get", path("corpus screen", ["sessionId", "screenId"])),

  mapped("language-profile.list", path("language-profile list")),
  mapped("language-profile.scan", path("language-profile scan")),
  mapped("language-profile.save", path("language-profile save")),
  mapped("switcher-profile.list", path("switcher-profile list")),
  mapped("switcher-profile.scan", path("switcher-profile scan")),
  mapped("switcher-profile.save", path("switcher-profile save")),

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
    "job.locale-matrix.start",
    path("job locale-matrix start", [], undefined, {
      summary: "Run a map path once per locale with screenshots",
      examples: [
        'relay job locale-matrix start --input \'{"appMapId":"<map>","flowId":"<flow>","serial":"<device>","locales":["en","pt-BR"]}\'',
      ],
      note: "Language-only alias of a run matrix. Prefer `relay run-matrix run` or `relay test run`.",
    }),
  ),
  mapped(
    "job.combine.start",
    path("job combine start", [], undefined, {
      summary: "Run state combinations × tests",
      examples: [
        'relay run-matrix run grok-ios language-x-settings --input \'{"serial":"<device>"}\'',
      ],
      note: "A run matrix applies one value from every selected state set, then runs every selected test. Prefer `relay test run` for one pass.",
      behavior: "job-start-watch",
    }),
    path("job option-matrix start", [], undefined, {
      summary: "Alias of job combine start",
      behavior: "job-start-watch",
    }),
    path("run-matrix run", ["appMapId", "combineId"], undefined, {
      summary: "Run a saved state sets × tests matrix",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved run matrix" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Device serial" },
        {
          name: "selected",
          type: "object",
          description:
            'Optional value ids selected per state set, for example {"language":["it"]} to run Italian only',
        },
        {
          name: "strategy",
          type: "zip | cartesian | pairwise",
          description: "State coverage strategy",
        },
      ],
      behavior: "job-start-watch",
    }),
    path("combine run", ["appMapId", "combineId"], undefined, {
      summary: "Legacy alias of run-matrix run",
      behavior: "job-start-watch",
    }),
    path("combo run", ["appMapId", "combineId"], undefined, {
      summary: "Legacy alias of run-matrix run",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "combineId", type: "string", description: "Saved combination" },
      ],
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "job.combine.infer",
    path("job combine infer", [], undefined, {
      summary: "Infer variable rows from taught live-screen rows",
      examples: [
        'relay job combine infer --input \'{"appMapId":"<map>","kind":"location","examples":[{"id":"nyc","label":"New York"}],"nodes":[]}\'',
      ],
    }),
    path("job option-matrix infer"),
  ),
  mapped(
    "job.combine.export",
    path("run-matrix export", ["batchId"], undefined, {
      summary: "Export a run matrix screenshot pack",
      examples: ["relay run-matrix export <batch-id>"],
    }),
    path("job combine export", ["batchId"], undefined, {
      summary: "Export run-matrix screenshot pack",
    }),
    path("job option-matrix export", ["batchId"]),
  ),
  mapped(
    "job.locale-matrix.infer",
    path("job locale-matrix infer", [], undefined, {
      summary: "Infer locale options from taught live-screen rows",
      examples: [
        'relay job locale-matrix infer --input \'{"appMapId":"<map>","flowId":"<flow>","examples":[{"locale":"en","identifier":"lang.en"}],"nodes":[]}\'',
      ],
      note: "Click or pass 1–2 taught rows. Pass appMapId so a recorded path to the language list is reused.",
    }),
  ),
  mapped(
    "job.locale-matrix.export",
    path("job locale-matrix export", ["batchId"], undefined, {
      summary: "Export locale-run screenshot pack",
    }),
  ),

  ...(
    [
      "recipe.list",
      "recipe.get",
      "recipe.create",
      "recipe.update",
      "recipe.delete",
      "recipe.yaml.get",
      "recipe.import",
      "recipe.evidence.create",
      "recipe.history.list",
      "recipe.history.restore",
      "recipe.stability.get",
    ] as const
  ).map((operationId) => ({
    operationId,
    exclusion: "internal" as const,
    reason: "Compiled recipe storage is internal; people and agents author App Map flows.",
  })),

  ...runEvidenceCommandDescriptors,
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

export type CliResourceDescriptor = {
  resourceId: string;
  label: string;
  path: CommandPathDescriptor;
  resourcePath(input: Readonly<Record<string, unknown>>): string;
};

function noResourceInput(input: Readonly<Record<string, unknown>>, path: string): void {
  if (Object.keys(input).length > 0) throw new UsageError(`${path} does not accept --input fields`);
}

function runResource(command: string, suffix: string, summary: string): CliResourceDescriptor {
  return {
    resourceId: command.replace(" ", "."),
    label: summary,
    path: path(command, ["runId"], undefined, {
      summary,
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string") throw new UsageError(`${command} requires <runId>`);
      const extra = { ...input };
      delete extra.runId;
      noResourceInput(extra, command);
      return `/runs/${encodeURIComponent(runId)}${suffix}`;
    },
  };
}

export const cliResourceDescriptors: readonly CliResourceDescriptor[] = [
  runResource("run get", "", "Get a persisted run and its evidence"),
  {
    resourceId: "run.evidence",
    label: "Get bounded structured run evidence",
    path: path("run evidence", ["runId"], undefined, {
      summary: "Inspect logs, network, performance, and collector status",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        { name: "limit", type: "number", description: "Maximum entries per evidence channel" },
        {
          name: "includeBodies",
          type: "boolean",
          description: "Include consented request/response bodies",
        },
      ],
      examples: ["relay run evidence <run-id> --input '{\"limit\":200}'"],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string" || !runId)
        throw new UsageError("run evidence requires <runId>");
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (
          !Number.isInteger(input.limit) ||
          Number(input.limit) < 1 ||
          Number(input.limit) > 2_000
        ) {
          throw new UsageError("run evidence limit must be an integer between 1 and 2000");
        }
        query.set("limit", String(input.limit));
      }
      if (input.includeBodies !== undefined) {
        if (typeof input.includeBodies !== "boolean") {
          throw new UsageError("run evidence includeBodies must be boolean");
        }
        if (input.includeBodies) query.set("includeBodies", "true");
      }
      const unknown = Object.keys(input).filter(
        (key) => !["runId", "limit", "includeBodies"].includes(key),
      );
      if (unknown.length)
        throw new UsageError(`run evidence does not accept: ${unknown.join(", ")}`);
      const suffix = query.size ? `?${query.toString()}` : "";
      return `/runs/${encodeURIComponent(runId)}/evidence${suffix}`;
    },
  },
  runResource("run signals", "/signals", "Get regression signals for a run"),
  runResource("run compare", "/visual-baseline", "Compare a run with its visual baseline"),
  {
    resourceId: "activity.list",
    label: "List durable project activity",
    path: path("activity list", [], undefined, {
      summary: "List durable human, agent, and system activity",
      inputHelp: [
        { name: "limit", type: "number", description: "Positive page size" },
        { name: "cursor", type: "string", description: "Cursor returned by the previous page" },
      ],
      examples: ["relay activity list --input '{\"limit\":50}'"],
    }),
    resourcePath(input) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || Number(input.limit) < 1) {
          throw new UsageError("activity list limit must be a positive integer");
        }
        query.set("limit", String(input.limit));
      }
      if (input.cursor !== undefined) {
        if (typeof input.cursor !== "string" || !input.cursor) {
          throw new UsageError("activity list cursor must be a non-empty string");
        }
        query.set("cursor", input.cursor);
      }
      const unknown = Object.keys(input).filter((key) => key !== "limit" && key !== "cursor");
      if (unknown.length)
        throw new UsageError(`activity list does not accept: ${unknown.join(", ")}`);
      const encoded = query.toString();
      return `/activity${encoded ? `?${encoded}` : ""}`;
    },
  },
];

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
