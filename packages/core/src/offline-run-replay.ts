import { createHash } from "node:crypto";
import type { PersistedRun, RunArtifact } from "./runs.js";

type UnknownRecord = Record<string, unknown>;

export type OfflineReplayCursor = {
  status: "proven" | "unknown";
  screenId?: string;
  reason?: string;
  source?: string;
  artifact: string;
  capturedAt: number;
};

export type OfflineReplaySelectorAttempt = {
  status: "resolved" | "failed";
  strategy?: string;
  target?: UnknownRecord;
  error?: string;
  artifact: string;
  capturedAt: number;
};

export type OfflineReplayCheck = {
  id: string;
  title: string;
  recordedStatus: "passed" | "failed" | "blocked";
  replayStatus: "proved" | "root-failure" | "invalid-cascade" | "independent-failure";
  warmSourceScreenId?: string;
  lastProvenScreenId?: string;
  expectedDestinationScreenId?: string;
  error?: string;
  reason: string;
  selectorAttempts: OfflineReplaySelectorAttempt[];
  evidence: string[];
};

export type OfflineRunReplayReport = {
  schemaVersion: 1;
  mode: "offline-evidence-replay";
  runId: string;
  sourceRunStatus: string;
  planDigest: string;
  appMapId?: string;
  appMapRevision?: number;
  testId?: string;
  summary: {
    checks: number;
    proved: number;
    rootFailures: number;
    invalidCascades: number;
    independentFailures: number;
  };
  firstRootFailure?: {
    checkId: string;
    title: string;
    kind: "action-no-op" | "transition-unproved" | "recorded-failure";
    error?: string;
    evidence: string[];
  };
  cursorTimeline: OfflineReplayCursor[];
  checks: OfflineReplayCheck[];
  blockers: Array<{
    kind: "root-failure" | "unproven-origin" | "missing-frozen-plan";
    checkIds: string[];
    message: string;
  }>;
};

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  const candidate = record(value);
  if (!candidate) return value;
  return Object.fromEntries(
    Object.keys(candidate)
      .sort()
      .map((key) => [key, stableValue(candidate[key])]),
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function artifactPointer(run: PersistedRun, index: number): string {
  return `run:${run.id}#artifact:${index}`;
}

function frozenPlan(run: PersistedRun): { artifact?: RunArtifact; index?: number; data: unknown } {
  const index = run.artifacts.findIndex(
    (artifact) => artifact.kind === "app-map-test-plan" || artifact.kind === "app-map-flow-plan",
  );
  if (index >= 0) return { artifact: run.artifacts[index], index, data: run.artifacts[index]!.data };
  return { data: run.recipeSnapshot ?? null };
}

function cursorFromArtifact(
  run: PersistedRun,
  artifact: RunArtifact,
  index: number,
): OfflineReplayCursor | undefined {
  if (artifact.kind !== "navigation-proof-cursor") return undefined;
  const data = record(artifact.data);
  if (!data || (data.status !== "proven" && data.status !== "unknown")) return undefined;
  const previous = record(data.previous);
  return {
    status: data.status,
    ...(text(data.screenId) || text(previous?.screenId)
      ? { screenId: text(data.screenId) ?? text(previous?.screenId) }
      : {}),
    ...(text(data.reason) ? { reason: text(data.reason) } : {}),
    ...(text(data.source) ? { source: text(data.source) } : {}),
    artifact: artifactPointer(run, index),
    capturedAt: artifact.capturedAt,
  };
}

function selectorAttempts(
  run: PersistedRun,
  checkId: string,
): { attempts: OfflineReplaySelectorAttempt[]; evidence: string[] } {
  const attempts: OfflineReplaySelectorAttempt[] = [];
  const evidence: string[] = [];
  run.artifacts.forEach((artifact, artifactIndex) => {
    if (artifact.kind !== "campaign-check-evidence") return;
    const data = record(artifact.data);
    if (text(data?.checkId) !== checkId) return;
    const pointer = artifactPointer(run, artifactIndex);
    evidence.push(pointer);
    const rawAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
    for (const raw of rawAttempts) {
      const attempt = record(raw);
      const attemptData = record(attempt?.data);
      if (!attempt || !attemptData) continue;
      const failed = attempt.kind === "target-resolution-attempt" || attemptData.status === "failed";
      attempts.push({
        status: failed ? "failed" : "resolved",
        ...(text(attemptData.strategy) || text(attemptData.method)
          ? { strategy: text(attemptData.strategy) ?? text(attemptData.method) }
          : {}),
        ...(record(attemptData.target) ? { target: record(attemptData.target) } : {}),
        ...(text(attemptData.error) ? { error: text(attemptData.error) } : {}),
        artifact: pointer,
        capturedAt: artifact.capturedAt,
      });
    }
  });
  return { attempts, evidence };
}

function transitionDestination(data: UnknownRecord): string | undefined {
  const dependencies = Array.isArray(data.transitionDependencies)
    ? data.transitionDependencies
    : [];
  const last = record(dependencies.at(-1));
  return text(record(last?.destination)?.screenId);
}

/**
 * Re-evaluate a durable run using only its frozen plan and captured artifacts.
 * This projection is deliberately pure: it never reads the current App Map,
 * opens a target, mutates a baseline, or writes a repair.
 */
export function replayPersistedRunOffline(run: PersistedRun): OfflineRunReplayReport {
  const plan = frozenPlan(run);
  const planData = record(plan.data);
  const cursorTimeline = run.artifacts.flatMap((artifact, index) => {
    const cursor = cursorFromArtifact(run, artifact, index);
    return cursor ? [cursor] : [];
  });
  const verifiedByCheck = new Set(
    run.artifacts.flatMap((artifact) => {
      if (artifact.kind !== "campaign-transition-proof") return [];
      const data = record(artifact.data);
      return data?.status === "verified" && text(data.checkId) ? [text(data.checkId)!] : [];
    }),
  );

  let lastProvenScreenId: string | undefined;
  let firstRoot: OfflineRunReplayReport["firstRootFailure"];
  const checks: OfflineReplayCheck[] = [];

  run.artifacts.forEach((artifact, artifactIndex) => {
    if (artifact.kind === "navigation-proof-cursor") {
      const cursor = cursorFromArtifact(run, artifact, artifactIndex);
      if (cursor?.status === "proven" && cursor.screenId) lastProvenScreenId = cursor.screenId;
      return;
    }
    if (artifact.kind !== "campaign-check-result") return;
    const data = record(artifact.data);
    const id = text(data?.id);
    const title = text(data?.title);
    const status = data?.status;
    if (
      !data ||
      !id ||
      !title ||
      (status !== "passed" && status !== "failed" && status !== "blocked")
    )
      return;

    const warmSourceScreenId = text(data.warmSourceScreenId);
    const expectedDestinationScreenId = transitionDestination(data);
    const attempts = selectorAttempts(run, id);
    const resultPointer = artifactPointer(run, artifactIndex);
    const evidence = [...attempts.evidence, resultPointer];
    let replayStatus: OfflineReplayCheck["replayStatus"];
    let reason: string;

    if (status === "passed") {
      replayStatus = "proved";
      reason = verifiedByCheck.has(id)
        ? "Recorded success is backed by a verified transition proof."
        : "Recorded check passed; no contradictory offline evidence was captured.";
    } else if (!firstRoot) {
      replayStatus = "root-failure";
      const resolvedSelector = attempts.attempts.some((attempt) => attempt.status === "resolved");
      const actionNoOp =
        resolvedSelector &&
        Boolean(warmSourceScreenId) &&
        warmSourceScreenId === lastProvenScreenId &&
        !verifiedByCheck.has(id);
      reason = actionNoOp
        ? "The selector resolved on the proven origin, but no destination transition was proved; the action was a no-op."
        : "This is the first recorded failure while its origin was still independently provable.";
      firstRoot = {
        checkId: id,
        title,
        kind: actionNoOp ? "action-no-op" : resolvedSelector ? "transition-unproved" : "recorded-failure",
        ...(text(data.error) ? { error: text(data.error) } : {}),
        evidence,
      };
    } else if (warmSourceScreenId && warmSourceScreenId !== lastProvenScreenId) {
      replayStatus = "invalid-cascade";
      reason = `Required origin ${warmSourceScreenId} was never proved; the last proven screen remained ${lastProvenScreenId ?? "unknown"}.`;
    } else {
      replayStatus = "independent-failure";
      reason = "The required origin was independently proved, so this failure is not caused by the earlier root.";
    }

    checks.push({
      id,
      title,
      recordedStatus: status,
      replayStatus,
      ...(warmSourceScreenId ? { warmSourceScreenId } : {}),
      ...(lastProvenScreenId ? { lastProvenScreenId } : {}),
      ...(expectedDestinationScreenId ? { expectedDestinationScreenId } : {}),
      ...(text(data.error) ? { error: text(data.error) } : {}),
      reason,
      selectorAttempts: attempts.attempts,
      evidence,
    });
  });

  const invalidCascades = checks.filter((check) => check.replayStatus === "invalid-cascade");
  const blockers: OfflineRunReplayReport["blockers"] = [];
  if (firstRoot) {
    blockers.push({
      kind: "root-failure",
      checkIds: [firstRoot.checkId],
      message: `${firstRoot.title} is the first causal failure; repair and replay it before trusting descendants.`,
    });
  }
  if (invalidCascades.length) {
    blockers.push({
      kind: "unproven-origin",
      checkIds: invalidCascades.map((check) => check.id),
      message: `${invalidCascades.length} later checks are invalid evidence because their warm origins were never proved.`,
    });
  }
  if (!plan.artifact && !run.recipeSnapshot) {
    blockers.push({
      kind: "missing-frozen-plan",
      checkIds: [],
      message: "The run has no frozen App Map plan or recipe snapshot to simulate.",
    });
  }

  return {
    schemaVersion: 1,
    mode: "offline-evidence-replay",
    runId: run.id,
    sourceRunStatus: run.status,
    planDigest: digest(plan.data),
    ...(text(planData?.appMapId) ? { appMapId: text(planData?.appMapId) } : {}),
    ...(typeof planData?.appMapRevision === "number"
      ? { appMapRevision: planData.appMapRevision }
      : {}),
    ...(text(record(planData?.test)?.id) ? { testId: text(record(planData?.test)?.id) } : {}),
    summary: {
      checks: checks.length,
      proved: checks.filter((check) => check.replayStatus === "proved").length,
      rootFailures: checks.filter((check) => check.replayStatus === "root-failure").length,
      invalidCascades: invalidCascades.length,
      independentFailures: checks.filter((check) => check.replayStatus === "independent-failure")
        .length,
    },
    ...(firstRoot ? { firstRootFailure: firstRoot } : {}),
    cursorTimeline,
    checks,
    blockers,
  };
}
