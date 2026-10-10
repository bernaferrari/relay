import type {
  ConnectTargetIntent,
  CancelRunOutcomeIntent,
  ContinueRepeatOutcomeIntent,
  ExportEvidenceIntent,
  EditRecordingOutcomeIntent,
  InspectFailureIntent,
  InspectWorkflowOutcomeIntent,
  ObserveTargetIntent,
  ProposeRepairIntent,
  RecordTestOutcomeIntent,
  RepeatTestOutcomeIntent,
  RunTestOutcomeIntent,
  VerifyChangeOutcomeIntent,
  GoalSessionResumeIntent,
  GoalSessionReproduceIntent,
  GoalSessionInspectIntent,
  GoalSessionCancelIntent,
  GoalSessionStartIntent,
  GoalExplorationResumeIntent,
  GoalExplorationInspectIntent,
  GoalExplorationStartIntent,
  GoalPromotionIntent,
} from "@relay/workflows";
import type {
  AuthoringInteraction,
  AuthoringRecordingEdit,
  RepeatDimensionSpec,
  RepeatPilotSpec,
} from "@relay/protocol";
import { UsageError } from "./errors.js";
import type { ReplayLabFileIntent } from "./replay-lab-files.js";

export type DoctorIntent = { kind: "doctor" };
export type InspectCliIntent = { kind: "inspect"; runOrWorkflowId: string };

export type OutcomeCliIntent =
  | ConnectTargetIntent
  | ObserveTargetIntent
  | InspectCliIntent
  | InspectWorkflowOutcomeIntent
  | CancelRunOutcomeIntent
  | ContinueRepeatOutcomeIntent
  | RecordTestOutcomeIntent
  | RunTestOutcomeIntent
  | RepeatTestOutcomeIntent
  | InspectFailureIntent
  | ProposeRepairIntent
  | ExportEvidenceIntent
  | EditRecordingOutcomeIntent
  | DoctorIntent
  | ReplayLabFileIntent
  | GoalSessionStartIntent
  | GoalSessionResumeIntent
  | GoalSessionReproduceIntent
  | GoalSessionInspectIntent
  | GoalSessionCancelIntent
  | GoalExplorationStartIntent
  | GoalExplorationResumeIntent
  | GoalExplorationInspectIntent
  | GoalPromotionIntent
  | ProofAnalyzeCliIntent;

/** CLI-only name for the read-only analysis seam. The workflow façade still
 * owns the historical protocol projection (`kind: verify-change`) so this
 * migration does not fork domain behavior or result schemas. */
