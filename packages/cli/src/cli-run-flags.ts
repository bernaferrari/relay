import { capturePolicyForLens, isCombineLensInput } from "@relay/protocol";
import { UsageError } from "./errors.js";
import { parseInFlags } from "./outcome-command.js";

export type CliFlagBag = {
  values: Map<string, string>;
  switches: Set<string>;
};

const BUDGET_PATTERN = /^(\d+)(ms|s|m|h)$/u;
const EVIDENCE_PACK_OPERATIONS = new Set(["job.combine.start", "job.combine.export"]);

/** Parse `3m`, `180s`, or `180000ms` into milliseconds. */
export function parseBudgetMs(raw: string): number {
  const matched = raw.trim().match(BUDGET_PATTERN);
  if (!matched) throw new UsageError("--budget must look like 3m, 180s, or 180000ms");
  const amount = Number(matched[1]);
  const unit = matched[2];
  const ms =
    unit === "ms"
      ? amount
      : unit === "s"
        ? amount * 1_000
        : unit === "m"
          ? amount * 60_000
          : amount * 3_600_000;
  if (!Number.isInteger(ms) || ms < 1_000 || ms > 43_200_000) {
    throw new UsageError("--budget must be from 1s to 12h");
  }
  return ms;
}

/** Test-run `--input '{"target":{kind,platform,targetId}}'` is the same fact
 * combine start stores as serial / browserTargetId. Flatten so `plan run`
 * accepts that shape without a strict-schema 400. */
export function flattenCombineStartTarget(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.target;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return input;
  const target = raw as {
    kind?: unknown;
    platform?: unknown;
    targetId?: unknown;
  };
  const targetId = typeof target.targetId === "string" ? target.targetId.trim() : "";
  if (!targetId) return input;
  const next = { ...input };
  delete next.target;
  if (target.kind === "browser" || target.platform === "browser") {
    return { ...next, browserTargetId: targetId, targetKind: "browser" };
  }
  return {
    ...next,
    serial: targetId,
    targetKind: "device",
    ...(target.platform === "android" || target.platform === "ios"
      ? { platform: target.platform }
      : {}),
  };
}

export function applyCombineRunFlags(
  operationId: string,
  input: Record<string, unknown>,
  tokens: CliFlagBag,
): Record<string, unknown> {
  const worlds = parseInFlags(tokens.values.get("--in"));
  const lens = tokens.values.get("--lens");
  const cell = tokens.values.get("--cell");
  const all = tokens.switches.has("--all");
  const usesWorlds = Object.keys(worlds).length > 0;
  const inputIn =
    input.in && typeof input.in === "object" && !Array.isArray(input.in)
      ? (input.in as Record<string, unknown>)
      : undefined;
  const hasIn = usesWorlds || Boolean(inputIn && Object.keys(inputIn).length);
  if (lens && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--lens is only valid on test run or plan run");
  }
  if (usesWorlds && operationId !== "app-map.test.run") {
    throw new UsageError("--in is only valid on test run");
  }
  if (cell && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--cell is only valid on test run or plan run");
  }
  if (all && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--all is only valid on test run or plan run");
  }
  if (operationId === "app-map.test.run" && !hasIn) {
    if (lens) throw new UsageError("--lens requires --in variableId=value[,value]");
    if (cell) throw new UsageError("--cell requires --in variableId=value[,value]");
    if (all) throw new UsageError("--all requires --in variableId=value[,value]");
  }
  if (operationId === "job.combine.start") input = flattenCombineStartTarget(input);
  if (!usesWorlds && !lens && !cell && !all) return applyLaneFlag(operationId, input, tokens);
  const next = { ...input };
  if (usesWorlds) next.in = worlds;
  if (lens) {
    if (!isCombineLensInput(lens)) {
      throw new UsageError(
        "--lens must be visual, smoke, every-screen, failures-only, final-screen, or none",
      );
    }
    if (operationId === "job.combine.start") next.capture = capturePolicyForLens(lens);
    else next.lens = lens;
  }
  if (cell) next.cell = cell;
  if (all) next.executionMode = "all";
  return applyLaneFlag(operationId, next, tokens);
}

const LANE_OPERATIONS = new Set([
  "app-map.test.run",
  "job.combine.start",
  "target.interact",
  "target.snapshot.capture",
  "target.screenshot.capture",
  "target.recover",
]);

/** `--lane <id>` becomes operation `laneId`. The server calls resolveLaneExecution. */
export function applyLaneFlag(
  operationId: string,
  input: Record<string, unknown>,
  tokens: CliFlagBag,
): Record<string, unknown> {
  const raw = tokens.values.get("--lane");
  if (raw === undefined) return input;
  const laneId = raw.trim();
  if (!laneId) throw new UsageError("--lane requires a Lane identifier");
  if (!LANE_OPERATIONS.has(operationId)) {
    throw new UsageError(
      "--lane is only valid on test run, plan run, device interact, snapshot, screenshot, or recover",
    );
  }
  if (tokens.values.has("--target") || tokens.values.has("--revision")) {
    throw new UsageError(
      "--lane already resolves target and revision; omit --target and --revision",
    );
  }
  if (typeof input.laneId === "string" && input.laneId !== laneId) {
    throw new UsageError("Use either --lane or laneId in --input, not both");
  }
  return { ...input, laneId };
}

