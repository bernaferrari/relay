export type LiveEventScope = {
  organizationId: string;
  projectId: string;
  subject: string;
  localTrusted: boolean;
};

export type LiveEventView = {
  organizationId: string;
  projectId: string;
  payload: { type: string; jobId?: unknown };
};

const PRIVATE_WITHOUT_JOB = new Set(["error", "screenshot.captured", "snapshot.captured"]);

/** A live event stays with its project, and an unowned error or capture stays
 * off another person's stream. A job event is visible only to that job's owner. */
export function liveEventVisible(
  event: LiveEventView,
  scope: LiveEventScope,
  jobOwner: (jobId: string) => { projectId?: string; ownerId?: string } | undefined,
): boolean {
  if (event.organizationId !== scope.organizationId || event.projectId !== scope.projectId) {
    return false;
  }
  if (scope.localTrusted) return true;
  const jobId = typeof event.payload.jobId === "string" ? event.payload.jobId : undefined;
  if (!jobId) return !PRIVATE_WITHOUT_JOB.has(event.payload.type);
  const job = jobOwner(jobId);
  return job?.projectId === scope.projectId && job?.ownerId === scope.subject;
}