export type ProofAnalyzeCliIntent = Omit<VerifyChangeOutcomeIntent, "kind"> & {
  kind: "proof-analyze";
};

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
  // --app is the everyday spelling; --map stays for scripts.
  const selectedMap = tokens.values.get("--map") ?? tokens.values.get("--app");
  if (
    verb !== "repeat" &&
    verb !== "goal" &&
    verb !== "explore" &&
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
  if (verb === "goal" || verb === "explore") {
    if (verb === "goal" && args[0] === "inspect") {
      if (args.length !== 2 || tokens.values.size > 0 || tokens.switches.size > 0) {
        throw new UsageError("goal inspect requires one goal session id and no control flags");
      }
      return { kind: "goal-inspect", sessionId: args[1]! };
    }
    if (verb === "goal" && args[0] === "cancel") {
      if (args.length !== 2) {
        throw new UsageError("goal cancel requires one goal session id");
      }
      if (!tokens.switches.has("--confirm")) {
        throw new UsageError("goal cancel requires --confirm before Relay may stop a session");
      }
      if (tokens.values.size > 0 || [...tokens.switches].some((flag) => flag !== "--confirm")) {
        throw new UsageError("goal cancel accepts a session id and --confirm only");
      }
      return { kind: "goal-cancel", sessionId: args[1]! };
    }
    if (verb === "explore" && tokens.values.has("--inspect")) {
      const explorationId = tokens.values.get("--inspect");
      if (
        !explorationId ||
        args.length > 0 ||
        tokens.values.size !== 1 ||
        tokens.switches.size > 0
      ) {
        throw new UsageError("explore --inspect requires one exploration id and no control flags");
      }
      return { kind: "goal-explore-inspect", explorationId };
    }
    const rawResume = tokens.values.get("--resume");
    const isResume = (verb === "goal" && args[0] === "resume") || Boolean(rawResume);
    if (isResume) {
      const sessionId = verb === "goal" && args[0] === "resume" ? args[1] : rawResume;
      if (!sessionId || (verb === "goal" && args.length !== 2)) {
        throw new UsageError("goal resume requires one goal session id");
      }
      if (
        tokens.values.size > (rawResume ? 1 : 0) ||
        [...tokens.switches].some((flag) => flag !== "--confirm")
      ) {
        throw new UsageError("goal resume accepts a session id and --confirm");
      }
      if (!tokens.switches.has("--confirm")) {
        throw new UsageError(
          "goal resume requires --confirm before Relay may interact with a target",
        );
      }
      return verb === "explore"
        ? { kind: "goal-explore-resume", explorationId: sessionId }
        : { kind: "goal-resume", sessionId };
    }
    if (verb === "goal" && (args[0] === "reproduce" || args[0] === "promote")) {
      if (args.length !== 2) {
        throw new UsageError(`goal ${args[0]} requires one goal session id`);
      }
      if (!tokens.switches.has("--confirm")) {
        throw new UsageError(
          `goal ${args[0]} requires --confirm before Relay may control a target`,
        );
      }
      if (args[0] === "reproduce") {
        if (selectedMap || tokens.values.has("--title")) {
          throw new UsageError("goal reproduce accepts only a session id and --confirm");
        }
        return { kind: "goal-reproduce", sessionId: args[1]! };
      }
      if (tokens.values.has("--url") || tokens.values.has("--device")) {
        throw new UsageError("goal promote accepts --map or --title, not a target selector");
      }
      return {
        kind: "goal-promote",
        sessionId: args[1]!,
        ...(selectedMap ? { appMapId: selectedMap } : {}),
        ...(tokens.values.get("--title") ? { title: tokens.values.get("--title") } : {}),
        confirmControl: true,
      };
    }
    if (verb === "goal" && args.length > 1 && args[0] !== "run") {
      throw new UsageError("goal accepts run or resume");
    }
    if (tokens.values.has("--resume")) {
      throw new UsageError("goal start cannot use --resume");
    }
    if (!tokens.switches.has("--confirm")) {
      throw new UsageError("goal requires --confirm before Relay may interact with a target");
    }
    const goal = tokens.values.get("--goal")?.trim();
    const startUrl = tokens.values.get("--url")?.trim();
    if (!goal) throw new UsageError("goal requires --goal");
    if ((startUrl === undefined) === (targetId === undefined)) {
      throw new UsageError("goal requires exactly one of --url or --device");
    }
    const rawSteps = tokens.values.get("--max-steps");
    const rawDuration = tokens.values.get("--max-ms");
    const rawAgents = tokens.values.get("--agents");
    const repeat = (flag: string): string[] =>
      (tokens.values.get(flag) ?? "").split("\u0000").filter(Boolean);
    const valueEntries = repeat("--value").map((entry) => {
      const split = entry.indexOf("=");
      if (split <= 0 || !entry.slice(0, split).trim() || !entry.slice(split + 1)) {
        throw new UsageError(
          "--value must be name=text (values are plain inputs, not credentials)",
        );
      }
      return [entry.slice(0, split).trim(), entry.slice(split + 1)] as const;
    });
    const missions = repeat("--mission")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (missions.length > 0 && verb !== "explore") {
      throw new UsageError("--mission is only valid on explore; each mission drives one worker");
    }
    const judge = tokens.values.get("--judge");
    const authenticationFixtureReference = tokens.values.get("--auth-fixture");
    const maxSteps = rawSteps === undefined ? undefined : Number(rawSteps);
    const maxDurationMs = rawDuration === undefined ? undefined : Number(rawDuration);
    if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 40)) {
      throw new UsageError("--max-steps must be an integer between 1 and 40");
    }
    if (
      maxDurationMs !== undefined &&
      (!Number.isInteger(maxDurationMs) || maxDurationMs < 1_000 || maxDurationMs > 900_000)
    ) {
      throw new UsageError("--max-ms must be an integer between 1000 and 900000");
    }
    const agents = rawAgents === undefined ? undefined : Number(rawAgents);
    if (
      agents !== undefined &&
      (!Number.isInteger(agents) || agents < 1 || agents > 4 || verb !== "explore")
    ) {
      throw new UsageError(
        "--agents is only valid on explore and must be an integer between 1 and 4",
      );
    }
    if (judge !== undefined && (judge !== "jev" || verb !== "explore")) {
      throw new UsageError("--judge must be jev and is only valid on explore");
    }
    if (authenticationFixtureReference && startUrl) {
      throw new UsageError(
        "--auth-fixture requires an existing managed browser selected by --device",
      );
    }
    if (verb === "explore") {
      const intent: GoalExplorationStartIntent = {
        kind: "goal-explore",
        goal,
        ...(startUrl ? { startUrl } : {}),
        ...(targetId ? { targetId } : {}),
        ...(tokens.values.get("--lane") ? { laneId: tokens.values.get("--lane") } : {}),
        ...(authenticationFixtureReference ? { authenticationFixtureReference } : {}),
        ...(tokens.values.get("--model") ? { model: tokens.values.get("--model") } : {}),
        ...(maxSteps === undefined ? {} : { maxSteps }),
        ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
        ...(agents === undefined ? {} : { agents }),
        ...(missions.length > 0 ? { missions } : {}),
        ...(valueEntries.length > 0 ? { values: Object.fromEntries(valueEntries) } : {}),
      };
      return intent;
    }
    const intent: GoalSessionStartIntent = {
      kind: "goal-start",
      goal,
      ...(valueEntries.length > 0 ? { values: Object.fromEntries(valueEntries) } : {}),
      ...(startUrl ? { startUrl } : {}),
      ...(targetId ? { targetId } : {}),
      ...(tokens.values.get("--lane") ? { laneId: tokens.values.get("--lane") } : {}),
      ...(authenticationFixtureReference ? { authenticationFixtureReference } : {}),
      ...(tokens.values.get("--model") ? { model: tokens.values.get("--model") } : {}),
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
    };
    return intent;
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
    const expectedVersion = Number(args[1]);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new UsageError("edit-recording expectedVersion must be a positive integer");
    }
    return {
      kind: "edit-recording",
      workflowId: args[0]!,
      expectedVersion,
      edit: parseRecordingEdit(args.slice(2)),
    };
  }
  if (verb === "run" && (args.length === 1 || args.length === 2)) {
    if (tokens.values.has("--in") || tokens.values.has("--lens") || tokens.switches.has("--all")) {
      throw new UsageError("run executes one Test once; use repeat for selected values");
    }
    const laneId = tokens.values.get("--lane");
    if (laneId && targetId) {
      throw new UsageError("run accepts --lane or --device, not both; the Lane carries the target");
    }
    return {
      kind: "run-test",
      ...(selectedMap || args.length === 2 ? { appMapId: selectedMap ?? args[0]! } : {}),
      testId: args.at(-1)!,
      ...(laneId ? { laneId } : {}),
      ...(targetId ? { targetId } : {}),
      ...(tokens.switches.has("--confirm") ? { confirmRisk: true } : {}),
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
      ...(tokens.switches.has("--confirm") ? { confirmRisk: true } : {}),
    };
  }
  if (verb === "continue-repeat" && args.length === 2) {
    if (!tokens.switches.has("--confirm")) {
      throw new UsageError("continue-repeat requires --confirm after reviewing the pilot");
    }
    const expectedVersion = Number(args[1]);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new UsageError("continue-repeat expectedVersion must be a positive integer");
    }
    return {
      kind: "continue-repeat",
      workflowId: args[0]!,
      expectedVersion,
      confirmRemaining: true,
    };
  }
  // inspect accepts canonical Runs and workflows plus bounded legacy references.
  if (verb === "inspect" && args.length === 1) {
    if (args[0]!.startsWith("relay-workflow.v1.") && args[0]!.length > 96 * 1024) {
      throw new UsageError("legacy workflow reference exceeds the bounded input limit");
    }
    return args[0]!.startsWith("relay-workflow.v1.")
      ? {
          kind: "inspect-workflow",
          legacyRef: args[0]! as Extract<
            InspectWorkflowOutcomeIntent,
            { legacyRef: unknown }
          >["legacyRef"],
        }
      : { kind: "inspect", runOrWorkflowId: args[0]! };
  }
  if (verb === "cancel-run" && args.length === 2) {
    if (!tokens.switches.has("--confirm")) {
      throw new UsageError("cancel-run requires --confirm");
    }
    const expectedVersion = Number(args[1]);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new UsageError("cancel-run expectedVersion must be a positive integer");
    }
    return {
      kind: "cancel-run",
      workflowId: args[0]!,
      expectedVersion,
      confirmCancel: true,
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
  if (verb === "doctor") {
    if (args.length !== 0) throw new UsageError("doctor does not take arguments");
    const extra = [...tokens.switches].filter(
      (flag) => flag !== "--json" && flag !== "--ndjson" && flag !== "--quiet",
    );
    if (extra.length > 0 || tokens.values.size > 0) {
      throw new UsageError("doctor does not take options");
    }
    return { kind: "doctor" };
  }
  if (verb === "export" && args.length === 1) {
    const outputDir = tokens.values.get("--output") ?? tokens.values.get("--out");
    return {
      kind: "export-evidence",
      runId: args[0]!,
      ...(outputDir ? { outputDir } : {}),
    };
  }
  if (verb === "replay-lab" && args.length >= 3) {
    const [analysis, ...paths] = args;
    if (analysis !== "compare" && analysis !== "visual-localization" && analysis !== "all") {
      throw new UsageError("replay-lab analysis must be compare, visual-localization, or all");
    }
    if (new Set(paths).size !== paths.length) {
      throw new UsageError("replay-lab requires unique TracePack file paths in historical order");
    }
    return { kind: "replay-lab", analysis, paths };
  }
  // Offline analysis lives under the proof namespace (`relay proof analyze`).
  if (verb === "proof" && args[0] === "analyze") {
    const [scope, ...subjects] = args.slice(1);
    const confirmationSatisfied = tokens.switches.has("--confirm") || undefined;
    const analyze = (selection: ProofAnalyzeCliIntent["selection"]): ProofAnalyzeCliIntent => ({
      kind: "proof-analyze",
      selection,
      ...(confirmationSatisfied ? { confirmationSatisfied } : {}),
    });
    if (scope === "run" && subjects.length > 0) return analyze({ kind: "runs", runIds: subjects });
    if (scope === "test" && subjects.length > 1) {
      return analyze({ kind: "tests", appMapId: subjects[0]!, testIds: subjects.slice(1) });
    }
    if (scope === "revision" && subjects.length === 1 && /^[0-9a-f]{7,40}$/u.test(subjects[0]!)) {
      return analyze({
        kind: "source-revision",
        sourceRevision: { vcs: "git", sha: subjects[0]! },
      });
    }
    throw new UsageError(
      "proof analyze requires run <runId...>, test <appMapId> <testId...>, or revision <gitSha>",
    );
  }
  return undefined;
}
