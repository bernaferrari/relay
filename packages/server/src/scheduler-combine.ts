import type { LocalSchedule } from "@relay/core";
import { inspectManagedBrowserAuthPage, probeScheduledPlanAccountHealth } from "@relay/core";
import { executeCombineStart } from "./combine-start-route.js";
import { defaultJobRouteRuntime } from "./job-routes.js";
import { defaultSchedulerRuntime, runDueSchedules } from "./scheduler.js";
import type { RequestContext } from "./security.js";

function schedulerScope(projectId: string): RequestContext {
  return {
    subject: "system:scheduler",
    organizationId: "local",
    projectId,
    allowedProjects: [projectId],
    tokenKind: "local",
    localTrusted: true,
    role: "admin",
  };
}

export function scheduledCombineStartInput(schedule: LocalSchedule): {
  appMapId: string;
  combineId: string;
  executionMode: "all";
  profileTargets?: LocalSchedule["profileTargets"];
  targetKind?: "browser" | "device";
  browserTargetId?: string;
  serial?: string;
  platform?: "android" | "ios";
} {
  const combineId = schedule.combineId?.trim();
  const appMapId = schedule.appMapId?.trim();
  if (!combineId || !appMapId) throw new Error("A Plan schedule requires combineId and appMapId");
  if (schedule.profileTargets?.length) {
    const first = schedule.profileTargets[0]!.target;
    return {
      appMapId,
      combineId,
      executionMode: "all",
      profileTargets: schedule.profileTargets,
      ...(first.targetKind === "browser" || first.browserTargetId
        ? {
            targetKind: "browser" as const,
            browserTargetId: first.browserTargetId ?? schedule.targetId,
          }
        : {
            targetKind: "device" as const,
            serial: first.serial ?? schedule.targetId,
            platform: first.platform === "ios" ? ("ios" as const) : ("android" as const),
          }),
    };
  }
  return {
    appMapId,
    combineId,
    executionMode: "all",
    ...(schedule.targetKind === "browser"
      ? { targetKind: "browser" as const, browserTargetId: schedule.targetId }
      : {
          targetKind: "device" as const,
          serial: schedule.targetId,
          platform: schedule.platform === "ios" ? ("ios" as const) : ("android" as const),
        }),
  };
}

export async function startScheduledCombine(
  schedule: LocalSchedule,
  inspectPage?: (
    url: string,
    context: { targetId: string; reference: string },
  ) => Promise<{ title: string; bodyText: string }>,
): Promise<void> {
  await probeScheduledPlanAccountHealth({
    projectId: schedule.projectId,
    fallbackTargetId: schedule.targetId,
    profileTargets: schedule.profileTargets,
    inspectPage:
      inspectPage ??
      ((url, context) =>
        inspectManagedBrowserAuthPage({
          targetId: context.targetId,
          projectId: schedule.projectId,
          reference: context.reference,
          url,
        })),
  });
  await executeCombineStart(
    schedulerScope(schedule.projectId),
    defaultJobRouteRuntime,
    scheduledCombineStartInput(schedule),
  );
}

export function runDueSchedulesWithCombineStarter(): Promise<void> {
  return runDueSchedules(Date.now(), {
    ...defaultSchedulerRuntime,
    startCombine: startScheduledCombine,
  });
}
