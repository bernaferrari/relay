import type {
  ConnectTargetIntent,
  ContinueRepeatOutcomeIntent,
  ExportEvidenceIntent,
  EditRecordingOutcomeIntent,
  InspectFailureIntent,
  ObserveTargetIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RepeatTestOutcomeIntent,
  RunTestOutcomeIntent,
} from "@relay/workflows";
import type {
  AuthoringInteraction,
  AuthoringRecordingEdit,
  RepeatDimensionSpec,
  RepeatPilotSpec,
} from "@relay/protocol";
import { UsageError } from "./errors.js";

export type OutcomeCliIntent =
  | ConnectTargetIntent
  | ObserveTargetIntent
  | ContinueRepeatOutcomeIntent
  | RecordTestOutcomeIntent
  | RunTestOutcomeIntent
  | RepeatTestOutcomeIntent
  | InspectFailureIntent
  | ProposeRepairIntent
  | ExportEvidenceIntent
  | EditRecordingOutcomeIntent;

type OutcomeCommandTokens = {
  positionals: readonly string[];
  values: ReadonlyMap<string, string>;
  switches: ReadonlySet<string>;
};

export function parseInFlags(raw: string | undefined): Record<string, string[]> {
  if (raw === undefined) return {};
  const worlds: Record<string, string[]> = {};
  for (const token of raw.split("\u0000")) {
    const equals = token.indexOf("=");
    if (equals < 1) throw new UsageError("--in requires variableId=value[,value]");
    const variableId = token.slice(0, equals).trim();
    const valueIds = token
      .slice(equals + 1)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!variableId || !valueIds.length) {
      throw new UsageError("--in requires variableId=value[,value]");
    }
    worlds[variableId] = [...(worlds[variableId] ?? []), ...valueIds];
  }
  return worlds;
}

function repeatDimensions(raw: string, flag: "--each" | "--in"): RepeatDimensionSpec[] {
  const dimensions: RepeatDimensionSpec[] = [];
  const seen = new Set<string>();
  for (const token of raw.split("\u0000")) {
    const equals = token.indexOf("=");
    if (equals < 1) throw new UsageError(`${flag} requires dimension=value[,value]`);
    const id = token.slice(0, equals).trim();
    const rawValues = token.slice(equals + 1).trim();
    if (!id || !rawValues) throw new UsageError(`${flag} requires dimension=value[,value]`);
    if (seen.has(id)) throw new UsageError(`${flag} must name each dimension once`);
    seen.add(id);
    if (flag === "--each" && (rawValues === "all" || rawValues === "supported")) {
      dimensions.push({ id, values: rawValues });
      continue;
    }
    const values = rawValues
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length || new Set(values).size !== values.length) {
      throw new UsageError(`${flag} values must be a distinct comma-separated list`);
    }
    dimensions.push({ id, values });
  }
  return dimensions;
}

function repeatPilot(raw: string | undefined): RepeatPilotSpec | undefined {
  if (raw === undefined) return undefined;
  if (raw === "representative" || raw === "first") return { mode: raw };
  const entries = raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const selected: Record<string, string> = {};
  for (const entry of entries) {
    const equals = entry.indexOf("=");
    const id = entry.slice(0, equals).trim();
    const value = entry.slice(equals + 1).trim();
    if (equals < 1 || !id || !value || Object.hasOwn(selected, id)) {
      throw new UsageError(
        "--pilot must be representative, first, or dimension=value[,dimension=value]",
      );
    }
    selected[id] = value;
  }
  if (!Object.keys(selected).length) {
    throw new UsageError(
      "--pilot must be representative, first, or dimension=value[,dimension=value]",
    );
  }
  return { mode: "specified", case: selected };
}

function actionIds(value: string): string[] {
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new UsageError("recording edit action ids must be a distinct comma-separated list");
  }
  return ids;
}

function parseRecordingEdit(args: readonly string[]): AuthoringRecordingEdit {
  const [kind, subject, detail] = args;
  if (kind === "remove" && args.length === 2) return { kind, actionIds: actionIds(subject!) };
  if (kind === "reorder" && args.length === 2) return { kind, actionIds: actionIds(subject!) };
  if (kind === "merge" && (args.length === 2 || args.length === 3)) {
    return {
      kind,
      actionIds: actionIds(subject!),
      ...(detail?.trim() ? { intent: detail.trim() } : {}),
    };
  }
  if (kind === "split" && args.length === 3) {
    const atStep = Number(detail);
    if (!Number.isInteger(atStep) || atStep < 1) {
      throw new UsageError("split requires a positive step position");
    }
    return { kind, actionId: subject!, atStep };
  }
  if (kind === "rename" && args.length === 3 && detail?.trim()) {
    return { kind, actionId: subject!, intent: detail.trim() };
  }
  if (kind === "replace" && args.length === 3) {
    try {
      const interaction = JSON.parse(detail!) as AuthoringInteraction;
      if (!interaction || typeof interaction !== "object" || !("kind" in interaction)) {
        throw new TypeError("missing interaction kind");
      }
      return { kind, actionId: subject!, interaction };
    } catch {
      throw new UsageError("replace requires one JSON interaction object");
    }
  }
  throw new UsageError(
    "edit-recording requires remove, reorder, replace, merge, split, or rename arguments",
  );
}

/** Parse only the small outcome vocabulary. Returning undefined lets the
 * caller fall back to the advanced canonical command families. */
