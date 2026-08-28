import type { DeviceInfo, JobInfo } from "./api-types";
import { platformLabel, presentTarget } from "./target-presentation";

type AppMapRunIdentity = Pick<JobInfo, "action" | "artifacts">;

/** App Map execution compiles to a private recipe id. Reports must navigate
 * back to the durable map, never expose that generated recipe as a document. */
export function appMapIdForJob(job: AppMapRunIdentity): string | null {
  for (const artifact of job.artifacts ?? []) {
    if (
      (artifact.kind === "app-map-flow-plan" || artifact.kind === "app-map-test-plan") &&
      artifact.data &&
      typeof artifact.data === "object" &&
      !Array.isArray(artifact.data)
    ) {
      const appMapId = (artifact.data as { appMapId?: unknown }).appMapId;
      if (typeof appMapId === "string" && appMapId.trim()) return appMapId;
    }
  }
  return /^app-map:([^:]+):(flow|routine):/.exec(job.action)?.[1] ?? null;
}

export function testIdForJob(job: AppMapRunIdentity): string | null {
  for (const artifact of job.artifacts ?? []) {
    if (
      artifact.kind !== "app-map-test-plan" ||
      !artifact.data ||
      typeof artifact.data !== "object" ||
      Array.isArray(artifact.data)
    )
      continue;
    const plan = artifact.data as { test?: { id?: unknown }; testId?: unknown };
    const testId = plan.test?.id ?? plan.testId;
    if (typeof testId === "string" && testId.trim()) return testId;
  }
  return null;
}

export function runStopHeadline(input: {
  total: number;
  selectedIndex: number;
  failureLabel: string;
}): string {
  if (input.total <= 0) return "Run stopped before the first step";
  return `${input.failureLabel} at step ${Math.min(input.selectedIndex + 1, input.total)} of ${input.total}`;
}

/** Run history outlives attached hardware. Prefer a recorded human name, then
 * the currently discovered target name, and finally a stable platform label.
 * Raw serials remain useful diagnostic metadata but are never the primary UI. */
export function runTargetLabel(
  job: Pick<JobInfo, "platform" | "serial" | "targetProfile">,
  devices: readonly DeviceInfo[],
): string {
  const recordedName = job.targetProfile?.name?.trim();
  const targetId = job.targetProfile?.targetId;
  const discovered = devices.find(
    (device) => device.serial === job.serial || device.serial === targetId,
  );
  if (recordedName && recordedName !== job.serial && recordedName !== targetId) return recordedName;
  if (discovered) return presentTarget(discovered).displayName;
  const platform =
    job.targetProfile?.platform ??
    (job.platform === "ios" || job.platform === "browser" ? job.platform : "android");
  return platformLabel(platform);
}
