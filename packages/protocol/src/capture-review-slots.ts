import type { CaptureSequencePhase } from "./recipes.js";
import type {
  CaptureReviewConfiguration,
  CaptureReviewPlannedSlot,
  CaptureReviewSlotIdentity,
} from "./capture-review.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function captureReviewSlotId(identity: CaptureReviewSlotIdentity): string {
  const configuration = formatCaptureReviewConfiguration(identity.configuration).join(",");
  const parts = [
    identity.requirementId?.trim() || "",
    identity.checkpointId.trim() || "checkpoint",
    configuration,
    identity.invocation?.trim() || "",
    identity.iteration === undefined ? "" : String(identity.iteration),
    identity.attempt === undefined ? "" : String(identity.attempt),
  ];
  const phase = identity.phase?.trim();
  if (phase) parts.push(phase);
  return parts.join("::");
}

/** Identity without attempt. Recapture of the same phase keeps this family. */
export function captureReviewSlotFamilyId(identity: CaptureReviewSlotIdentity): string {
  return captureReviewSlotId({ ...identity, attempt: undefined });
}

/** Sequence phases of one checkpoint share this id; phase is not included. */
export function captureReviewCheckpointFamilyId(identity: CaptureReviewSlotIdentity): string {
  return captureReviewSlotId({ ...identity, attempt: undefined, phase: undefined });
}

function sameCaptureReviewPhase(left?: string, right?: string): boolean {
  return (left?.trim() || "") === (right?.trim() || "");
}

/** Named Sequence frames. An unphased sequence is not a silent Stable slot. */
export function namedCaptureSequencePhases(review: unknown): CaptureSequencePhase[] {
  const payload = record(review);
  if (!payload) return [];
  const named: CaptureSequencePhase[] = [];
  const seen = new Set<string>();
  if (Array.isArray(payload.phases)) {
    for (const item of payload.phases) {
      const phase = record(item);
      const id = text(phase?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const intervalMs = integerField(phase?.intervalMs);
      named.push({
        id,
        ...(text(phase?.caption) ? { caption: text(phase?.caption) } : {}),
        ...(text(phase?.lookFor) ? { lookFor: text(phase?.lookFor) } : {}),
        ...(intervalMs !== undefined && intervalMs > 0 ? { intervalMs } : {}),
      });
    }
  }
  const current = text(payload.phase);
  if (current && !seen.has(current)) {
    named.push({ id: current });
  }
  return named;
}

export function normalizedCaptureReviewAttempt(attempt?: number): number {
  return attempt === undefined ? 1 : attempt;
}

export function sameCaptureReviewAttempt(left?: number, right?: number): boolean {
  return normalizedCaptureReviewAttempt(left) === normalizedCaptureReviewAttempt(right);
}

export function withCaptureReviewAttempt(
  slot: CaptureReviewPlannedSlot,
  attempt: number,
): CaptureReviewPlannedSlot {
  return { ...slot, attempt };
}

export function plannedSlotHasAttempt(
  slots: readonly CaptureReviewPlannedSlot[],
  identity: CaptureReviewSlotIdentity,
  attempt: number,
): boolean {
  return slots.some(
    (slot) =>
      captureReviewSlotFamilyId(slot) === captureReviewSlotFamilyId(identity) &&
      sameCaptureReviewAttempt(slot.attempt, attempt),
  );
}

/**
 * Assign the next recapture attempt for one checkpoint family.
 * Leftover chrome is not an input; only prior capture identities occupy attempts.
 */
export function assignCaptureReviewAttempt(input: {
  plannedSlots: readonly CaptureReviewPlannedSlot[];
  captured?: readonly CaptureReviewSlotIdentity[];
  slot: CaptureReviewPlannedSlot;
}): { attempt: number; plannedSlots: CaptureReviewPlannedSlot[] } {
  const family = captureReviewSlotFamilyId(input.slot);
  const planned: CaptureReviewPlannedSlot[] = input.plannedSlots.map((slot) =>
    captureReviewSlotFamilyId(slot) === family && slot.attempt === undefined
      ? withCaptureReviewAttempt(slot, 1)
      : slot,
  );
  if (!planned.some((slot) => captureReviewSlotFamilyId(slot) === family)) {
    planned.push(withCaptureReviewAttempt(input.slot, 1));
  }
  const captured = (input.captured ?? []).filter(
    (identity) => captureReviewSlotFamilyId(identity) === family,
  );
  if (captured.length === 0) return { attempt: 1, plannedSlots: planned };
  const occupied = [
    ...planned
      .filter((slot) => captureReviewSlotFamilyId(slot) === family)
      .map((slot) => normalizedCaptureReviewAttempt(slot.attempt)),
    ...captured.map((identity) => normalizedCaptureReviewAttempt(identity.attempt)),
  ];
  const attempt = Math.max(...occupied) + 1;
  if (!plannedSlotHasAttempt(planned, input.slot, attempt)) {
    planned.push(withCaptureReviewAttempt(input.slot, attempt));
  }
  return { attempt, plannedSlots: planned };
}
export function formatCaptureReviewConfiguration(
  configuration?: CaptureReviewConfiguration,
): string[] {
  if (!configuration) return [];
  return [
    configuration.app,
    configuration.account,
    configuration.browser,
    configuration.viewport,
    configuration.locale,
    configuration.build,
  ].filter((part): part is string => Boolean(part?.trim()));
}
export function joinCaptureReviewInvocation(parent: string | undefined, part: string): string {
  return parent ? `${parent}/${part}` : part;
}

export type CaptureReviewRuntimeCursor = {
  requirementId?: string;
  invocation?: string;
  iteration?: number;
  attempt?: number;
  moduleCalls: Map<string, number>;
};

export function captureReviewEnterModule(
  cursor: CaptureReviewRuntimeCursor | undefined,
  recipeId: string,
): CaptureReviewRuntimeCursor {
  const moduleCalls = cursor?.moduleCalls ?? new Map<string, number>();
  const call = moduleCalls.get(recipeId) ?? 0;
  moduleCalls.set(recipeId, call + 1);
  return {
    ...(cursor?.requirementId ? { requirementId: cursor.requirementId } : {}),
    ...(cursor?.attempt !== undefined ? { attempt: cursor.attempt } : {}),
    ...(cursor?.iteration !== undefined ? { iteration: cursor.iteration } : {}),
    invocation: joinCaptureReviewInvocation(cursor?.invocation, `module:${recipeId}#${call}`),
    moduleCalls,
  };
}

export function captureReviewEnterRepeat(
  cursor: CaptureReviewRuntimeCursor | undefined,
  recipeId: string,
  iteration: number,
): CaptureReviewRuntimeCursor {
  return {
    ...(cursor?.requirementId ? { requirementId: cursor.requirementId } : {}),
    ...(cursor?.attempt !== undefined ? { attempt: cursor.attempt } : {}),
    invocation: joinCaptureReviewInvocation(cursor?.invocation, `repeat:${recipeId}`),
    iteration,
    moduleCalls: new Map(),
  };
}

function recipeRecord(
  recipes: Record<string, { steps?: readonly unknown[] }> | undefined,
  recipeId: string,
): { steps?: readonly unknown[] } | undefined {
  return recipes?.[recipeId];
}

function plannedScreenshotSlot(
  input: {
    checkpointId: string;
    caption: string;
    lookFor?: string;
    stepId?: string;
    phase?: string;
    intervalMs?: number;
  },
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
  },
): CaptureReviewPlannedSlot {
  return {
    checkpointId: input.checkpointId,
    caption: input.caption,
    attempt: context.attempt ?? 1,
    ...(context.requirementId ? { requirementId: context.requirementId } : {}),
    ...(context.configuration ? { configuration: context.configuration } : {}),
    ...(context.invocation ? { invocation: context.invocation } : {}),
    ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.lookFor ? { lookFor: input.lookFor } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
  };
}

