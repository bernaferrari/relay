import {
  formatCaptureReviewCoverageSummary,
  resolveCaptureReviewQueue,
  summarizeCaptureReview,
  type CaptureReviewAction,
  type CaptureReviewDecision,
  type CaptureReviewItem,
  type CaptureReviewPlannedSlot,
  type CaptureReviewSummary,
} from "./capture-review.js";

export type PlanCaptureReviewItem = CaptureReviewItem & {
  runId?: string;
  /** Stable campaign obligation, including cases not dispatched yet. */
  executionCaseId?: string;
  blocked?: boolean;
  device?: string;
  account?: string;
  /** Physical vs simulator/emulator/browser approximation. Never implied by Lane name. */
  scenarioKind?:
    | "physical"
    | "simulator-approximation"
    | "emulator-approximation"
    | "browser-approximation";
};

export type PlanCaptureReviewSummary = CaptureReviewSummary & {
  planned: number;
  blocked: number;
};

export type PlanCaptureReviewQueue = {
  items: PlanCaptureReviewItem[];
  summary: PlanCaptureReviewSummary;
};

export type PlanCaptureReviewRunInput = {
  runId?: string;
  executionCaseId?: string;
  artifacts?: readonly { kind?: string; data?: unknown }[];
  decisions?: readonly CaptureReviewDecision[];
  recipeSteps?: readonly unknown[];
  recipes?: Record<string, { steps?: readonly unknown[] }>;
  plannedSlots?: readonly CaptureReviewPlannedSlot[];
  blocked?: boolean;
  device?: string;
  account?: string;
};

export type PlanCaptureReviewFilter = {
  pending?: boolean;
  screen?: string;
  device?: string;
  account?: string;
};

export type PlanCaptureReviewSelection = {
  runId: string;
  captureId: string;
  imageSha256?: string;
  action?: CaptureReviewAction;
  note?: string;
};

export function summarizePlanCaptureReview(
  items: readonly PlanCaptureReviewItem[],
): PlanCaptureReviewSummary {
  const blockedItems = items.filter((item) => item.blocked);
  const summary = summarizeCaptureReview(items.filter((item) => !item.blocked));
  return {
    ...summary,
    planned: items.length,
    blocked: blockedItems.length,
  };
}

/** Aggregate capture-review records across one Plan. Missing stays in the denominator. */
export function resolvePlanCaptureReviewQueue(
  runs: readonly PlanCaptureReviewRunInput[],
): PlanCaptureReviewQueue {
  const items: PlanCaptureReviewItem[] = [];
  for (const run of runs) {
    const queue = resolveCaptureReviewQueue({
      artifacts: run.artifacts,
      decisions: run.decisions,
      recipeSteps: run.recipeSteps,
      recipes: run.recipes,
      plannedSlots: run.plannedSlots,
    });
    for (const item of queue.items) {
      const device = item.configuration?.app || item.configuration?.browser || run.device;
      const account = item.configuration?.account;
      items.push({
        ...item,
        ...(run.runId ? { runId: run.runId } : {}),
        ...(run.executionCaseId ? { executionCaseId: run.executionCaseId } : {}),
        ...(run.blocked && item.status === "missing" ? { blocked: true } : {}),
        ...(device ? { device } : {}),
        ...(account ? { account } : {}),
      });
    }
  }
  return { items, summary: summarizePlanCaptureReview(items) };
}

function normalizedFilterValue(value?: string): string {
  return value?.trim() ?? "";
}

function sameFilterValue(value: string | undefined, needle: string): boolean {
  return normalizedFilterValue(value).toLowerCase() === needle.toLowerCase();
}

export function parsePlanCaptureReviewFilter(input: {
  pending?: unknown;
  screen?: unknown;
  device?: unknown;
  account?: unknown;
}): PlanCaptureReviewFilter | undefined {
  const pending = input.pending === true || input.pending === "true" || input.pending === "1";
  const screen = typeof input.screen === "string" ? input.screen.trim() : "";
  const device = typeof input.device === "string" ? input.device.trim() : "";
  const account = typeof input.account === "string" ? input.account.trim() : "";
  if (!pending && !screen && !device && !account) return undefined;
  return {
    ...(pending ? { pending: true } : {}),
    ...(screen ? { screen } : {}),
    ...(device ? { device } : {}),
    ...(account ? { account } : {}),
  };
}

