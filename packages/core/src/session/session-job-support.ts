import { classifyJobError } from "../run/report.js";
import { now, publish } from "../collaboration/events.js";
import { finishStep } from "./session-trace-steps.js";
import { setOutcome } from "./session-job-projection.js";
import type { TraceStep } from "../trace/trace.js";
import {
  acquireUnsignedBrowserOverlap,
  unsignedBrowserOverlapAdmissionForJob,
} from "../browser/browser-unsigned-overlap.js";
import { createDevice, type DevicePlatform } from "../device/device.js";
import { JobControlOwnershipError } from "../execution/control.js";
import { isDeviceLeaseSessionActive } from "../collaboration/collaboration.js";
import type { JobErrorCode, TestJob } from "./session-contract.js";

export function classifySessionError(message: string): JobErrorCode {
  return classifyJobError(message) as JobErrorCode;
}

/** Discover device metadata without importing workspace and creating a session cycle. */
export async function resolveSessionDeviceMeta(
  serial?: string,
  platform?: DevicePlatform,
): Promise<{ deviceName?: string; deviceAvailable?: boolean; physicalIos?: boolean }> {
  if (!serial) return {};
  try {
    const devices = await createDevice().devices.list();
    const match = devices.find((device) => {
      const identity =
        device.android?.serial ??
        device.ios?.udid ??
        device.identifiers?.serial ??
        device.identifiers?.udid ??
        device.id;
      return identity === serial || device.id === serial;
    });
    return {
      deviceName: match?.name,
      deviceAvailable: Boolean(match),
      physicalIos:
        platform === "ios" && Boolean(match) && !/simulator|emulator/i.test(String(match?.kind)),
    };
  } catch {
    return {};
  }
}

export function createJobLeaseValidator(job: TestJob): (() => Promise<void>) | undefined {
  const context = job.operationContext;
  if (job.targetContext.kind !== "device" || !context?.leaseId) return undefined;
  if (
    !context.projectId ||
    !context.actorId ||
    (job.projectId !== undefined && job.projectId !== context.projectId) ||
    (job.ownerId !== undefined && job.ownerId !== context.actorId)
  ) {
    return async () => {
      throw new JobControlOwnershipError();
    };
  }
  return async () => {
    const active = await isDeviceLeaseSessionActive({
      organizationId: context.organizationId,
      projectId: context.projectId,
      deviceSerial: job.targetContext.kind === "device" ? job.targetContext.serial : "",
      leaseOwnerId: context.leaseOwnerId ?? context.actorId,
      leaseId: context.leaseId!,
    }).catch(() => false);
    if (!active) throw new JobControlOwnershipError();
  };
}

export function failedCampaignChecks(job: TestJob): Array<{ title: string; error: string }> {
  return job.artifacts.flatMap((artifact) => {
    if (
      artifact.kind !== "campaign-check-result" ||
      !artifact.data ||
      typeof artifact.data !== "object"
    ) {
      return [];
    }
    const data = artifact.data as Record<string, unknown>;
    return (data.status === "failed" || data.status === "blocked") && typeof data.title === "string"
      ? [{ title: data.title, error: typeof data.error === "string" ? data.error : "failed" }]
      : [];
  });
}

/** Terminal cancellation bookkeeping shared by every cancellation path. */
export function finalizeCancelledJob(job: TestJob, primary?: TraceStep): void {
  job.finishedAt = now();
  job.status = "cancelled";
  job.error = "Cancelled by user";
  job.errorCode = "CANCELLED";
  setOutcome(job);
  if (primary) finishStep(primary, "error", "✗ cancelled");
  publish({
    type: "job.cancelled",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
  });
  publish({
    type: "job.finished",
    at: job.finishedAt,
    jobId: job.id,
    action: job.action,
    ok: false,
    error: job.error,
    durationMs: job.finishedAt - (job.startedAt ?? job.queuedAt),
    cancelled: true,
  });
}

/** Unsigned browser runs share no Playwright state, but the application
 * backend behind one managed target is still a shared surface. Independent
 * runs are readers and fan out; fail-closed and unclassified work stays the
 * exclusive writer it was when one shared lane serialized it. */
export async function acquireSessionUnsignedBrowserOverlap(
  job: TestJob,
  pushLog: (line: string) => void,
): Promise<(() => void) | undefined> {
  const admission = unsignedBrowserOverlapAdmissionForJob(job);
  if (!admission) return undefined;
  const waitStartedAt = now();
  const release = await acquireUnsignedBrowserOverlap({ ...admission, jobId: job.id });
  const waitedMs = now() - waitStartedAt;
  if (waitedMs >= 20) pushLog(`overlap: waited ${waitedMs} ms for unsigned browser admission`);
  return release;
}
