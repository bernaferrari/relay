import type { JobInfo } from "./api-types";

/** App Map execution compiles to a private recipe id. Reports must navigate
 * back to the durable map, never expose that generated recipe as a document. */
export function appMapIdForJob(job: JobInfo): string | null {
  const plan = job.artifacts?.find((artifact) => artifact.kind === "app-map-flow-plan")?.data;
  if (plan && typeof plan === "object" && !Array.isArray(plan)) {
    const appMapId = (plan as { appMapId?: unknown }).appMapId;
    if (typeof appMapId === "string" && appMapId.trim()) return appMapId;
  }
  return /^app-map:([^:]+):(flow|routine):/.exec(job.action)?.[1] ?? null;
}

export function runStopHeadline(input: {
  total: number;
  selectedIndex: number;
  failureLabel: string;
}): string {
  if (input.total <= 0) return "Run stopped before the first step";
  return `${input.failureLabel} at step ${Math.min(input.selectedIndex + 1, input.total)} of ${input.total}`;
}
