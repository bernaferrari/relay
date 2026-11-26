/** Liveness routes: health, event stream, and connected-target inventory.
 * Health must answer within Electron's short startup timeout, so device
 * discovery stays on /devices and health reports the last completed count
 * through the shared liveness state instead of blocking on adb/simctl. */
import {
  getActiveJobs,
  getJob,
  listConnectedTargets,
  listJobs,
  listTargetWorkers,
  now,
  runsRoot,
} from "@relay/core";
import { scopedActiveJob } from "./job-routes.js";
import { liveEventVisible } from "./live/live-event-scope.js";
import { PRODUCT_VERSION } from "./server-meta.js";
import { json } from "./http.js";
import type { createSseHub } from "./sse.js";
import type { ServerRouteInput } from "./server-route-input.js";

/** Mutable liveness state shared across requests: /devices refreshes the
 * physical-device count that /health reports without re-running discovery. */
export type ServerLivenessState = {
  serverStartedAt: number;
  lastKnownDeviceCount: number | null;
};

export async function handleServerLivenessRoute(
  input: ServerRouteInput & {
    sse: ReturnType<typeof createSseHub>;
    liveness: ServerLivenessState;
  },
): Promise<boolean> {
  const { method, pathname, url, request, response, scope, sse, liveness } = input;

  if (method === "GET" && pathname === "/health") {
    const visibleActiveJobs = getActiveJobs().filter(
      (job) =>
        scope.localTrusted || (job.projectId === scope.projectId && job.ownerId === scope.subject),
    );
    const active = scopedActiveJob(visibleActiveJobs, scope);
    const visibleJobCount = scope.localTrusted
      ? listJobs(50).length
      : listJobs(50).filter(
          (job) => job.projectId === scope.projectId && job.ownerId === scope.subject,
        ).length;
    json(response, 200, {
      ok: true,
      product: "relay",
      version: PRODUCT_VERSION,
      mode: "app-testing",
      pid: process.pid,
      startedAt: liveness.serverStartedAt,
      at: now(),
      uptimeMs: now() - liveness.serverStartedAt,
      activeJob: active
        ? {
            id: active.id,
            action: active.action,
            status: active.status,
            serial: active.serial ?? null,
            deviceName: active.deviceName ?? null,
            startedAt: active.startedAt ?? null,
          }
        : null,
      activeJobs: visibleActiveJobs.map((job) => ({
        id: job.id,
        status: job.status,
        targetId: job.browserTargetId ?? job.serial,
        workerId: job.workerId,
      })),
      targetWorkers: listTargetWorkers(),
      jobs: visibleJobCount,
      deviceCount: liveness.lastKnownDeviceCount,
      sseClients: sse.count(),
      runsDir: scope.localTrusted ? runsRoot() : "runs",
      access: {
        role: scope.role,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
      },
    });
    return true;
  }

  if (method === "GET" && pathname === "/events") {
    sse.attach(request, response, (event) =>
      liveEventVisible(event, scope, (jobId) => {
        const job = getJob(jobId);
        return job ? { projectId: job.projectId, ownerId: job.ownerId } : undefined;
      }),
    );
    return true;
  }

  if (method === "GET" && pathname === "/devices") {
    const phase = url.searchParams.get("phase");
    const targetKind = url.searchParams.get("targetKind");
    const targetId = url.searchParams.get("targetId")?.trim();
    const { devices, physicalDeviceCount } = await listConnectedTargets({
      ...(phase === "android" || phase === "ios" ? { phase } : {}),
      ...(targetKind === "browser" || targetKind === "device" ? { targetKind } : {}),
      ...(targetId ? { targetId } : {}),
    });
    if (physicalDeviceCount !== undefined) liveness.lastKnownDeviceCount = physicalDeviceCount;
    json(response, 200, { devices });
    return true;
  }

  return false;
}
