import { listJobs, toJobReport, type JobReport } from "@relay/core";
import type { RequestContext } from "./security.js";

/**
 * Projects persisted job reports through the same project/owner boundary as
 * the rest of the HTTP API. Report routes intentionally use this helper
 * rather than exposing a second, subtly different visibility filter.
 */
export function collectVisibleReports(limit: number, scope?: RequestContext): JobReport[] {
  return listJobs(Math.max(limit, 200))
    .filter(
      (job) =>
        !scope ||
        scope.localTrusted ||
        (job.projectId === scope.projectId && job.ownerId === scope.subject),
    )
    .slice(0, limit)
    .map(toJobReport);
}
