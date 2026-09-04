import {
  parseAppMapTestTupleIdentity,
  sameAppMapTestTupleIdentity,
  type JobSummary,
  type TargetProfile,
  type TraceFrameDto,
} from "@relay/protocol";

/** The durable subset required to select a reviewed visual baseline. */
export type RepeatCaptureJob = Pick<
  JobSummary,
  "id" | "batchId" | "queuedAt" | "startedAt" | "finishedAt" | "matrixCase" | "review"
> & {
  serial?: string;
  targetProfile?: TargetProfile;
  frames?: readonly TraceFrameDto[];
};

export type PreviousApprovedRepeatCapture<Job extends RepeatCaptureJob = RepeatCaptureJob> = {
  job: Job;
  capture: TraceFrameDto;
};

function targetIdentity(job: RepeatCaptureJob): string | undefined {
  if (job.targetProfile) {
    return JSON.stringify([job.targetProfile.platform, job.targetProfile.targetId]);
  }
  return job.serial?.trim() || undefined;
}

function caseIdentity(job: RepeatCaptureJob) {
  return parseAppMapTestTupleIdentity(job.matrixCase);
}

function authoredFrames(job: RepeatCaptureJob): readonly TraceFrameDto[] {
  const requested = (job.frames ?? []).filter((frame) =>
    /^(screen|tour|final):/u.test(frame.caption),
  );
  return requested.length ? requested : (job.frames ?? []);
}

function checkpointName(caption: string): string {
  return caption.replace(/^(screen|tour|final):/u, "").trim();
}

/**
 * Select only a human-approved capture for the exact App Map, Test, values,
 * target, and checkpoint. Similar Runs are not silently promoted to a visual
 * baseline.
 */
export function findPreviousApprovedRepeatCapture<Job extends RepeatCaptureJob>(
  history: readonly Job[],
  current: Job,
  checkpoint: string,
): PreviousApprovedRepeatCapture<Job> | null {
  const currentAt = current.finishedAt ?? current.startedAt ?? current.queuedAt;
  const currentTarget = targetIdentity(current);
  const currentCase = caseIdentity(current);
  if (!currentTarget || !currentCase) return null;
  const candidate = history
    .filter((job) => {
      const candidateCase = caseIdentity(job);
      return (
        job.id !== current.id &&
        job.batchId !== current.batchId &&
        Boolean(candidateCase) &&
        sameAppMapTestTupleIdentity(candidateCase!, currentCase) &&
        job.review?.status === "approved" &&
        job.review.capability === "visual-baseline" &&
        targetIdentity(job) === currentTarget &&
        (job.finishedAt ?? job.startedAt ?? job.queuedAt) < currentAt
      );
    })
    .sort(
      (left, right) =>
        (right.finishedAt ?? right.startedAt ?? right.queuedAt) -
        (left.finishedAt ?? left.startedAt ?? left.queuedAt),
    )
    .find((job) =>
      authoredFrames(job).some((frame) => checkpointName(frame.caption) === checkpoint),
    );
  if (!candidate) return null;
  const capture = authoredFrames(candidate).find(
    (frame) => checkpointName(frame.caption) === checkpoint,
  );
  return capture ? { job: candidate, capture } : null;
}