export function planCaptureReviewItemMatchesFilter(
  item: PlanCaptureReviewItem,
  filter?: PlanCaptureReviewFilter,
): boolean {
  if (!filter) return true;
  if (filter.pending && item.status !== "pending") return false;
  if (filter.screen) {
    const screen = filter.screen;
    if (
      !sameFilterValue(item.caption, screen) &&
      !sameFilterValue(item.checkpointId, screen) &&
      !sameFilterValue(item.requirementId, screen)
    ) {
      return false;
    }
  }
  if (filter.device) {
    const device = filter.device;
    if (
      !sameFilterValue(item.device, device) &&
      !sameFilterValue(item.configuration?.app, device) &&
      !sameFilterValue(item.configuration?.browser, device)
    ) {
      return false;
    }
  }
  if (
    filter.account &&
    !sameFilterValue(item.account ?? item.configuration?.account, filter.account)
  ) {
    return false;
  }
  return true;
}

/** Visible working set only. Coverage counts stay on the full Plan queue. */
export function filterPlanCaptureReviewQueue(
  queue: PlanCaptureReviewQueue,
  filter?: PlanCaptureReviewFilter,
): PlanCaptureReviewQueue {
  const parsed = parsePlanCaptureReviewFilter(filter ?? {});
  if (!parsed) return queue;
  return {
    items: queue.items.filter((item) => planCaptureReviewItemMatchesFilter(item, parsed)),
    summary: queue.summary,
  };
}

export function planCaptureReviewFilterOptions(items: readonly PlanCaptureReviewItem[]): {
  screens: string[];
  devices: string[];
  accounts: string[];
} {
  const screens = new Set<string>();
  const devices = new Set<string>();
  const accounts = new Set<string>();
  for (const item of items) {
    const screen = normalizedFilterValue(item.caption) || normalizedFilterValue(item.checkpointId);
    if (screen) screens.add(screen);
    const device =
      normalizedFilterValue(item.device) ||
      normalizedFilterValue(item.configuration?.app) ||
      normalizedFilterValue(item.configuration?.browser);
    if (device) devices.add(device);
    const account =
      normalizedFilterValue(item.account) || normalizedFilterValue(item.configuration?.account);
    if (account) accounts.add(account);
  }
  return {
    screens: [...screens].sort((left, right) => left.localeCompare(right)),
    devices: [...devices].sort((left, right) => left.localeCompare(right)),
    accounts: [...accounts].sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * Exact selected items only. A later arrival, an unselected image, or a
 * hidden/filtered-out case is never included. Missing screenshots cannot be
 * selected for Looks correct.
 */
export function selectedPlanCaptureReviewItems(
  queue: PlanCaptureReviewQueue,
  selections: readonly PlanCaptureReviewSelection[],
  filter?: PlanCaptureReviewFilter,
): PlanCaptureReviewItem[] {
  const visible = filterPlanCaptureReviewQueue(queue, filter);
  const selected: PlanCaptureReviewItem[] = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    const key = `${selection.runId}::${selection.captureId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = visible.items.find(
      (candidate) =>
        candidate.runId === selection.runId && candidate.captureId === selection.captureId,
    );
    if (!item || item.status === "missing" || item.blocked) continue;
    if (selection.imageSha256 && item.imageSha256 && selection.imageSha256 !== item.imageSha256) {
      continue;
    }
    selected.push(item);
  }
  return selected;
}

/** Unique across a Plan even when two Runs share a framePath hash. */
export function captureReviewQueueItemKey(item: {
  captureId: string;
  runId?: string;
  executionCaseId?: string;
}): string {
  return item.runId
    ? `${item.runId}::${item.captureId}`
    : item.executionCaseId
      ? `case:${item.executionCaseId}::${item.captureId}`
      : item.captureId;
}

export function captureReviewQueueFrameKey(item: {
  framePath?: string;
  runId?: string;
}): string | undefined {
  if (!item.framePath) return undefined;
  return item.runId ? `${item.runId}::${item.framePath}` : item.framePath;
}

export function formatPlanCaptureReviewQueue(queue: PlanCaptureReviewQueue): string {
  const rows = queue.items.map((item) => {
    const attempt = item.attempt && item.attempt > 1 ? ` · attempt ${item.attempt}` : "";
    const blocked = item.blocked ? " · blocked" : "";
    const approximation =
      item.scenarioKind && item.scenarioKind !== "physical"
        ? ` · ${item.scenarioKind.replaceAll("-", " ")}`
        : "";
    const place = [item.device, item.account, item.observed?.laneId].filter(Boolean).join(" · ");
    const placeSuffix = place ? ` · ${place}` : "";
    return `${item.runId} · ${item.caption}${attempt} · ${item.status}${blocked}${approximation}${placeSuffix}`;
  });
  const shown =
    queue.summary.planned && queue.items.length !== queue.summary.planned
      ? [`Showing ${queue.items.length} of ${queue.summary.planned}`]
      : [];
  return [
    formatCaptureReviewCoverageSummary(queue.summary),
    ...shown,
    "Looks correct does not approve a visual baseline.",
    ...rows,
  ].join("\n");
}