function screenshotSlots(
  step: Record<string, unknown>,
  path: string,
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
  },
): CaptureReviewPlannedSlot[] {
  const review = record(step.review);
  if (review?.mode !== "later") return [];
  const stepId = text(step.id);
  const checkpointId = text(review.checkpointId) ?? stepId ?? `screenshot:${path}`;
  const defaultCaption = text(step.caption) ?? "screenshot";
  const defaultLookFor = text(review.lookFor);
  const policy = text(review.policy);
  if (policy === "sequence") {
    return namedCaptureSequencePhases(review).map((phase) =>
      plannedScreenshotSlot(
        {
          checkpointId,
          caption: phase.caption ?? defaultCaption,
          ...((phase.lookFor ?? defaultLookFor)
            ? { lookFor: phase.lookFor ?? defaultLookFor }
            : {}),
          ...(stepId ? { stepId } : {}),
          phase: phase.id,
          ...(phase.intervalMs !== undefined ? { intervalMs: phase.intervalMs } : {}),
        },
        context,
      ),
    );
  }
  const phase = text(review.phase);
  return [
    plannedScreenshotSlot(
      {
        checkpointId,
        caption: defaultCaption,
        ...(defaultLookFor ? { lookFor: defaultLookFor } : {}),
        ...(stepId ? { stepId } : {}),
        ...(phase ? { phase } : {}),
      },
      context,
    ),
  ];
}

function pushUniqueCaptureSlot(
  slots: CaptureReviewPlannedSlot[],
  slot: CaptureReviewPlannedSlot,
): void {
  const id = captureReviewSlotId(slot);
  if (slots.some((existing) => captureReviewSlotId(existing) === id)) return;
  slots.push(slot);
}

