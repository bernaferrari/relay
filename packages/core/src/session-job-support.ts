import { classifyJobError } from "./report.js";
import { createDevice, type DevicePlatform } from "./device.js";
import { JobControlOwnershipError } from "./control.js";
import { isDeviceLeaseSessionActive } from "./collaboration.js";
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
    return data.status === "failed" && typeof data.title === "string"
      ? [{ title: data.title, error: typeof data.error === "string" ? data.error : "failed" }]
      : [];
  });
}
