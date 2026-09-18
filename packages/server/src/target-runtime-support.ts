import {
  currentOperationContext,
  executionTargetRefFromTargetContext,
  managedBrowserTargetIdFromSchedulingKey,
} from "@relay/core";
import type {
  LocalAgentDeviceExecutionTargetRef,
  LocalBrowserExecutionTargetRef,
  TargetSupervisorHealth,
} from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import { captureDurableTargetObservation } from "./target-observation-route.js";
import type {
  SupervisedRuntimePlatform,
  TargetRuntimeRouteRuntime,
} from "./target-runtime-routes.js";

export function requestedRecoveryFenceAssignmentId(body: {
  recoveryFenceAssignmentId?: unknown;
}): string | undefined {
  if (body.recoveryFenceAssignmentId === undefined) return undefined;
  if (
    typeof body.recoveryFenceAssignmentId !== "string" ||
    !body.recoveryFenceAssignmentId.trim() ||
    body.recoveryFenceAssignmentId.trim().length > 256
  ) {
    throw new HttpError(400, "recoveryFenceAssignmentId must be a non-empty identifier");
  }
  return body.recoveryFenceAssignmentId.trim();
}

export function localBrowserExecutionTarget(targetId: string): LocalBrowserExecutionTargetRef {
  const target = executionTargetRefFromTargetContext({
    kind: "browser",
    platform: "browser",
    targetId,
  });
  if (target.kind !== "local-browser") {
    throw new Error("Local target recovery did not resolve a managed browser identity");
  }
  return target;
}

export function localDeviceExecutionTarget(
  serial: string,
  platform: "android" | "ios",
): LocalAgentDeviceExecutionTargetRef {
  const target = executionTargetRefFromTargetContext({ kind: "device", platform, serial });
  if (target.kind !== "local-device") {
    throw new Error("Local target recovery did not resolve a local device identity");
  }
  return target;
}

export function recordRecoveryFenceAudit(
  scope: RequestContext,
  input: { assignmentId: string; serial: string; result: "allow" | "deny" },
): void {
  const operation = currentOperationContext();
  recordAudit(scope, {
    action: "target.recovery-fence.release",
    resource: input.assignmentId,
    target: input.serial,
    result: input.result,
    ...(operation ? { actorId: operation.actorId } : {}),
  });
}

export function publicTargetHealth(health: TargetSupervisorHealth): TargetSupervisorHealth {
  return {
    ...health,
    visibility: "public",
    pixels: {
      state: health.pixels.state,
      ...(health.pixels.lastCapturedAt !== undefined
        ? { lastCapturedAt: health.pixels.lastCapturedAt }
        : {}),
    },
    semantics: {
      state: health.semantics.state,
      ...(health.semantics.lastCapturedAt !== undefined
        ? { lastCapturedAt: health.semantics.lastCapturedAt }
        : {}),
    },
    input: { state: health.input.state },
    control: { state: health.control.state },
    context: {},
    events: [],
  };
}

export function durableObservationId(
  observation: Awaited<ReturnType<typeof captureDurableTargetObservation>>,
): string {
  const projections = [
    observation.pixels.status === "captured" ? observation.pixels.artifact : undefined,
    observation.semantics.artifact,
  ];
  for (const projection of projections) {
    if (projection?.status === "available") return projection.artifact.id;
  }
  throw new HttpError(409, "Target input reconciliation requires durable observation evidence", {
    code: "TARGET_INPUT_RECONCILIATION_EVIDENCE_UNAVAILABLE",
  });
}

export async function resolveSupervisedRuntimeTarget(input: {
  serial: string;
  runtime: Pick<TargetRuntimeRouteRuntime, "listDevices" | "listTargets">;
}): Promise<{ id: string; platform: SupervisedRuntimePlatform }> {
  const device = (await input.runtime.listDevices().catch(() => [])).find(
    (candidate) => candidate.serial === input.serial,
  );
  if (device && (device.platform === "android" || device.platform === "ios")) {
    return { id: device.serial, platform: device.platform };
  }
  const managedId = managedBrowserTargetIdFromSchedulingKey(input.serial);
  const browser = (await input.runtime.listTargets().catch(() => [])).find(
    (candidate) =>
      candidate.kind === "browser" && (candidate.id === input.serial || candidate.id === managedId),
  );
  if (browser) return { id: managedId ? input.serial : browser.id, platform: "browser" };
  throw new HttpError(404, `Target ${input.serial} is not connected`);
}

export async function scopedTargetHealth(input: {
  scope: RequestContext;
  serial: string;
  runtime: TargetRuntimeRouteRuntime;
}): Promise<TargetSupervisorHealth> {
  const at = input.runtime.now();
  const projectSharesTarget = (await input.runtime.listDeviceLeases(input.scope.projectId)).some(
    (lease) =>
      lease.organizationId === input.scope.organizationId &&
      lease.deviceSerial === input.serial &&
      lease.status === "leased" &&
      lease.expiresAt > at,
  );
  if (!projectSharesTarget && !input.scope.localTrusted) {
    recordAudit(input.scope, {
      action: "target.health.read",
      resource: "target",
      target: input.serial,
      result: "deny",
    });
    throw new HttpError(404, "Target not found");
  }
  const resolved = await resolveSupervisedRuntimeTarget({
    serial: input.serial,
    runtime: input.runtime,
  });
  const health = input.runtime.readTargetHealth(resolved.id, resolved.platform);
  recordAudit(input.scope, {
    action: "target.health.read",
    resource: "target",
    target: input.serial,
    result: "allow",
  });
  return projectSharesTarget ? { ...health, visibility: "project" } : publicTargetHealth(health);
}
