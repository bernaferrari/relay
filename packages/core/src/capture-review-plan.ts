import type { ActorKind, CombineCampaign } from "@relay/protocol";
import {
  filterPlanCaptureReviewQueue,
  parsePlanCaptureReviewFilter,
  planCaptureReviewItemMatchesFilter,
  selectedPlanCaptureReviewItems,
  resolvePlanCaptureReviewQueue,
  summarizePlanCaptureReview,
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
import { listCombineCampaignIds, readCombineCampaign } from "./combine-campaign.js";
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
  for (const run of await listPersistedRuns(Number.MAX_SAFE_INTEGER)) {
    if ((run.projectId ?? "default") !== projectId) continue;
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

/** New campaigns retain every frozen obligation; retries overlay their current Run only. */
export function captureReviewQueueForCampaign(
  campaign: CombineCampaign | null,
  runs: readonly PlanCaptureReviewRun[],
): PlanCaptureReviewQueue {
  if (!campaign || campaign.cases.some((item) => item.plannedCaptures === undefined))
    return captureReviewQueueForPlan(runs);
  const byId = new Map(runs.map((run) => [run.id, run]));
  const scope = campaign.execution?.selectedExecutionCaseIds ?? campaign.execution?.selectedCellIds;
  const selected = scope ? new Set(scope) : undefined;
  const cases = campaign.cases.filter(
    (item) =>
      !selected ||
      selected.has(
        campaign.execution?.selectedExecutionCaseIds
          ? (item.executionCaseId ?? item.cellId)
          : item.cellId,
      ),
  );
  const inputs = cases.map((item) => {
    const run = byId.get(item.runId ?? item.jobId ?? "");
    return {
      executionCaseId: `${campaign.id}:${item.executionCaseId ?? item.cellId}`,
      ...(run ? { runId: run.id, artifacts: run.artifacts, decisions: run.captureReviews } : {}),
      plannedSlots: item.plannedCaptures,
      blocked: run ? runIsBlocked(run) : ["blocked", "cancelled", "failed"].includes(item.status),
      device: run ? deviceForRun(run) : item.target?.targetId,
    };
  });
  const expected = resolvePlanCaptureReviewQueue(
    inputs.map(({ artifacts: _artifacts, decisions: _decisions, ...input }) => input),
  );
  const keys = new Set(expected.items.map((item) => `${item.executionCaseId}::${item.slotId}`));
  const items = resolvePlanCaptureReviewQueue(inputs).items.filter((item) =>
    keys.has(`${item.executionCaseId}::${item.slotId}`),
  );
  return { items, summary: summarizePlanCaptureReview(items) };
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
    if (item.blocked || item.status === "missing" || !selectedKeys.has(key)) {
      const blocked = Boolean(item.blocked);
      const missing = item.status === "missing";
      results.push({
        runId: selection.runId,
        captureId: selection.captureId,
        status: blocked || missing ? "missing" : "conflict",
        error: blocked
          ? "A blocked screenshot cannot be marked Looks correct"
          : missing
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
          ...(selection.note ? { note: selection.note } : {}),
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
  projectId = "default",
): Promise<PlanCaptureReviewApplyResult> {
  assertHumanCaptureReviewActor(
    input.actor,
    "A human must decide these screenshots",
    "Open the Plan captures panel and ask a person to mark Looks correct, Report issue, or Need more evidence.",
  );
  const resolved = await resolvePersistedPlanBatchId(batchId, projectId);
  const loaded = (await listPersistedRuns(Number.MAX_SAFE_INTEGER, undefined, resolved)).filter(
    (run) => (run.projectId ?? "default") === projectId,
  );
  const results: Array<PlanCaptureReviewItemResult | undefined> = Array.from({
    length: input.items.length,
  });
  const campaign = await readCombineCampaign(projectId, resolved);
  const visible = filterPlanCaptureReviewQueue(
    captureReviewQueueForCampaign(campaign, loaded),
    input.filter,
  );
  const visibleKeys = new Set(visible.items.map((item) => `${item.runId}::${item.captureId}`));
  const indexesByRun = new Map<string, number[]>();
  for (const [index, selection] of input.items.entries()) {
    if (!visibleKeys.has(`${selection.runId}::${selection.captureId}`)) {
      results[index] = {
        runId: selection.runId,
        captureId: selection.captureId,
        status: "not-found",
        error: "This screenshot is no longer in the Plan's current review queue.",
      };
      continue;
    }
    const indexes = indexesByRun.get(selection.runId) ?? [];
    indexes.push(index);
    indexesByRun.set(selection.runId, indexes);
  }
  for (const [runId, indexes] of indexesByRun) {
    const run = loaded.find((candidate) => candidate.id === runId);
    if (!run) {
      for (const index of indexes) {
        const selection = input.items[index]!;
        results[index] = {
          runId: selection.runId,
          captureId: selection.captureId,
          status: "not-found",
          error: "That screenshot is not in this Plan's review queue",
        };
      }
      continue;
    }
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
      const applied = applyPlanCaptureReviewDecisions([latest], {
        items: indexes.map((index) => input.items[index]!),
        action: input.action,
        actor: input.actor,
        ...(input.filter ? { filter: input.filter } : {}),
      });
      for (const [offset, result] of applied.results.entries()) {
        results[indexes[offset]!] = result;
      }
      if (!applied.results.some((result) => result.status === "applied")) return;
      const persisted: PersistedRun = structuredClone(latest);
      persisted.captureReviews = applied.runs[0]?.captureReviews ?? latest.captureReviews;
      await persistPersistedRun(root, latest, persisted, "capture-review");
    });
  }
  const refreshed = (await listPersistedRuns(Number.MAX_SAFE_INTEGER, undefined, resolved)).filter(
    (run) => (run.projectId ?? "default") === projectId,
  );
  return {
    queue: captureReviewQueueForCampaign(
      await readCombineCampaign(projectId, resolved),
      refreshed.length ? refreshed : loaded,
    ),
    results: results.map((result, index) => {
      if (result) return result;
      const selection = input.items[index]!;
      return {
        runId: selection.runId,
        captureId: selection.captureId,
        status: "not-found",
        error: "That screenshot is not in this Plan's review queue",
      };
    }),
  };
}

export async function captureReviewQueueForPersistedPlan(
  batchId: string,
  filter?: PlanCaptureReviewFilter,
  projectId = "default",
): Promise<PlanCaptureReviewQueue> {
  const resolved = await resolvePersistedPlanBatchId(batchId, projectId);
  const [campaign, runs] = await Promise.all([
    readCombineCampaign(projectId, resolved),
    listPersistedRuns(Number.MAX_SAFE_INTEGER, undefined, resolved),
  ]);
  const queue = captureReviewQueueForCampaign(
    campaign,
    runs.filter((run) => (run.projectId ?? "default") === projectId),
  );
  return filterPlanCaptureReviewQueue(queue, filter);
}
