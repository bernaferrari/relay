import { createHash } from "node:crypto";
import type { StepTarget } from "@relay/protocol";
import { preflightSemanticActivation } from "./device-target-resolution.js";
import type { SnapshotNode } from "./device.js";
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
  /** Re-evaluates the frozen compiled semantic selector against the stored
   * failure tree with the current pure matcher. It is intentionally selector
   * evidence only: a resolved target can never upgrade an unproved product
   * transition to a pass. */
  currentMatcher?: OfflineReplayCurrentMatcher;
  evidence: string[];
};

export type OfflineReplayCurrentMatcherSelector = {
  recipeId: string;
  recipeStepId?: string;
  stepKind: "tap" | "reveal" | "expect" | "wait-for";
  target: Pick<StepTarget, "identifier" | "ref" | "label" | "role" | "text" | "relation"> & {
    hasPointFallback?: boolean;
  };
  status: "resolved" | "blocked" | "unavailable";
  method?: "identifier" | "label" | "text" | "relation" | "point";
  detail?: string;
};

export type OfflineReplayCurrentMatcher = {
  status: "resolved" | "blocked" | "unavailable";
  /** `changed` means current pure matching disagrees with the recorded
   * selector result. It proposes review, never a silent map rewrite. */
  comparison: "matches-recorded" | "changed" | "not-recorded" | "not-comparable";
  inputDigest: string;
  evidence: string[];
  selectors: OfflineReplayCurrentMatcherSelector[];
};