/** `target.recover` takes a serial. A Lane names that serial or browser target. */
export function assertRecoverHasTarget(input: Record<string, unknown>): void {
  const serial = typeof input.serial === "string" ? input.serial.trim() : "";
  const laneId = typeof input.laneId === "string" ? input.laneId.trim() : "";
  if (!serial && !laneId) throw new UsageError("device recover requires a serial or --lane");
}

export function recoverInputFromLane(
  input: Record<string, unknown>,
  lanes: readonly {
    id?: string;
    target?: { kind?: string; serial?: string; browserTargetId?: string };
  }[],
): Record<string, unknown> {
  const laneId = typeof input.laneId === "string" ? input.laneId : undefined;
  if (!laneId) return input;
  if (typeof input.serial === "string" && input.serial.trim()) {
    throw new UsageError("device recover accepts a serial or --lane, not both");
  }
  const lane = lanes.find((item) => item.id === laneId);
  if (!lane?.target) throw new UsageError(`Lane ${laneId} was not found.`);
  const serial = lane.target.kind === "device" ? lane.target.serial : lane.target.browserTargetId;
  if (!serial) throw new UsageError(`Lane ${laneId} has no recoverable target.`);
  const { laneId: _laneId, ...rest } = input;
  return { ...rest, serial };
}

export function assertPlanCliFlags(operationId: string, tokens: CliFlagBag): void {
  if (tokens.values.has("--triage") && tokens.values.get("--triage") !== "jev") {
    throw new UsageError('--triage currently accepts only "jev"');
  }
  if (
    tokens.values.has("--triage") &&
    operationId !== "job.combine.start" &&
    operationId !== "job.combine.analysis"
  ) {
    throw new UsageError("--triage is only valid on plan run or plan findings");
  }
  if (
    tokens.values.has("--triage") &&
    operationId === "job.combine.start" &&
    !tokens.switches.has("--findings")
  ) {
    throw new UsageError("--triage on plan run requires --findings");
  }
  if (tokens.values.has("--budget") && operationId !== "job.combine.start") {
    throw new UsageError("--budget is only valid on plan run");
  }
  if (
    tokens.switches.has("--findings") &&
    operationId !== "job.combine.start" &&
    operationId !== "job.combine.analysis"
  ) {
    throw new UsageError("--findings is only valid on plan run or plan findings");
  }
  if (tokens.values.has("--export") && !EVIDENCE_PACK_OPERATIONS.has(operationId)) {
    throw new UsageError("--export is only valid on plan run or plan export");
  }
  if (tokens.values.has("--todo") && !EVIDENCE_PACK_OPERATIONS.has(operationId)) {
    throw new UsageError("--todo is only valid on plan run or plan export");
  }
}

export function evidencePackCliFlags(
  tokens: CliFlagBag,
  operationId?: string,
  wait?: boolean,
): {
  exportDir?: string;
  todoFile?: string;
} {
  const exportDir = tokens.values.get("--export")?.trim();
  const todoFile = tokens.values.get("--todo")?.trim();
  if (tokens.values.has("--export") && !exportDir) {
    throw new UsageError("--export requires a directory");
  }
  if (tokens.values.has("--todo") && !todoFile) {
    throw new UsageError("--todo requires a file path");
  }
  if ((exportDir || todoFile) && wait === false && operationId === "job.combine.start") {
    throw new UsageError("--export and --todo require waiting for the Plan to finish");
  }
  return {
    ...(exportDir ? { exportDir } : {}),
    ...(todoFile ? { todoFile } : {}),
  };
}

export function parseRunOutDir(tokens: CliFlagBag, isRunVerb: boolean): string | undefined {
  const dir = tokens.values.get("--out");
  if (dir === undefined) return undefined;
  if (!isRunVerb) {
    throw new UsageError(
      "--out is only valid on run verbs (test run, plan run, map flow run, run watch)",
    );
  }
  const trimmed = dir.trim();
  if (!trimmed) throw new UsageError("--out requires a directory");
  return trimmed;
}

export function assertNoOutDir(tokens: CliFlagBag): void {
  parseRunOutDir(tokens, false);
}

export function startedPlanBatchId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const campaign = "campaign" in response ? response.campaign : undefined;
  if (
    campaign &&
    typeof campaign === "object" &&
    "id" in campaign &&
    typeof campaign.id === "string"
  ) {
    return campaign.id;
  }
  const batch = "batch" in response ? response.batch : undefined;
  if (batch && typeof batch === "object" && "id" in batch && typeof batch.id === "string") {
    return batch.id;
  }
  return undefined;
}
