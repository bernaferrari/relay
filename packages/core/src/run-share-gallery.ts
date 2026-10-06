import { createHash } from "node:crypto";
import {
  destIdentitySourceFrames,
  captureReviewSlotId,
  formatCaptureReviewConfiguration,
  materializeCaptureReviewSlots,
  resolveCaptureReviewQueue,
  summarizeCaptureReview,
  type CaptureReviewItem,
  type CaptureReviewPlannedSlot,
  type CaptureReviewSummary,
  type CombineCampaign,
  type RunShareGalleryGroup,
} from "@relay/protocol";
import { parseAppMapTestExecutionIntentArtifact } from "./app-map-test-execution-intent.js";
import { parseAppMapCombineCellExecutionIntentArtifact } from "./app-map-combine-cell-intent.js";
import { captureReviewQueueForRun } from "./capture-review-queue.js";
import { executionIntentPlannedSlots } from "./run-test-step-evidence.js";
import type { PersistedRun } from "./runs.js";

/** A bounded snapshot in the existing share record. It retains the campaign's
 * frozen requested obligations even when a selected case has no Run yet. */
export type RunShareCaptureScope = {
  id: string;
  testIdentity: string;
  label: string;
  runId?: string;
  plannedSlots: readonly CaptureReviewPlannedSlot[];
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function frozenTest(run: PersistedRun) {
  for (const artifact of run.artifacts) {
    const intent =
      parseAppMapTestExecutionIntentArtifact(artifact) ??
      parseAppMapCombineCellExecutionIntentArtifact(artifact)?.child;
    if (!intent) continue;
    return {
      appMapId: intent.sourcePlan.appMapId,
      appMapRevision: intent.sourcePlan.appMapRevision,
      testId: intent.sourcePlan.testId,
      identity: digest([
        intent.sourcePlan.appMapId,
        intent.sourcePlan.testId,
        intent.plan.testFamily?.testRevision ?? intent.sourcePlan.appMapRevision,
        // Old plans have no Test revision. The complete frozen graph must
        // agree; an unchanged root can invoke a changed reusable module.
        intent.plan.testFamily ? undefined : intent.sourcePlan.recipeGraphDigest,
      ]),
    };
  }
  return undefined;
}

export function freezeRunShareCaptureScope(
  campaign: CombineCampaign,
  runs: readonly PersistedRun[],
  limit: number,
): RunShareCaptureScope[] {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const tests = runs.flatMap((run) => {
    const test = frozenTest(run);
    return test ? [test] : [];
  });
  const execution = campaign.execution;
  const selected = new Set(execution?.selectedExecutionCaseIds ?? execution?.selectedCellIds);
  return campaign.cases
    .filter((item) =>
      selected.has(
        execution?.selectedExecutionCaseIds ? (item.executionCaseId ?? item.cellId) : item.cellId,
      ),
    )
    .slice(0, limit)
    .flatMap((item): RunShareCaptureScope[] => {
      // Historical campaigns cannot promise checkpoints they never froze.
      if (item.plannedCaptures === undefined) return [];
      const current = byId.get(item.runId ?? item.jobId ?? "");
      const corresponding = new Set(
        tests
          .filter(
            (test) =>
              test.appMapId === campaign.appMapId &&
              test.appMapRevision === campaign.sourceRevision &&
              test.testId === item.testId,
          )
          .map((test) => test.identity),
      );
      const identity = current ? frozenTest(current)?.identity : undefined;
      const configuration = item.plannedCaptures[0]?.configuration;
      return [
        {
          id: digest([campaign.id, item.executionCaseId ?? item.cellId]),
          testIdentity:
            identity ??
            (corresponding.size === 1
              ? [...corresponding][0]!
              : digest([
                  "campaign",
                  campaign.id,
                  campaign.appMapId,
                  campaign.sourceRevision,
                  item.testId,
                ])),
          label:
            formatCaptureReviewConfiguration(configuration).join(" · ") ||
            item.world ||
            `Case ${item.index + 1}`,
          ...(current ? { runId: current.id } : {}),
          plannedSlots: structuredClone(item.plannedCaptures),
        },
      ];
    });
}

function shareableFrames(run: PersistedRun) {
  return destIdentitySourceFrames(
    run.frames.filter(
      (frame) => frame.mime === "image/png" || frame.path.toLowerCase().endsWith(".png"),
    ),
    run.artifacts,
  );
}

function runLabel(run: PersistedRun): string {
  return run.caseIndex !== undefined && run.caseCount
    ? `Case ${run.caseIndex + 1} of ${run.caseCount}`
    : (run.title ?? run.action);
}

export function buildRunShareGallery(
  runIds: readonly string[],
  runs: readonly PersistedRun[],
  scope: readonly RunShareCaptureScope[] | undefined,
  publicText: (value: string) => string,
): { gallery: RunShareGalleryGroup[]; captureReview?: CaptureReviewSummary } {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const groups = new Map<string, RunShareGalleryGroup>();
  const scopedRuns = new Set<string>();
  const usedFrames = new Set<string>();
  const reviewItems: CaptureReviewItem[] = [];
  const add = (input: {
    id: string;
    caption: string;
    label: string;
    runId?: string;
    frameIndex?: number;
    iteration?: number;
    attempt?: number;
    phase?: string;
  }) => {
    const group = groups.get(input.id) ?? {
      id: input.id,
      caption: publicText(input.caption),
      ...(input.iteration !== undefined ? { iteration: input.iteration } : {}),
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      ...(input.phase ? { phase: publicText(input.phase) } : {}),
      tiles: [],
    };
    group.tiles.push({
      label: publicText(input.label),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.frameIndex !== undefined ? { frameIndex: input.frameIndex } : {}),
    });
    groups.set(input.id, group);
  };
  const addQueue = (run: PersistedRun | undefined, frozen: RunShareCaptureScope | undefined) => {
    const plannedSlots =
      frozen?.plannedSlots ??
      materializeCaptureReviewSlots({
        plannedSlots: executionIntentPlannedSlots(run?.artifacts ?? []),
        recipeSteps: run?.recipeSnapshot?.steps,
        recipes: run?.recipeGraph,
      });
    const queue = frozen
      ? resolveCaptureReviewQueue({
          artifacts: run?.artifacts,
          decisions: run?.captureReviews,
          comparisons: run?.captureComparisons,
          plannedSlots: frozen.plannedSlots,
        })
      : captureReviewQueueForRun(run!);
    reviewItems.push(...queue.items);
    const frames = run ? shareableFrames(run) : [];
    const testIdentity = frozen?.testIdentity ?? (run ? frozenTest(run)?.identity : undefined);
    for (const item of queue.items) {
      // An observed dest phase may fill an explicitly unphased frozen slot.
      // The slotId names correspondence; observation metadata does not revise
      // that identity. Recapture attempts retain their own expanded slot.
      const planned = item.slotId
        ? plannedSlots.find(
            (slot) =>
              captureReviewSlotId(slot) === item.slotId ||
              captureReviewSlotId({ ...slot, attempt: item.attempt ?? 1 }) === item.slotId,
          )
        : undefined;
      const identitySlot = planned ? { ...planned, attempt: item.attempt ?? 1 } : item;
      const frameIndex = item.framePath
        ? frames.findIndex((frame) => frame.path === item.framePath)
        : -1;
      const hasFrame = item.status !== "missing" && frameIndex >= 0;
      if (hasFrame && run) usedFrames.add(`${run.id}:${frameIndex}`);
      const identity =
        testIdentity && identitySlot.checkpointId
          ? [
              testIdentity,
              identitySlot.requirementId,
              identitySlot.checkpointId,
              identitySlot.invocation,
              identitySlot.iteration,
              identitySlot.attempt ?? 1,
              identitySlot.phase,
            ]
          : ["unmatched", frozen?.id ?? run!.id, item.captureId];
      const label =
        formatCaptureReviewConfiguration(item.configuration).join(" · ") ||
        frozen?.label ||
        (run ? runLabel(run) : "Requested configuration");
      add({
        id: digest(identity),
        caption: item.caption,
        label: `${label}${run?.retryOf ? " · Retry" : run?.retriedBy ? " · Earlier run" : ""}`,
        ...(run ? { runId: run.id } : {}),
        ...(hasFrame ? { frameIndex } : {}),
        ...(identitySlot.iteration !== undefined ? { iteration: identitySlot.iteration } : {}),
        attempt: identitySlot.attempt ?? 1,
        ...(identitySlot.phase ? { phase: identitySlot.phase } : {}),
      });
    }
  };
  for (const frozen of scope ?? []) {
    const run = frozen.runId ? byId.get(frozen.runId) : undefined;
    if (run) scopedRuns.add(run.id);
    addQueue(run, frozen);
  }
  for (const id of runIds) {
    const run = byId.get(id);
    if (!run) {
      // The share's already-frozen Run membership remains visible even if
      // its persisted evidence has become unavailable.
      if (!scope?.some((item) => item.runId === id)) {
        add({
          id: digest(["unavailable-run", id]),
          caption: "Run evidence unavailable",
          label: "Requested run",
          runId: id,
        });
      }
      continue;
    }
    if (!scopedRuns.has(id)) addQueue(run, undefined);
    const frames = shareableFrames(run);
    for (const [frameIndex, frame] of frames.entries()) {
      if (usedFrames.has(`${id}:${frameIndex}`)) continue;
      // An unjoined frame is still useful evidence, but its caption or
      // position cannot establish cross-Test correspondence.
      add({
        id: digest(["frame", id, frameIndex]),
        caption: frame.caption || `Screen ${frameIndex + 1}`,
        label: runLabel(run),
        runId: id,
        frameIndex,
      });
    }
  }
  const captureReview = summarizeCaptureReview(reviewItems);
  return {
    gallery: [...groups.values()],
    ...(captureReview.captured + captureReview.missing > 0 ? { captureReview } : {}),
  };
}
