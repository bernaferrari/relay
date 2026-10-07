import {
  canonicalAppMapCombineCellValues,
  parseAppMapTestTupleIdentity,
  type JobSummary,
} from "@relay/protocol";
import { runTestSource } from "./run-test-source.js";

/** Existing live projection: selected row identities only, never runtime inputs. */
export function summarizeMatrixCase(data: unknown): JobSummary["matrixCase"] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const candidate = data as Record<string, unknown>;
  if (
    (candidate.kind !== "combine" && candidate.kind !== "combine-cell") ||
    typeof candidate.world !== "string" ||
    !candidate.values ||
    typeof candidate.values !== "object" ||
    Array.isArray(candidate.values)
  )
    return undefined;
  const values = canonicalAppMapCombineCellValues(
    Object.fromEntries(
      Object.entries(candidate.values).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  );
  const identity = parseAppMapTestTupleIdentity(candidate);
  return {
    kind: "combine",
    ...(identity ? identity : { values }),
    ...(typeof candidate.combineId === "string" && candidate.combineId.trim()
      ? { combineId: candidate.combineId.trim() }
      : {}),
    world: candidate.world,
    ...(typeof candidate.expectedScreenshots === "number" &&
    Number.isFinite(candidate.expectedScreenshots)
      ? { expectedScreenshots: candidate.expectedScreenshots }
      : {}),
  };
}

/** Persisted Plan association requires a complete, unambiguous frozen tuple.
 * A title, batch ID, or standalone Test identity cannot supply missing fields. */
export function runMatrixCase(run: {
  action?: unknown;
  artifacts?: unknown;
}): JobSummary["matrixCase"] {
  return runSummaryLineage(run).matrixCase;
}

/** Canonical authored ownership for list and detail; native execution remains
 * explicit in the immutable child intent. Historical mixed tuples are admitted
 * only when that intent's companion receipt proves the requested parent. */
export function runSummaryLineage(run: { action?: unknown; artifacts?: unknown }): {
  sourceTest?: { appMapId: string; testId: string };
  matrixCase?: JobSummary["matrixCase"];
} {
  const source = runTestSource(run);
  const result = source ? { sourceTest: source } : {};
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  const candidates = artifacts.filter(
    (item) => item && typeof item === "object" && item.kind === "frozen-inputs",
  );
  if (candidates.length !== 1) return result;
  const data: unknown = candidates[0].data;
  const identity = parseAppMapTestTupleIdentity(data);
  if (!identity || !data || typeof data !== "object") return result;
  const candidate = data as Record<string, unknown>;
  if (
    candidate.appMapId !== identity.appMapId ||
    candidate.testId !== identity.testId ||
    typeof candidate.combineId !== "string" ||
    !candidate.combineId.trim() ||
    candidate.combineId !== candidate.combineId.trim()
  )
    return result;
  const matrixCase = summarizeMatrixCase(candidate);
  if (!matrixCase) return result;
  const intents = artifacts.filter(
    (item) =>
      item && typeof item === "object" && item.kind === "app-map-combine-cell-execution-intent",
  );
  const companionDeclared = intents.some(
    (item) => record(item.data)?.nativeCompanion !== undefined,
  );
  if (companionDeclared) {
    if (intents.length !== 1 || !source) return result;
    const intent = record(intents[0].data);
    const companion = record(intent?.nativeCompanion);
    const requested = record(companion?.requestedFrom);
    const childSource = record(record(intent?.child)?.sourcePlan);
    if (
      !companion ||
      !requested ||
      (companion.platform !== "android" && companion.platform !== "ios") ||
      companion.appMapId !== source.appMapId ||
      companion.testId !== source.testId ||
      childSource?.appMapId !== source.appMapId ||
      childSource?.testId !== source.testId ||
      record(intent?.cell)?.testId !== identity.testId ||
      !exactId(requested.appMapId) ||
      !exactId(requested.testId) ||
      requested.testId !== identity.testId ||
      (identity.appMapId !== source.appMapId && identity.appMapId !== requested.appMapId)
    )
      return result;
    const authored = { appMapId: requested.appMapId, testId: requested.testId };
    return { sourceTest: authored, matrixCase: { ...matrixCase, ...authored } };
  }
  if (source && (source.appMapId !== identity.appMapId || source.testId !== identity.testId))
    return result;
  return { ...result, matrixCase };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim();
}
