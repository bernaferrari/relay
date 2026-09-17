import * as z from "zod/v4";

/**
 * RC-15 execution queues. These are Test / Combine / Plan metadata — not a
 * new DSL. Workbook family queues stay separate; this only schedules duration.
 *
 * Fast UI: menus, settings, composer layout, subscription. Warm, bounded
 * setup, fresh image.
 * Live output: responses, tools, sources, Heavy, image/video gen. Genuine
 * service latency. A loading placeholder is not the Sequence after phase.
 * Stateful/survival: auth, deletion, persistence, lock, network, timed
 * interruptions. Isolated resources. A required 1-minute outage cannot
 * become a 10-second outage and still claim equivalent coverage.
 */

export const EXECUTION_QUEUES = ["fast-ui", "live-output", "stateful-survival"] as const;
export type ExecutionQueue = (typeof EXECUTION_QUEUES)[number];

export const SURVIVAL_FAMILY_ID = "S16";
export const SURVIVAL_REQUIRED_DWELL_MS = 60_000;
export const THREE_MINUTE_MS = 180_000;

export const EXECUTION_QUEUE_LABELS: Record<ExecutionQueue, string> = {
  "fast-ui": "Fast UI",
  "live-output": "Live output",
  "stateful-survival": "Stateful/survival",
};

/** Capacity / compile / Plan JSON must keep these three quotes distinct. */
export const EXECUTION_QUEUE_DURATION_ASSUMPTION =
  "Fast UI, Live output, and Stateful/survival report separate duration targets; never a three-minute workbook promise. A required 1-minute survival outage cannot become a 10-second outage.";

const QUEUE_SET = new Set<string>(EXECUTION_QUEUES);

export const executionQueueSchema = z.enum(EXECUTION_QUEUES);

export function isExecutionQueue(value: string): value is ExecutionQueue {
  return QUEUE_SET.has(value);
}

/** Dest-end chrome inspect (menus/settings/composer) defaults to Fast UI.
 * Device/network dest-end (airplane, lock, background, offline) does not. */
export function executionQueueForTest(input: {
  executionQueue?: ExecutionQueue;
  destEndChromeInspect?: boolean;
}): ExecutionQueue | undefined {
  if (input.executionQueue) return input.executionQueue;
  if (input.destEndChromeInspect) return "fast-ui";
  return undefined;
}

export function recipeStepIsDeviceEffect(step: { kind?: string; action?: string }): boolean {
  if (step.kind === "settings" || step.kind === "offline") return true;
  if (step.kind === "app" && (step.action === "background" || step.action === "close")) return true;
  if (step.kind === "device" && (step.action === "lock" || step.action === "unlock")) return true;
  return false;
}

export function destEndConnectionsAreChromeInspect(
  connections: readonly {
    destination?: { kind?: string };
    actions?: readonly {
      kind?: string;
      steps?: readonly { kind?: string; action?: string }[];
    }[];
  }[],
): boolean {
  const destEnds = connections.filter((connection) => connection.destination?.kind === "end");
  if (!destEnds.length) return false;
  return destEnds.every((connection) => {
    for (const action of connection.actions ?? []) {
      for (const step of action.steps ?? []) {
        if (recipeStepIsDeviceEffect(step)) return false;
      }
    }
    return true;
  });
}

const LOADING_PLACEHOLDER = /\b(working(\s+for)?|generating|processing|loading|thinking)\b/iu;

export function isLoadingPlaceholderText(value?: string): boolean {
  const text = value?.trim();
  if (!text) return false;
  return LOADING_PLACEHOLDER.test(text);
}

export function isPlaceholderPhaseId(phase?: string): boolean {
  return phase?.trim().toLowerCase() === "placeholder";
}

/** Sequence `after` is the final response. A loading placeholder is a different
 * named phase and cannot occupy after. */
export function sequenceAfterIsPlaceholder(input: {
  phase?: string;
  lookFor?: string;
  caption?: string;
  phases?: readonly { id: string; lookFor?: string; caption?: string }[];
}): boolean {
  const afterLooksLikePlaceholder = (lookFor?: string, caption?: string): boolean =>
    isLoadingPlaceholderText(lookFor) || isLoadingPlaceholderText(caption);
  if (input.phase === "after" && afterLooksLikePlaceholder(input.lookFor, input.caption)) {
    return true;
  }
  const after = input.phases?.find((phase) => phase.id === "after");
  if (!after) return false;
  return afterLooksLikePlaceholder(after.lookFor, after.caption);
}

