import {
  destIdentityReviewItems,
  formatCaptureReviewCoverageSummary,
  isCaptureReviewLeftoverPhase,
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
  /** Legacy campaign case whose original obligation was never frozen. */
  legacyScope?: "unknown";
  legacyReason?: string;
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
  expectedReviewVersion?: number;
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
      if (isCaptureReviewLeftoverPhase(item.phase)) continue;
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

/** Plan Gallery screen chip / human queue label. Strip bare `step:…:product`
 * / Capture · step captions — iOS models used to list
 * `step:step-action:Model selector SuperGrok` on filter chips after Run report
 * already kept the product title. lookFor stays review criteria, not the chip. */
export function planCaptureReviewScreenLabel(item: {
  lookFor?: string;
  caption?: string;
  checkpointId?: string;
}): string {
  const caption = normalizedFilterValue(item.caption);
  if (/^step:[^:]+:/u.test(caption)) {
    const product = caption.split(":").slice(2).join(":").trim();
    if (product) return product;
  }
  const captureLabel = /^(?:Capture for review|Screenshot) · step:[^:]+:(.+)$/u
    .exec(caption)?.[1]
    ?.trim();
  if (captureLabel) return captureLabel;
  return caption || normalizedFilterValue(item.lookFor) || normalizedFilterValue(item.checkpointId);
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
  if (isCaptureReviewLeftoverPhase(item.phase)) return false;
  if (filter.pending && item.status !== "pending") return false;
  if (filter.screen) {
    const screen = filter.screen;
    if (
      !sameFilterValue(planCaptureReviewScreenLabel(item), screen) &&
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

/** Visible dest identity only. Leftover Close / Transition last-frame is not dest.
 * Opener before · Tap cannot fill the visible queue beside leftover Transition.
 * Coverage counts stay on the full Plan queue. */
export function filterPlanCaptureReviewQueue(
  queue: PlanCaptureReviewQueue,
  filter?: PlanCaptureReviewFilter,
): PlanCaptureReviewQueue {
  const destIdentity = {
    items: destIdentityReviewItems(queue.items),
    summary: queue.summary,
  };
  const parsed = parsePlanCaptureReviewFilter(filter ?? {});
  if (!parsed) return destIdentity;
  return {
    items: destIdentity.items.filter((item) => planCaptureReviewItemMatchesFilter(item, parsed)),
    summary: destIdentity.summary,
  };
}

/** Screen/device/account chips for Plan Gallery. Leftover Close / Transition /
 * Inspect setup skipped never appear. Opener before · Tap cannot fill chips
 * beside leftover Transition either (parity with destIdentityReviewItems /
 * visible queue). Coverage counts stay on the full Plan queue. */
export function planCaptureReviewFilterOptions(items: readonly PlanCaptureReviewItem[]): {
  screens: string[];
  devices: string[];
  accounts: string[];
} {
  const screens = new Set<string>();
  const devices = new Set<string>();
  const accounts = new Set<string>();
  for (const item of destIdentityReviewItems(items)) {
    const screen = planCaptureReviewScreenLabel(item);
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

/** Human Plan capture-review list. Dest wait-for stays; leftover Close cannot fill dest. */
export function formatPlanCaptureReviewQueue(queue: PlanCaptureReviewQueue): string {
  const dest = filterPlanCaptureReviewQueue(queue);
  const rows = dest.items.map((item) => {
    const attempt = item.attempt && item.attempt > 1 ? ` · attempt ${item.attempt}` : "";
    const blocked = item.blocked ? " · blocked" : "";
    const approximation =
      item.scenarioKind && item.scenarioKind !== "physical"
        ? ` · ${item.scenarioKind.replaceAll("-", " ")}`
        : "";
    const place = [item.device, item.account, item.observed?.laneId].filter(Boolean).join(" · ");
    const placeSuffix = place ? ` · ${place}` : "";
    return `${item.runId} · ${planCaptureReviewScreenLabel(item)}${attempt} · ${item.status}${blocked}${approximation}${placeSuffix}`;
  });
  const shown =
    dest.summary.planned && dest.items.length !== dest.summary.planned
      ? [`Showing ${dest.items.length} of ${dest.summary.planned}`]
      : [];
  return [
    formatCaptureReviewCoverageSummary(dest.summary),
    ...shown,
    "Looks correct does not approve a visual baseline.",
    ...rows,
  ].join("\n");
}
