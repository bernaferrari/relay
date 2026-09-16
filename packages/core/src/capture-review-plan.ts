import type { ActorKind } from "@relay/protocol";
import {
  filterPlanCaptureReviewQueue,
  parsePlanCaptureReviewFilter,
  planCaptureReviewItemMatchesFilter,
  selectedPlanCaptureReviewItems,
  resolvePlanCaptureReviewQueue,
  type CaptureReviewAction,
  type CaptureReviewDecision,
  type PlanCaptureReviewFilter,
  type PlanCaptureReviewQueue,
  type PlanCaptureReviewSelection,
} from "@relay/protocol";
import {
  applyCaptureReviewDecision,
  assertHumanCaptureReviewActor,
  CaptureReviewError,
} from "./capture-review.js";
import { listCombineCampaignIds } from "./combine-campaign.js";
import { executionIntentPlannedSlots } from "./run-test-step-evidence.js";
import {
  listPersistedRuns,
  persistPersistedRun,
  persistedRunBelongsToStore,
  readCompletedPersistedRun,
  withRunWriteLock,
  type PersistedRun,
} from "./runs.js";

export type PlanCaptureReviewApplyResult = {
  queue: PlanCaptureReviewQueue;
  results: PlanCaptureReviewItemResult[];
};

export type PlanCaptureReviewItemResult = {
  runId: string;
  captureId: string;
  status: "applied" | "missing" | "not-found" | "conflict" | "actor-required";
  error?: string;
};

type PlanCaptureReviewRun = Pick<
  PersistedRun,
  "id" | "artifacts" | "captureReviews" | "outcome" | "status"
> & {
  recipeSnapshot?: {
    steps?: readonly unknown[];
    recipes?: Record<string, { steps?: readonly unknown[] }>;
  };
  recipeGraph?: Record<string, { steps?: readonly unknown[] }>;
  serial?: string;
  deviceName?: string;
  executionTarget?: PersistedRun["executionTarget"];
  resolvedInputs?: Record<string, string>;
};

function plannedSlotsForRun(run: PlanCaptureReviewRun) {
  return executionIntentPlannedSlots(run.artifacts ?? []);
}

/** Exact id, else the unique prefix among known Plan campaigns. Never a later arrival. */
export function resolveUniquePlanBatchId(
  requested: string,
  knownBatchIds: readonly string[],
): string {
  const needle = requested.trim();
  if (!needle) return requested;
  if (knownBatchIds.includes(needle)) return needle;
  const matches = [...new Set(knownBatchIds.filter((id) => id.startsWith(needle)))];
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_UNAVAILABLE",
      "Several Plans match that batch prefix",
      "Pass the full Plan campaign id.",
    );
  }
  return needle;
}

async function knownPlanBatchIds(projectId = "default"): Promise<string[]> {
  const ids = new Set<string>(await listCombineCampaignIds(projectId));
  for (const run of await listPersistedRuns(1_000)) {
    if (run.batchId) ids.add(run.batchId);
  }
  return [...ids];
}

export async function resolvePersistedPlanBatchId(
  batchId: string,
  projectId = "default",
): Promise<string> {
  return resolveUniquePlanBatchId(batchId, await knownPlanBatchIds(projectId));
}

function runIsBlocked(run: PlanCaptureReviewRun): boolean {
  return (
    run.outcome === "harness-failure" || run.status === "blocked" || run.status === "cancelled"
  );
}

function deviceForRun(run: PlanCaptureReviewRun): string | undefined {
  const serial = run.serial?.trim();
  if (serial) return serial;
  const name = run.deviceName?.trim();
  if (name) return name;
  const targetId = run.executionTarget?.targetId?.trim();
  return targetId || undefined;
}

export function captureReviewQueueForPlan(
  runs: readonly PlanCaptureReviewRun[],
): PlanCaptureReviewQueue {
  return resolvePlanCaptureReviewQueue(
    runs.map((run) => ({
      runId: run.id,
      artifacts: run.artifacts,
      decisions: run.captureReviews,
      recipeSteps: run.recipeSnapshot?.steps,
      recipes: run.recipeGraph ?? run.recipeSnapshot?.recipes,
      plannedSlots: plannedSlotsForRun(run),
      ...(runIsBlocked(run) ? { blocked: true } : {}),
      ...(deviceForRun(run) ? { device: deviceForRun(run)! } : {}),
    })),
  );
}

