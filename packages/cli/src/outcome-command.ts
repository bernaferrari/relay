import type {
  ConnectTargetIntent,
  ContinueRepeatOutcomeIntent,
  ExportEvidenceIntent,
  InspectFailureIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RepeatTestOutcomeIntent,
  RunTestOutcomeIntent,
} from "@relay/workflows";
import { UsageError } from "./errors.js";

export type OutcomeCliIntent =
  | ConnectTargetIntent
  | ContinueRepeatOutcomeIntent
  | RecordTestOutcomeIntent
  | RunTestOutcomeIntent
  | RepeatTestOutcomeIntent
  | InspectFailureIntent
  | ProposeRepairIntent
  | ExportEvidenceIntent;

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

/** Parse only the small outcome vocabulary. Returning undefined lets the
 * caller fall back to the advanced canonical command families. */
export function parseOutcomeCliIntent(tokens: OutcomeCommandTokens): OutcomeCliIntent | undefined {
  const [verb, ...args] = tokens.positionals;
  const targetId = tokens.values.get("--device");
  const selectedMap = tokens.values.get("--map");
  if (verb === "connect" && args.length <= 1) {
    if (selectedMap || tokens.values.has("--in") || tokens.values.has("--lens")) {
      throw new UsageError("connect accepts only an optional device id");
    }
    return { kind: "connect-target", ...(args[0] ? { targetId: args[0] } : {}) };
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
    const dimensions = Object.entries(parseInFlags(tokens.values.get("--in")));
    if (dimensions.length !== 1) {
      throw new UsageError("repeat requires exactly one --in dimension=value[,value]");
    }
    const [dimensionId, valueIds] = dimensions[0]!;
    const evidence = tokens.values.get("--lens");
    if (evidence !== undefined && evidence !== "visual" && evidence !== "smoke") {
      throw new UsageError("repeat --lens must be visual or smoke");
    }
    return {
      kind: "repeat-test",
      ...(selectedMap || args.length === 2 ? { appMapId: selectedMap ?? args[0]! } : {}),
      testId: args.at(-1)!,
      over: { dimensionId, valueIds },
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