export type OfflineReplayRepairProposal = {
  id: string;
  checkId?: string;
  kind: "review-current-matcher" | "replay-root-check" | "recapture-frozen-plan";
  reason: string;
  mutation: "none";
  requiresReview: true;
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
  /** Read-only next actions derived from the replay. Applying a test/map
   * repair still requires an explicit reviewed proposal elsewhere. */
  repairProposals: OfflineReplayRepairProposal[];
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
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function artifactPointer(run: PersistedRun, index: number): string {
  return `run:${run.id}#artifact:${index}`;
}

function frozenPlan(run: PersistedRun): { artifact?: RunArtifact; index?: number; data: unknown } {
  const index = run.artifacts.findIndex(
    (artifact) => artifact.kind === "app-map-test-plan" || artifact.kind === "app-map-flow-plan",
  );
  if (index >= 0)
    return { artifact: run.artifacts[index], index, data: run.artifacts[index]!.data };
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
      const failed =
        attempt.kind === "target-resolution-attempt" || attemptData.status === "failed";
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

function snapshotNodes(value: unknown): SnapshotNode[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  return value.every((node) => record(node)) ? (value as SnapshotNode[]) : undefined;
}

function targetSummary(target: StepTarget): OfflineReplayCurrentMatcherSelector["target"] {
  return {
    ...(target.identifier ? { identifier: target.identifier } : {}),
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.role ? { role: target.role } : {}),
    ...(target.text ? { text: target.text } : {}),
    ...(target.relation ? { relation: structuredClone(target.relation) } : {}),
    ...(target.point ? { hasPointFallback: true } : {}),
  };
}

type FrozenSelector = {
  recipeId: string;
  recipeStepId?: string;
  stepKind: OfflineReplayCurrentMatcherSelector["stepKind"];
  target: StepTarget;
};

function recipeSteps(value: unknown): unknown[] {
  const recipe = record(value);
  return Array.isArray(recipe?.steps) ? recipe.steps : [];
}

/** Locate exactly the compiled recipe called by a frozen campaign check. This
 * intentionally consumes only the persisted plan artifact; it never reads a
 * newer App Map or assumes an unrecorded route. */
function selectorsForFrozenCheck(planData: unknown, checkId: string): FrozenSelector[] {
  const plan = record(planData);
  const recipes = record(plan?.recipes);
  if (!recipes) return [];
  const roots = Object.entries(recipes)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([, recipe]) =>
      recipeSteps(recipe).flatMap((rawStep) => {
        const step = record(rawStep);
        const check = record(step?.check);
        const recipeId = text(step?.recipeId);
        return step?.kind === "module" && text(check?.id) === checkId && recipeId ? [recipeId] : [];
      }),
    );
  const selectors: FrozenSelector[] = [];
  const visited = new Set<string>();
  const visit = (recipeId: string): void => {
    if (visited.has(recipeId)) return;
    visited.add(recipeId);
    const recipe = recipes[recipeId];
    for (const rawStep of recipeSteps(recipe)) {
      const step = record(rawStep);
      if (!step) continue;
      const kind = step?.kind;
      if (
        (kind === "tap" || kind === "reveal" || kind === "expect" || kind === "wait-for") &&
        record(step.target)
      ) {
        selectors.push({
          recipeId,
          ...(text(step.id) ? { recipeStepId: text(step.id) } : {}),
          stepKind: kind,
          target: step.target as StepTarget,
        });
        continue;
      }
      if (kind === "module") {
        const nested = text(step.recipeId);
        if (nested) visit(nested);
      }
    }
  };
  for (const root of [...new Set(roots)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    visit(root);
  }
  return selectors;
}

function hasSemanticTarget(target: StepTarget): boolean {
  return Boolean(target.identifier || target.label || target.text || target.relation);
}

function currentMatcher(
  run: PersistedRun,
  planData: unknown,
  checkId: string,
  recordedAttempts: OfflineReplaySelectorAttempt[],
): OfflineReplayCurrentMatcher | undefined {
  const selectors = selectorsForFrozenCheck(planData, checkId);
  const snapshots = run.artifacts.flatMap((artifact, index) => {
    if (artifact.kind !== "campaign-check-evidence") return [];
    const data = record(artifact.data);
    const nodes = text(data?.checkId) === checkId ? snapshotNodes(data?.nodes) : undefined;
    return nodes
      ? [
          {
            nodes,
            artifact: artifactPointer(run, index),
            capturedAt: artifact.capturedAt,
          },
        ]
      : [];
  });
  if (!selectors.length && !snapshots.length) return undefined;
  const evidence = snapshots.map((snapshot) => snapshot.artifact);
  const matcherSelectors: OfflineReplayCurrentMatcherSelector[] = selectors.map((selector) => {
    if (!hasSemanticTarget(selector.target)) {
      return {
        recipeId: selector.recipeId,
        ...(selector.recipeStepId ? { recipeStepId: selector.recipeStepId } : {}),
        stepKind: selector.stepKind,
        target: targetSummary(selector.target),
        status: "unavailable",
        detail: "The frozen step has no semantic selector that the current matcher can replay.",
      };
    }
    if (!snapshots.length) {
      return {
        recipeId: selector.recipeId,
        ...(selector.recipeStepId ? { recipeStepId: selector.recipeStepId } : {}),
        stepKind: selector.stepKind,
        target: targetSummary(selector.target),
        status: "unavailable",
        detail:
          "The persisted failure package has no raw accessibility tree for current-matcher replay.",
      };
    }
    const outcomes = snapshots.map((snapshot) =>
      preflightSemanticActivation([...snapshot.nodes], selector.target),
    );
    const resolved = outcomes.find(
      (outcome): outcome is Extract<typeof outcome, { status: "proven" }> =>
        outcome.status === "proven",
    );
    if (resolved) {
      return {
        recipeId: selector.recipeId,
        ...(selector.recipeStepId ? { recipeStepId: selector.recipeStepId } : {}),
        stepKind: selector.stepKind,
        target: targetSummary(selector.target),
        status: "resolved",
        method: resolved.resolution.method,
      };
    }
    const blocked = outcomes.find(
      (outcome): outcome is Extract<typeof outcome, { status: "blocked" }> =>
        outcome.status === "blocked",
    );
    return {
      recipeId: selector.recipeId,
      ...(selector.recipeStepId ? { recipeStepId: selector.recipeStepId } : {}),
      stepKind: selector.stepKind,
      target: targetSummary(selector.target),
      status: "blocked",
      ...(blocked?.detail ? { detail: blocked.detail } : {}),
    };
  });
  const status: OfflineReplayCurrentMatcher["status"] =
    matcherSelectors.length === 0 ||
    matcherSelectors.some((selector) => selector.status === "unavailable")
      ? "unavailable"
      : matcherSelectors.every((selector) => selector.status === "resolved")
        ? "resolved"
        : "blocked";
  const recordedStatus = recordedAttempts.length
    ? recordedAttempts.some((attempt) => attempt.status === "resolved")
      ? "resolved"
      : "blocked"
    : undefined;
  const comparison: OfflineReplayCurrentMatcher["comparison"] = !recordedStatus
    ? "not-recorded"
    : status === "unavailable"
      ? "not-comparable"
      : status === recordedStatus
        ? "matches-recorded"
        : "changed";
  return {
    status,
    comparison,
    inputDigest: digest({
      checkId,
      selectors: matcherSelectors.map(({ recipeId, recipeStepId, stepKind, target }) => ({
        recipeId,
        recipeStepId,
        stepKind,
        target,
      })),
      snapshots: snapshots.map(({ nodes, artifact, capturedAt }) => ({
        artifact,
        capturedAt,
        nodes,
      })),
    }),
    evidence,
    selectors: matcherSelectors,
  };
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
    const matcher = currentMatcher(run, plan.data, id, attempts.attempts);
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
        kind: actionNoOp
          ? "action-no-op"
          : resolvedSelector
            ? "transition-unproved"
            : "recorded-failure",
        ...(text(data.error) ? { error: text(data.error) } : {}),
        evidence,
      };
    } else if (warmSourceScreenId && warmSourceScreenId !== lastProvenScreenId) {
      replayStatus = "invalid-cascade";
      reason = `Required origin ${warmSourceScreenId} was never proved; the last proven screen remained ${lastProvenScreenId ?? "unknown"}.`;
    } else {
      replayStatus = "independent-failure";
      reason =
        "The required origin was independently proved, so this failure is not caused by the earlier root.";
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
      ...(matcher ? { currentMatcher: matcher } : {}),
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
  const repairProposals: OfflineReplayRepairProposal[] = [];
  if (firstRoot) {
    repairProposals.push({
      id: `offline:${run.id}:${firstRoot.checkId}:replay-root-check`,
      checkId: firstRoot.checkId,
      kind: "replay-root-check",
      reason: `Review ${firstRoot.title}'s frozen evidence and repair proposal before replaying only this causal root.`,
      mutation: "none",
      requiresReview: true,
      evidence: firstRoot.evidence,
    });
  }
  for (const check of checks) {
    if (check.currentMatcher?.comparison !== "changed") continue;
    repairProposals.push({
      id: `offline:${run.id}:${check.id}:review-current-matcher`,
      checkId: check.id,
      kind: "review-current-matcher",
      reason:
        "The current pure matcher disagrees with the recorded selector result. Review the frozen target and evidence before proposing any map or test repair.",
      mutation: "none",
      requiresReview: true,
      evidence: check.currentMatcher.evidence,
    });
  }
  if (!plan.artifact && !run.recipeSnapshot) {
    repairProposals.push({
      id: `offline:${run.id}:recapture-frozen-plan`,
      kind: "recapture-frozen-plan",
      reason:
        "The persisted run has no frozen plan; preserve one before relying on offline simulation.",
      mutation: "none",
      requiresReview: true,
      evidence: [],
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
    repairProposals,
    blockers,
  };
}