export function parseOutcomeCliIntent(tokens: OutcomeCommandTokens): OutcomeCliIntent | undefined {
  const [verb, ...args] = tokens.positionals;
  const targetId = tokens.values.get("--device");
  const selectedMap = tokens.values.get("--map");
  if (
    verb !== "repeat" &&
    ["--each", "--strategy", "--pilot", "--resume"].some((flag) => tokens.values.has(flag))
  ) {
    throw new UsageError("--each, --strategy, --pilot, and --resume are only valid on repeat");
  }
  if (verb === "connect" && args.length <= 1) {
    if (selectedMap || tokens.values.has("--in") || tokens.values.has("--lens")) {
      throw new UsageError("connect accepts only an optional device id");
    }
    return { kind: "connect-target", ...(args[0] ? { targetId: args[0] } : {}) };
  }
  if (verb === "observe" && args.length <= 1) {
    if (
      selectedMap ||
      tokens.values.has("--in") ||
      tokens.values.has("--lens") ||
      tokens.switches.has("--all") ||
      tokens.switches.has("--confirm")
    ) {
      throw new UsageError("observe accepts only an optional device id");
    }
    return { kind: "observe-target", ...(args[0] ? { targetId: args[0] } : {}) };
  }
  if (verb === "record" && (args.length === 1 || args.length === 2)) {
    if (tokens.values.has("--in") || tokens.values.has("--lens") || tokens.switches.has("--all")) {
      throw new UsageError("record does not accept Repeat flags");
    }
    if (!tokens.switches.has("--confirm")) {
      throw new UsageError("record requires --confirm before Relay may acquire target control");
    }
    return {
      kind: "record-test",
      ...(selectedMap || args.length === 2 ? { appMapId: selectedMap ?? args[0]! } : {}),
      title: args.at(-1)!,
      confirmControl: true,
      ...(targetId ? { targetId } : {}),
    };
  }
  if (verb === "edit-recording" && args.length >= 4) {
    return {
      kind: "edit-recording",
      ref: args[0]! as EditRecordingOutcomeIntent["ref"],
      expectedVersion: args[1]!,
      edit: parseRecordingEdit(args.slice(2)),
    };
  }
  if (verb === "run" && (args.length === 1 || args.length === 2)) {
    if (tokens.values.has("--in") || tokens.values.has("--lens") || tokens.switches.has("--all")) {
      throw new UsageError("run executes one Test once; use repeat for selected values");
    }
    return {
      kind: "run-test",
      ...(selectedMap || args.length === 2 ? { appMapId: selectedMap ?? args[0]! } : {}),
      testId: args.at(-1)!,
      ...(targetId ? { targetId } : {}),
    };
  }
  if (verb === "repeat" && (args.length === 1 || args.length === 2)) {
    if (tokens.switches.has("--all") || tokens.values.has("--cell")) {
      throw new UsageError(
        "repeat always runs a representative pilot first; continue explicitly after review",
      );
    }
    const each = tokens.values.get("--each");
    const legacy = tokens.values.get("--in");
    if (each && legacy) throw new UsageError("repeat accepts --each or compatible --in, not both");
    const dimensions = repeatDimensions(each ?? legacy ?? "", each ? "--each" : "--in");
    const rawStrategy = tokens.values.get("--strategy");
    if (
      rawStrategy &&
      rawStrategy !== "cartesian" &&
      rawStrategy !== "zip" &&
      rawStrategy !== "pairwise"
    ) {
      throw new UsageError("repeat --strategy must be cartesian, zip, or pairwise");
    }
    const strategy =
      rawStrategy === "cartesian" || rawStrategy === "zip" || rawStrategy === "pairwise"
        ? rawStrategy
        : undefined;
    const pilot = repeatPilot(tokens.values.get("--pilot"));
    const rawResume = tokens.values.get("--resume");
    if (rawResume && rawResume !== "untouched" && rawResume !== "failed" && rawResume !== "all") {
      throw new UsageError("repeat --resume must be untouched, failed, or all");
    }
    const resume =
      rawResume === "untouched" || rawResume === "failed" || rawResume === "all"
        ? rawResume
        : undefined;
    const evidence = tokens.values.get("--lens");
    if (evidence !== undefined && evidence !== "visual" && evidence !== "smoke") {
      throw new UsageError("repeat --lens must be visual or smoke");
    }
    return {
      kind: "repeat-test",
      ...(selectedMap || args.length === 2 ? { appMapId: selectedMap ?? args[0]! } : {}),
      testId: args.at(-1)!,
      repeat: {
        dimensions,
        ...(strategy ? { strategy } : {}),
        ...(pilot ? { pilot } : {}),
        ...(resume ? { resume } : {}),
      },
      ...(evidence ? { evidence } : {}),
      ...(targetId ? { targetId } : {}),
    };
  }
  if (verb === "continue-repeat" && args.length === 2) {
    if (!tokens.switches.has("--confirm")) {
      throw new UsageError("continue-repeat requires --confirm after reviewing the pilot");
    }
    return {
      kind: "continue-repeat",
      ref: args[0]! as ContinueRepeatOutcomeIntent["ref"],
      expectedVersion: args[1]!,
      confirmRemaining: true,
    };
  }
  if (verb === "inspect-failure" && args.length === 1) {
    return { kind: "inspect-failure", runId: args[0]! };
  }
  if (verb === "propose-repair" && args.length === 4) {
    const proposal = args[2];
    if (proposal !== "accept-current" && proposal !== "disable") {
      throw new UsageError("propose-repair kind must be accept-current or disable");
    }
    return {
      kind: "propose-repair",
      runId: args[0]!,
      checkId: args[1]!,
      proposal,
      reason: args[3]!,
    };
  }
  if (verb === "export-evidence" && args.length === 1) {
    return { kind: "export-evidence", runId: args[0]! };
  }
  return undefined;
}
