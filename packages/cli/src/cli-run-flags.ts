import { capturePolicyForLens, isCombineLensInput } from "@relay/protocol";
import { UsageError } from "./errors.js";
import { parseInFlags } from "./outcome-command.js";

export type CliFlagBag = {
  values: Map<string, string>;
  switches: Set<string>;
};

const BUDGET_PATTERN = /^(\d+)(ms|s|m|h)$/u;

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
    throw new UsageError("--lens is only valid on test run or combine run");
  }
  if (usesWorlds && operationId !== "app-map.test.run") {
    throw new UsageError("--in is only valid on test run");
  }
  if (cell && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--cell is only valid on test run or combine run");
  }
  if (all && operationId !== "app-map.test.run" && operationId !== "job.combine.start") {
    throw new UsageError("--all is only valid on test run or combine run");
  }
  if (operationId === "app-map.test.run" && !hasIn) {
    if (lens) throw new UsageError("--lens requires --in variableId=value[,value]");
    if (cell) throw new UsageError("--cell requires --in variableId=value[,value]");
    if (all) throw new UsageError("--all requires --in variableId=value[,value]");
  }
  if (!usesWorlds && !lens && !cell && !all) return input;
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
  return next;
}

export function assertPlanCliFlags(operationId: string, tokens: CliFlagBag): void {
  if (tokens.values.has("--budget") && operationId !== "job.combine.start") {
    throw new UsageError("--budget is only valid on plan run or combine run");
  }
  if (
    tokens.switches.has("--findings") &&
    operationId !== "job.combine.start" &&
    operationId !== "job.combine.analysis"
  ) {
    throw new UsageError("--findings is only valid on plan run, combine run, or plan findings");
  }
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
