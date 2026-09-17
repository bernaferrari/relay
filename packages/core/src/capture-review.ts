import {
  actorKindFromId,
  resolveCaptureReviewQueue,
  type ActorKind,
  type CaptureReviewAction,
  type CaptureReviewDecision,
  type CaptureReviewPlannedSlot,
  type CaptureReviewQueue,
} from "@relay/protocol";
import { executionIntentPlannedSlots } from "./run-test-step-evidence.js";
import {
  persistPersistedRun,
  persistedRunBelongsToStore,
  readCompletedPersistedRun,
  withRunWriteLock,
  type PersistedRun,
} from "./runs.js";

export class CaptureReviewError extends Error {
  readonly code:
    | "CAPTURE_REVIEW_NOT_FOUND"
    | "CAPTURE_REVIEW_UNAVAILABLE"
    | "CAPTURE_REVIEW_CONFLICT"
    | "CAPTURE_REVIEW_ACTOR_REQUIRED"
    | "CAPTURE_REVIEW_MISSING";
  readonly recovery: string;

  constructor(code: CaptureReviewError["code"], message: string, recovery: string) {
    super(message);
    this.name = "CaptureReviewError";
    this.code = code;
    this.recovery = recovery;
  }
}

export type CaptureReviewResult = {
  run: PersistedRun;
  queue: CaptureReviewQueue;
  decision: CaptureReviewDecision;
};

type CaptureReviewRun = Pick<PersistedRun, "artifacts" | "captureReviews"> & {
  recipeSnapshot?: {
    steps?: readonly unknown[];
    recipes?: Record<string, { steps?: readonly unknown[] }>;
  };
  recipeGraph?: Record<string, { steps?: readonly unknown[] }>;
};

function plannedSlotsForRun(
  run: CaptureReviewRun,
): readonly CaptureReviewPlannedSlot[] | undefined {
  return executionIntentPlannedSlots(run.artifacts ?? []);
}

export function captureReviewQueueForRun(run: CaptureReviewRun): CaptureReviewQueue {
  return resolveCaptureReviewQueue({
    artifacts: run.artifacts,
    decisions: run.captureReviews,
    recipeSteps: run.recipeSnapshot?.steps,
    recipes: run.recipeGraph ?? run.recipeSnapshot?.recipes,
    plannedSlots: plannedSlotsForRun(run),
  });
}

export function assertHumanCaptureReviewActor(
  actor: { id: string; kind: ActorKind },
  message: string,
  recovery: string,
): void {
  if (actor.kind !== "human" || actorKindFromId(actor.id) !== "human") {
    throw new CaptureReviewError("CAPTURE_REVIEW_ACTOR_REQUIRED", message, recovery);
  }
}

export function applyCaptureReviewDecision(
  run: CaptureReviewRun & Pick<PersistedRun, "outcome">,
  input: {
    captureId: string;
    action: CaptureReviewAction;
    actor: { id: string; kind: ActorKind };
    imageSha256?: string;
    note?: string;
  },
): { captureReviews: CaptureReviewDecision[]; queue: CaptureReviewQueue; outcome?: string } {
  assertHumanCaptureReviewActor(
    input.actor,
    "A human must decide this screenshot",
    "Open the Run captures panel and ask a person to mark Looks correct, Report issue, or Need more evidence.",
  );
  const current = captureReviewQueueForRun(run);
  const item = current.items.find((candidate) => candidate.captureId === input.captureId);
  if (!item) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_NOT_FOUND",
      "That screenshot is not in this Run's review queue",
      "Refresh the Run and review the exact image shown in the captures panel.",
    );
  }
  if (item.status === "missing" && input.action === "accept") {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_MISSING",
      "A missing screenshot cannot be marked Looks correct",
      "Re-run the Test so Relay captures the screen, then review that new image.",
    );
  }
  if (item.imageSha256 && input.imageSha256 && item.imageSha256 !== input.imageSha256) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_CONFLICT",
      "This decision does not match the image currently on screen",
      "Refresh the Run and review the exact PNG that is displayed. Looks correct never applies to a later screenshot.",
    );
  }
  const prior = (run.captureReviews ?? []).find(
    (decision) => decision.captureId === item.captureId,
  );
  if (prior && prior.decidedBy.id !== input.actor.id) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_CONFLICT",
      "Another reviewer already saved a decision for this screenshot",
      "Refresh the Plan captures panel and continue with items that are still pending. Looks correct never overwrites another person's saved decision.",
    );
  }
  const note = input.note?.trim().slice(0, 2_000) || prior?.note;
  if (
    prior &&
    prior.action === input.action &&
    (!prior.imageSha256 || !item.imageSha256 || prior.imageSha256 === item.imageSha256)
  ) {
    const captureReviews =
      note === prior.note
        ? (run.captureReviews ?? [])
        : (run.captureReviews ?? []).map((decision) =>
            decision.captureId === prior.captureId
              ? { ...prior, ...(note ? { note } : {}) }
              : decision,
          );
    return {
      captureReviews,
      queue: captureReviewQueueForRun({ ...run, captureReviews }),
      outcome: run.outcome,
    };
  }
  const decision: CaptureReviewDecision = {
    captureId: item.captureId,
    action: input.action,
    decidedAt: Date.now(),
    decidedBy: input.actor,
    ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
    ...(note ? { note } : {}),
  };
  const captureReviews = [
    ...(run.captureReviews ?? []).filter((existing) => existing.captureId !== item.captureId),
    decision,
  ];
  return {
    captureReviews,
    queue: captureReviewQueueForRun({ ...run, captureReviews }),
    outcome: run.outcome,
  };
}

export function reviewPersistedCapture(
  root: string,
  run: PersistedRun,
  input: {
    captureId: string;
    action: CaptureReviewAction;
    actor: { id: string; kind: ActorKind };
    imageSha256?: string;
    note?: string;
  },
): Promise<CaptureReviewResult> {
  return withRunWriteLock(run.dir, async () => {
    const latest = (await readCompletedPersistedRun(run.dir)) ?? run;
    latest.dir = run.dir;
    if (!persistedRunBelongsToStore(root, latest.dir)) {
      throw new CaptureReviewError(
        "CAPTURE_REVIEW_UNAVAILABLE",
        "This run is outside the configured Relay run store",
        "Re-open the run from the current project before reviewing screenshots.",
      );
    }
    const applied = applyCaptureReviewDecision(latest, input);
    const next: PersistedRun = structuredClone(latest);
    next.captureReviews = applied.captureReviews;
    const persisted = await persistPersistedRun(root, latest, next, "capture-review");
    return {
      run: persisted,
      queue: applied.queue,
      decision: applied.captureReviews.find((decision) => decision.captureId === input.captureId)!,
    };
  });
}