export function applyPlanCaptureReviewDecisions(
  runs: readonly PlanCaptureReviewRun[],
  input: {
    items: readonly PlanCaptureReviewSelection[];
    action: CaptureReviewAction;
    actor: { id: string; kind: ActorKind };
    filter?: PlanCaptureReviewFilter;
  },
): PlanCaptureReviewApplyResult & {
  runs: Array<{ runId: string; captureReviews: CaptureReviewDecision[] }>;
} {
  assertHumanCaptureReviewActor(
    input.actor,
    "A human must decide these screenshots",
    "Open the Plan captures panel and ask a person to mark Looks correct, Report issue, or Need more evidence.",
  );
  const queue = captureReviewQueueForPlan(runs);
  const filter = parsePlanCaptureReviewFilter(input.filter ?? {});
  const selected = selectedPlanCaptureReviewItems(queue, input.items, filter);
  const selectedKeys = new Set(selected.map((item) => `${item.runId}::${item.captureId}`));
  const reviewsByRun = new Map<string, CaptureReviewDecision[]>(
    runs.map((run) => [run.id, [...(run.captureReviews ?? [])]]),
  );
  const results: PlanCaptureReviewItemResult[] = [];
  for (const selection of input.items) {
    const key = `${selection.runId}::${selection.captureId}`;
    const item = queue.items.find(
      (candidate) =>
        candidate.runId === selection.runId && candidate.captureId === selection.captureId,
    );
    if (!item) {
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: "not-found",
        error: "That screenshot is not in this Plan's review queue",
      });
      continue;
    }
    if (filter && !planCaptureReviewItemMatchesFilter(item, filter)) {
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: "not-found",
        error: "That screenshot is hidden by the current review filter",
      });
      continue;
    }
    if (item.status === "missing" || !selectedKeys.has(key)) {
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: item.status === "missing" ? "missing" : "conflict",
        error:
          item.status === "missing"
            ? "A missing screenshot cannot be marked Looks correct"
            : "This decision does not match the image currently on screen",
      });
      continue;
    }
    const run = runs.find((candidate) => candidate.id === selection.runId);
    if (!run) {
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: "not-found",
        error: "That Run is not in this Plan",
      });
      continue;
    }
    try {
      const applied = applyCaptureReviewDecision(
        { ...run, captureReviews: reviewsByRun.get(run.id) },
        {
          captureId: item.captureId,
          action: selection.action ?? input.action,
          actor: input.actor,
          ...(selection.imageSha256 ? { imageSha256: selection.imageSha256 } : {}),
        },
      );
      reviewsByRun.set(run.id, applied.captureReviews);
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: "applied",
      });
    } catch (error) {
      const code = error instanceof CaptureReviewError ? error.code : undefined;
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status:
          code === "CAPTURE_REVIEW_MISSING"
            ? "missing"
            : code === "CAPTURE_REVIEW_CONFLICT"
              ? "conflict"
              : code === "CAPTURE_REVIEW_ACTOR_REQUIRED"
                ? "actor-required"
                : "not-found",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const nextRuns = runs.map((run) => ({
    ...run,
    captureReviews: reviewsByRun.get(run.id) ?? run.captureReviews,
  }));
  return {
    queue: captureReviewQueueForPlan(nextRuns),
    results,
    runs: [...reviewsByRun.entries()].map(([runId, captureReviews]) => ({
      runId,
      captureReviews,
    })),
  };
}

export async function reviewPersistedPlanCaptures(
  root: string,
  batchId: string,
  input: {
    items: readonly PlanCaptureReviewSelection[];
    action: CaptureReviewAction;
    actor: { id: string; kind: ActorKind };
    filter?: PlanCaptureReviewFilter;
  },
): Promise<PlanCaptureReviewApplyResult> {
  const resolved = await resolvePersistedPlanBatchId(batchId);
  const loaded = await listPersistedRuns(1_000, undefined, resolved);
  const applied = applyPlanCaptureReviewDecisions(loaded, input);
  const appliedIds = new Set(
    applied.results.filter((result) => result.status === "applied").map((result) => result.runId),
  );
  for (const next of applied.runs) {
    if (!appliedIds.has(next.runId)) continue;
    const run = loaded.find((candidate) => candidate.id === next.runId);
    if (!run) continue;
    await withRunWriteLock(run.dir, async () => {
      const latest = (await readCompletedPersistedRun(run.dir)) ?? run;
      latest.dir = run.dir;
      if (!persistedRunBelongsToStore(root, latest.dir)) {
        throw new CaptureReviewError(
          "CAPTURE_REVIEW_UNAVAILABLE",
          "This run is outside the configured Relay run store",
          "Re-open the Plan from the current project before reviewing screenshots.",
        );
      }
      const persisted: PersistedRun = structuredClone(latest);
      persisted.captureReviews = next.captureReviews;
      await persistPersistedRun(root, latest, persisted, "capture-review");
    });
  }
  const refreshed = await listPersistedRuns(1_000, undefined, resolved);
  return {
    queue: captureReviewQueueForPlan(refreshed.length ? refreshed : loaded),
    results: applied.results,
  };
}

export async function captureReviewQueueForPersistedPlan(
  batchId: string,
  filter?: PlanCaptureReviewFilter,
): Promise<PlanCaptureReviewQueue> {
  const resolved = await resolvePersistedPlanBatchId(batchId);
  const queue = await listPersistedRuns(1_000, undefined, resolved).then(captureReviewQueueForPlan);
  return filterPlanCaptureReviewQueue(queue, filter);
}