export function canCoverWorkbookFamily(input: {
  executionQueue?: ExecutionQueue;
  declaredDwellMs?: number;
  family: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.family !== SURVIVAL_FAMILY_ID) return { ok: true };
  const queue = input.executionQueue;
  const dwell = input.declaredDwellMs ?? 0;
  if (queue !== "stateful-survival") {
    const label = queue ? EXECUTION_QUEUE_LABELS[queue] : "undeclared";
    return {
      ok: false,
      reason: `${label} cannot claim ${SURVIVAL_FAMILY_ID} ${SURVIVAL_REQUIRED_DWELL_MS}ms coverage`,
    };
  }
  if (dwell < SURVIVAL_REQUIRED_DWELL_MS) {
    return {
      ok: false,
      reason: `A ${dwell}ms dwell cannot claim ${SURVIVAL_FAMILY_ID} ${SURVIVAL_REQUIRED_DWELL_MS}ms coverage`,
    };
  }
  return { ok: true };
}

/** Wall time ≥ max(critical-path, total work ÷ workers, required dwell). */
export function wallTimeLowerBound(input: {
  criticalPathMs: number;
  totalWorkMs: number;
  workers: number;
  requiredDwellMs: number;
}): number {
  const workers = Math.max(1, Math.floor(input.workers));
  return Math.max(
    Math.max(0, input.criticalPathMs),
    Math.ceil(Math.max(0, input.totalWorkMs) / workers),
    Math.max(0, input.requiredDwellMs),
  );
}

export type ExecutionQueueMemberQuote = {
  executionQueue?: ExecutionQueue;
  destEndChromeInspect?: boolean;
  workMs: number;
  requiredDwellMs?: number;
};

export type ExecutionQueueDurationQuote = {
  queue: ExecutionQueue;
  label: (typeof EXECUTION_QUEUE_LABELS)[ExecutionQueue];
  workItemCount: number;
  totalWorkMs: number;
  criticalPathMs: number;
  workers: number;
  requiredDwellMs: number;
  lowerBoundMs: number;
};

export const executionQueueMemberQuoteSchema = z
  .object({
    executionQueue: executionQueueSchema.optional(),
    destEndChromeInspect: z.boolean().optional(),
    workMs: z.number(),
    requiredDwellMs: z.number().optional(),
  })
  .strict();

export const executionQueueDurationQuoteSchema = z
  .object({
    queue: executionQueueSchema,
    label: z.enum(["Fast UI", "Live output", "Stateful/survival"]),
    workItemCount: z.number(),
    totalWorkMs: z.number(),
    criticalPathMs: z.number(),
    workers: z.number(),
    requiredDwellMs: z.number(),
    lowerBoundMs: z.number(),
  })
  .strict();

/** Compile/runtime: runner recovery is not dest-wait / product-ready dwell. */
export type IosReadinessDurationQuote = {
  destWaitMs: number;
  runnerRecoverMs: number;
  productReadyMs: number;
};

export const iosReadinessDurationQuoteSchema = z
  .object({
    destWaitMs: z.number(),
    runnerRecoverMs: z.number(),
    productReadyMs: z.number(),
  })
  .strict();

/** Separate duration targets. Never a three-minute workbook promise. */
export function quoteDeclaredExecutionQueues(
  members: readonly ExecutionQueueMemberQuote[],
  workers = 1,
): ExecutionQueueDurationQuote[] {
  const grouped = new Map<ExecutionQueue, ExecutionQueueMemberQuote[]>();
  for (const member of members) {
    const queue = executionQueueForTest(member);
    if (!queue) continue;
    const bucket = grouped.get(queue) ?? [];
    bucket.push(member);
    grouped.set(queue, bucket);
  }
  const workerCount = Math.max(1, Math.floor(workers));
  const quotes: ExecutionQueueDurationQuote[] = [];
  for (const queue of EXECUTION_QUEUES) {
    const items = grouped.get(queue);
    if (!items?.length) continue;
    const totalWorkMs = items.reduce((sum, item) => sum + Math.max(0, item.workMs), 0);
    const requiredDwellMs = Math.max(0, ...items.map((item) => item.requiredDwellMs ?? 0));
    const criticalPathMs =
      workerCount > 1 ? Math.max(0, ...items.map((item) => item.workMs)) : totalWorkMs;
    quotes.push({
      queue,
      label: EXECUTION_QUEUE_LABELS[queue],
      workItemCount: items.length,
      totalWorkMs,
      criticalPathMs,
      workers: workerCount,
      requiredDwellMs,
      lowerBoundMs: wallTimeLowerBound({
        criticalPathMs,
        totalWorkMs,
        workers: workerCount,
        requiredDwellMs,
      }),
    });
  }
  return quotes;
}
