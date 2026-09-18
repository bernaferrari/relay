import {
  actorKindFromId,
  type ActorKind,
  type CaptureReviewAction,
  type CaptureReviewDecision,
  type CaptureReviewQueue,
} from "@relay/protocol";
import { captureReviewQueueForRun, type CaptureReviewRun } from "./capture-review-queue.js";
export { captureReviewQueueForRun } from "./capture-review-queue.js";
import {
  persistPersistedRun,
  persistedRunBelongsToStore,
  readCompletedPersistedRun,
  withRunWriteLock,
  type PersistedRun,
} from "./runs.js";
import { currentOperationContext } from "./operation-context.js";

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
    requestId?: string;
    expectedReviewVersion?: number;
  },
): {
  captureReviews: CaptureReviewDecision[];
  captureReviewReceipts: CaptureReviewDecision[];
  queue: CaptureReviewQueue;
  decision: CaptureReviewDecision;
  outcome?: string;
  changed: boolean;
} {
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
  const requestId = input.requestId?.trim() || currentOperationContext()?.requestId;
  const receipts = run.captureReviewReceipts ?? [];
  const replay = requestId
    ? [...receipts]
        .reverse()
        .find((receipt) => receipt.captureId === item.captureId && receipt.requestId === requestId)
    : undefined;
  if (replay) {
    const requestedNote = input.note?.trim().slice(0, 2_000);
    const sameImage =
      !input.imageSha256 || !replay.imageSha256 || input.imageSha256 === replay.imageSha256;
    const sameIntent =
      replay.action === input.action &&
      sameImage &&
      (input.note === undefined || requestedNote === replay.note);
    if (!sameIntent) {
      throw new CaptureReviewError(
        "CAPTURE_REVIEW_CONFLICT",
        "This review request id was already used for a different judgement",
        "Retry with the original review request or create a new review request for an intentional revision.",
      );
    }
    return {
      captureReviews: run.captureReviews ?? [],
      captureReviewReceipts: receipts,
      queue: captureReviewQueueForRun(run),
      decision: replay,
      outcome: run.outcome,
      changed: false,
    };
  }
  const currentReviewVersion = prior?.reviewVersion ?? 0;
  if (
    input.expectedReviewVersion !== undefined &&
    input.expectedReviewVersion !== currentReviewVersion
  ) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_CONFLICT",
      "This screenshot has a newer review decision",
      "Refresh the Run and submit an intentional revision against the current review version.",
    );
  }
  const requestedNote = input.note?.trim().slice(0, 2_000);
  const sameImage =
    !input.imageSha256 || !item.imageSha256 || input.imageSha256 === item.imageSha256;
  const sameIntent =
    prior !== undefined &&
    prior.action === input.action &&
    sameImage &&
    (input.note === undefined || requestedNote === prior.note);
  if (prior && input.expectedReviewVersion === undefined && !sameIntent) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_CONFLICT",
      "An existing review can only be changed with its current review version",
      "Refresh the Run and submit the intentional revision with expectedReviewVersion set to the value shown in the captures panel.",
    );
  }
  if (prior && prior.decidedBy.id !== input.actor.id) {
    throw new CaptureReviewError(
      "CAPTURE_REVIEW_CONFLICT",
      "Another reviewer already saved a decision for this screenshot",
      "Refresh the Plan captures panel and continue with items that are still pending. Looks correct never overwrites another person's saved decision.",
    );
  }
  const note = requestedNote || prior?.note;
  if (prior && prior.action === input.action && sameImage) {
    const nextDecision = note === prior.note || !note ? prior : { ...prior, note };
    const captureReviews =
      note === prior.note
        ? (run.captureReviews ?? [])
        : (run.captureReviews ?? []).map((decision) =>
            decision.captureId === prior.captureId ? nextDecision : decision,
          );
    const captureReviewReceipts =
      requestId && !receipts.some((receipt) => receipt.requestId === requestId)
        ? [...receipts, { ...prior, requestId }]
        : receipts;
    return {
      captureReviews,
      captureReviewReceipts,
      queue: captureReviewQueueForRun({ ...run, captureReviews }),
      decision: nextDecision,
      outcome: run.outcome,
      changed: captureReviews !== run.captureReviews || captureReviewReceipts !== receipts,
    };
  }
  const decision: CaptureReviewDecision = {
    captureId: item.captureId,
    action: input.action,
    decidedAt: Date.now(),
    decidedBy: input.actor,
    ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
    ...(note ? { note } : {}),
    ...(requestId ? { requestId } : {}),
    reviewVersion: currentReviewVersion + 1,
  };
  const captureReviews = [
    ...(run.captureReviews ?? []).filter((existing) => existing.captureId !== item.captureId),
    decision,
  ];
  const captureReviewReceipts = requestId ? [...receipts, decision].slice(-256) : receipts;
  return {
    captureReviews,
    captureReviewReceipts,
    queue: captureReviewQueueForRun({ ...run, captureReviews }),
    decision,
    outcome: run.outcome,
    changed: true,
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
    requestId?: string;
    expectedReviewVersion?: number;
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
    next.captureReviewReceipts = applied.captureReviewReceipts;
    const persisted = applied.changed
      ? await persistPersistedRun(root, latest, next, "capture-review")
      : latest;
    return {
      run: persisted,
      queue: applied.queue,
      decision: applied.decision,
    };
  });
}