function walkCaptureSlots(
  steps: readonly unknown[],
  recipes: Record<string, { steps?: readonly unknown[] }> | undefined,
  context: {
    requirementId?: string;
    configuration?: CaptureReviewConfiguration;
    invocation?: string;
    iteration?: number;
    attempt?: number;
    path: string;
  },
  moduleCalls: Map<string, number>,
): CaptureReviewPlannedSlot[] {
  const slots: CaptureReviewPlannedSlot[] = [];
  for (const [index, value] of steps.entries()) {
    const step = record(value);
    if (!step) continue;
    const path = context.path ? `${context.path}.${index}` : String(index);
    const kind = text(step.kind);
    if (kind === "screenshot") {
      for (const slot of screenshotSlots(step, path, context)) pushUniqueCaptureSlot(slots, slot);
      continue;
    }
    if (kind === "module") {
      const recipeId = text(step.recipeId);
      if (!recipeId) continue;
      const call = moduleCalls.get(recipeId) ?? 0;
      moduleCalls.set(recipeId, call + 1);
      const invocation = joinCaptureReviewInvocation(
        context.invocation,
        `module:${recipeId}#${call}`,
      );
      const nested = recipeRecord(recipes, recipeId);
      if (nested?.steps) {
        slots.push(
          ...walkCaptureSlots(nested.steps, recipes, { ...context, invocation, path }, moduleCalls),
        );
      } else {
        slots.push({
          checkpointId: `module:${recipeId}`,
          caption: recipeId,
          invocation,
          ...(context.requirementId ? { requirementId: context.requirementId } : {}),
          ...(context.configuration ? { configuration: context.configuration } : {}),
          ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
        });
      }
      continue;
    }
    if (kind === "branch") {
      for (const recipeId of [text(step.thenRecipeId), text(step.elseRecipeId)]) {
        if (!recipeId) continue;
        const call = moduleCalls.get(recipeId) ?? 0;
        moduleCalls.set(recipeId, call + 1);
        const invocation = joinCaptureReviewInvocation(
          context.invocation,
          `module:${recipeId}#${call}`,
        );
        const nested = recipeRecord(recipes, recipeId);
        if (nested?.steps) {
          slots.push(
            ...walkCaptureSlots(
              nested.steps,
              recipes,
              { ...context, invocation, path },
              moduleCalls,
            ),
          );
        } else {
          slots.push({
            checkpointId: `module:${recipeId}`,
            caption: recipeId,
            invocation,
            ...(context.requirementId ? { requirementId: context.requirementId } : {}),
            ...(context.configuration ? { configuration: context.configuration } : {}),
            ...(context.iteration !== undefined ? { iteration: context.iteration } : {}),
          });
        }
      }
      continue;
    }
    if (kind === "repeat") {
      const recipeId = text(step.recipeId);
      const count = integerField(step.count) ?? 0;
      if (!recipeId || count <= 0) continue;
      const nested = recipeRecord(recipes, recipeId);
      for (let iteration = 0; iteration < count; iteration += 1) {
        const invocation = joinCaptureReviewInvocation(context.invocation, `repeat:${recipeId}`);
        if (nested?.steps) {
          slots.push(
            ...walkCaptureSlots(
              nested.steps,
              recipes,
              { ...context, invocation, iteration, path: `${path}[${iteration}]` },
              new Map(),
            ),
          );
        } else {
          slots.push({
            checkpointId: `repeat:${recipeId}`,
            caption: recipeId,
            invocation,
            iteration,
            ...(context.requirementId ? { requirementId: context.requirementId } : {}),
            ...(context.configuration ? { configuration: context.configuration } : {}),
          });
        }
      }
      continue;
    }
    if (kind === "loop") {
      const nestedSteps = Array.isArray(step.steps) ? step.steps : undefined;
      const values = Array.isArray(step.values) ? step.values : undefined;
      const count = integerField(step.count) ?? values?.length ?? 0;
      const recipeId = text(step.recipeId);
      const body = nestedSteps ?? recipeRecord(recipes, recipeId ?? "")?.steps;
      for (let iteration = 0; iteration < count; iteration += 1) {
        const invocation = joinCaptureReviewInvocation(
          context.invocation,
          `loop:${recipeId || path}`,
        );
        if (body) {
          slots.push(
            ...walkCaptureSlots(
              body,
              recipes,
              { ...context, invocation, iteration, path: `${path}[${iteration}]` },
              new Map(),
            ),
          );
        }
      }
    }
  }
  return slots;
}

/** Expand the compiled plan into expected capture slots. Captions are labels. */
export function materializeCaptureReviewSlots(input: {
  recipeSteps?: readonly unknown[];
  recipes?: Record<string, { steps?: readonly unknown[] }>;
  plannedSlots?: readonly CaptureReviewPlannedSlot[];
  configuration?: CaptureReviewConfiguration;
  requirementId?: string;
}): CaptureReviewPlannedSlot[] {
  if (input.plannedSlots !== undefined) return [...input.plannedSlots];
  return walkCaptureSlots(
    input.recipeSteps ?? [],
    input.recipes,
    {
      path: "",
      ...(input.requirementId ? { requirementId: input.requirementId } : {}),
      ...(input.configuration ? { configuration: input.configuration } : {}),
    },
    new Map(),
  );
}
