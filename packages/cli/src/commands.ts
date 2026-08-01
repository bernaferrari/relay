import { operationDefinitions, type OperationId } from "@relay/protocol";
import { UsageError } from "./errors.js";

export type CliExclusionReason = "ui-only" | "internal" | "unsafe";

export type CommandPathDescriptor = {
  command: string;
  arguments?: readonly string[];
  fixedInput?: Readonly<Record<string, unknown>>;
};

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

const path = (
  command: string,
  arguments_: readonly string[] = [],
  fixedInput?: Readonly<Record<string, unknown>>,
): CommandPathDescriptor => ({
  command,
  ...(arguments_.length ? { arguments: arguments_ } : {}),
  ...(fixedInput ? { fixedInput } : {}),
});

const mapped = (
  operationId: OperationId,
  ...paths: readonly CommandPathDescriptor[]
): MappedOperationDescriptor => ({ operationId, paths });

/**
 * The canonical human CLI vocabulary. This is routing metadata only: it may
 * construct an operation input, but it must never implement domain behavior.
 * Keep each registry operation in exactly one descriptor; aliases belong in
 * that descriptor's paths array.
 */
export const cliOperationDescriptors: readonly CliOperationDescriptor[] = [
  mapped("system.health.get", path("system health")),
  mapped("system.doctor.get", path("system doctor")),
  mapped("system.audit.list", path("system audit list")),
  mapped("event.stream", path("system events follow")),

  mapped("workspace.privacy.get", path("policy privacy get")),
  mapped("workspace.privacy.update", path("policy privacy update")),
  mapped("workspace.evidence.get", path("policy evidence get")),
  mapped("workspace.evidence.update", path("policy evidence update")),
  mapped("workspace.apple-device.update", path("workspace apple-device update")),
  mapped("workspace.variables.get", path("data variables get")),
  mapped("workspace.variables.update", path("data variables update")),

  mapped("target.actions.list", path("action list")),
  mapped("target.devices.list", path("target device list")),
  mapped("target.list", path("target list")),
  mapped("target.create", path("target create")),
  mapped("target.delete", path("target delete", ["targetId"])),
  mapped("target.preflight", path("target preflight", ["targetId"])),
  mapped("target.open", path("target open", ["targetId"])),
  mapped("target.boot", path("target boot", ["serial"])),
  mapped("target.authorize", path("target authorize", ["serial"])),
  mapped(
    "target.snapshot.capture",
    path("target observe", ["serial"]),
    path("target snapshot", ["serial"]),
  ),
  mapped("target.screenshot.capture", path("target screenshot", ["serial"])),
  mapped("target.interact", path("target interact", ["serial"])),
  mapped("target.touch", path("target touch", ["serial"])),
  mapped("target.key", path("target key", ["serial"])),
  mapped("target.scroll", path("target scroll", ["serial"])),
  mapped("target.video.start", path("target video", ["serial"])),

  mapped("project.list", path("project list")),
  mapped("project.save", path("project save")),
  mapped("build.list", path("build list")),
  mapped("build.save", path("build save")),
  mapped("device-pool.list", path("device-pool list")),
  mapped("device-pool.save", path("device-pool save")),
  mapped("lease.list", path("lease list")),
  mapped("lease.create", path("lease create")),
  mapped("lease.release", path("lease release", ["leaseId"])),

  mapped("journey.list", path("journey list")),
  mapped("journey.get", path("journey get", ["journeyId"])),
  mapped("journey.create", path("journey create")),
  mapped("journey.update", path("journey update", ["journeyId"])),
  mapped("journey.delete", path("journey delete", ["journeyId"])),
  mapped("journey.import", path("journey import")),
  mapped("journey.history.restore", path("journey history restore", ["journeyId"])),
  mapped("journey.evidence.save", path("journey evidence save", ["journeyId"])),
  mapped(
    "journey.document.get",
    path("journey document get", ["journeyId"]),
    path("screen list", ["journeyId"]),
    path("connection list", ["journeyId"]),
  ),
  mapped(
    "journey.document.update",
    path("journey document update", ["journeyId"]),
    path("screen update", ["journeyId"]),
    path("connection update", ["journeyId"]),
  ),
  mapped("collaboration.document.bootstrap", path("collaboration bootstrap", ["journeyId"])),
  mapped("collaboration.document.sync", path("collaboration sync", ["journeyId"])),
  mapped("collaboration.update.append", path("collaboration update append", ["journeyId"])),
  mapped("collaboration.status.get", path("collaboration status", ["journeyId"])),
  mapped("collaboration.document.export", path("collaboration export", ["journeyId"])),
  mapped("collaboration.document.repair", path("collaboration repair", ["journeyId"])),
  mapped("collaboration.awareness.publish", path("collaboration awareness publish", ["journeyId"])),
  mapped("collaboration.awareness.list", path("collaboration awareness list", ["journeyId"])),
  mapped("collaboration.awareness.remove", path("collaboration awareness remove", ["journeyId"])),

  mapped("authoring.session.list", path("session list")),
  mapped("authoring.session.get", path("session get", ["sessionId"])),
  mapped("authoring.session.create", path("session create")),
  mapped("authoring.session.observe", path("session observe", ["sessionId"])),
  mapped("authoring.session.start", path("session start", ["sessionId"])),
  mapped(
    "authoring.session.interact",
    path("session interact", ["sessionId"]),
    path("session tap", ["sessionId"], { interaction: { kind: "tap" } }),
    path("session type", ["sessionId"], { interaction: { kind: "type" } }),
    path("session swipe", ["sessionId"], { interaction: { kind: "swipe" } }),
    path("session back", ["sessionId"], { interaction: { kind: "key", key: "back" } }),
    path("session wait", ["sessionId"], { interaction: { kind: "wait" } }),
    path("session screenshot", ["sessionId"], { interaction: { kind: "screenshot" } }),
  ),
  mapped("authoring.session.stop", path("session stop", ["sessionId"])),
  mapped("authoring.take.trim", path("take trim", ["sessionId"])),
  mapped("authoring.take.reorder", path("take reorder", ["sessionId"])),
  mapped("authoring.take.replace", path("take replace", ["sessionId", "actionId"])),
  mapped("authoring.take.replay", path("take replay", ["sessionId"])),
  mapped("authoring.session.commit", path("session commit", ["sessionId"])),
  mapped("authoring.session.discard", path("session discard", ["sessionId"])),
  mapped("authoring.session.cancel", path("session cancel", ["sessionId"])),
  mapped("authoring.session.cleanup", path("session cleanup", ["sessionId"])),

  mapped("collection.list", path("collection list")),
  mapped("collection.get", path("collection get", ["collectionId"])),
  mapped("collection.create", path("collection create")),
  mapped("collection.update", path("collection update", ["collectionId"])),
  mapped("collection.delete", path("collection delete", ["collectionId"])),
  mapped("collection.restore", path("collection restore", ["collectionId"])),
  mapped("collection.run", path("collection run", ["collectionId"])),

  mapped("schedule.list", path("schedule list")),
  mapped("schedule.create", path("schedule create")),
  mapped("schedule.delete", path("schedule delete", ["scheduleId"])),
  mapped("matrix.list", path("matrix list")),
  mapped("matrix.create", path("matrix create")),
  mapped("matrix.update", path("matrix update", ["matrixId"])),
  mapped("matrix.delete", path("matrix delete", ["matrixId"])),
  mapped("matrix.import", path("matrix import")),
  mapped("matrix.resolve", path("matrix resolve", ["matrixId"])),

  mapped("discovery.list", path("discovery list")),
  mapped("discovery.create", path("discovery create")),
  mapped("discovery.rename", path("discovery rename", ["sessionId"])),
  mapped("discovery.status.update", path("discovery status update", ["sessionId"])),
  mapped("discovery.capture", path("discovery capture", ["sessionId", "serial"])),
  mapped("discovery.interact", path("discovery interact", ["sessionId", "serial"])),
  mapped("discovery.promote", path("discovery promote", ["sessionId"])),

  mapped("job.list", path("job list")),
  mapped("job.get", path("job get", ["jobId"]), path("job watch", ["jobId"])),
  mapped("job.start", path("job start")),
  mapped("job.retry", path("job retry", ["jobId"])),
  mapped("job.cancel", path("job cancel", ["jobId"])),
  mapped("job.pause", path("job pause", ["jobId"])),
  mapped("job.resume", path("job resume", ["jobId"])),
  mapped("job.active.cancel", path("job active cancel")),
  mapped("job.graph-path.start", path("job graph-path start")),
  mapped("job.matrix.start", path("job matrix start")),
  mapped("job.compatibility-matrix.start", path("job compatibility-matrix start")),
  mapped("job.soak.start", path("job soak start")),

  mapped("run.list", path("run list")),
  mapped("run.catalog.rebuild", path("run catalog rebuild")),
  mapped("run.retention.apply", path("run retention apply")),
  mapped("run.visual-baseline.update", path("run visual-baseline update", ["runId"])),
  mapped("run.pin.update", path("run pin update", ["runId"])),
  mapped("step.run", path("run step", ["serial"])),
  mapped("generation.create", path("generation create")),
  mapped("action.run", path("action run", ["actionId", "serial"])),
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
      const required = missingArguments.map((key) => `<${key.split(".").at(-1)}>`).join(", ");
      throw new UsageError(`${incomplete.candidate.command} requires ${required}`);
    }
    throw new UsageError(`Expected: relay ${formatCommandUsage(incomplete.candidate)}`);
  }

  const family = positionals[0];
  const familyPaths = mappedCommandDescriptors.flatMap((descriptor) =>
    descriptor.paths.filter((candidate) => candidate.command.split(" ")[0] === family),
  );
  if (familyPaths.length) {
    const usages = familyPaths
      .slice(0, 4)
      .map((candidate) => formatCommandUsage(candidate))
      .join(", ");
    throw new UsageError(`Invalid ${family} command. Expected one of: ${usages}`);
  }
  throw new UsageError(`Unknown command: ${positionals.join(" ")}. Run 'relay help'.`);
}

export function formatCommandUsage(descriptor: CommandPathDescriptor): string {
  const arguments_ = (descriptor.arguments ?? [])
    .map((key) => `<${key.split(".").at(-1)}>`)
    .join(" ");
  return `${descriptor.command}${arguments_ ? ` ${arguments_}` : ""}`;
}

export function operationLabel(operationId: OperationId): string {
  return operationById.get(operationId)?.label ?? operationId;
}
