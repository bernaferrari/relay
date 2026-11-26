/** Synchronous action execution: enqueue one recipe job against an admitted
 * device or browser target and optionally wait for its terminal status. The
 * wait loop answers with the full job evidence so CLI callers do not need a
 * second round trip. */
import { currentOperationContext, enqueueJob, getJob, resolveJobDevicePlatform } from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import {
  browserCaseProfileForAdmission,
  browserCaseProfileIfManaged,
  rejectBlockedClaimedBrowserJob,
} from "./claimed-browser-job-admission.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { JobRouteRuntime } from "./job-routes.js";
import type { ServerRouteInput } from "./server-route-input.js";

export async function handleActionRunRoute(
  input: ServerRouteInput & { runtime?: Partial<JobRouteRuntime> },
): Promise<boolean> {
  const { method, pathname, request, response, scope, runtime } = input;
  const runMatch = matchPath(pathname, "/actions/:id/run");
  if (method !== "POST" || !runMatch) return false;

  const body = (await parseJsonBody(request)) as {
    serial?: string;
    platform?: "android" | "ios";
    targetKind?: "device" | "browser";
    browserTargetId?: string;
    prodAccountMatch?: string;
    wait?: boolean;
  };
  const assertControl = runtime?.assertTargetControl ?? assertTargetControl;
  const enqueue = runtime?.enqueueJob ?? enqueueJob;
  const explicitBrowserId =
    body.browserTargetId?.trim() ||
    (body.targetKind === "browser" ? body.serial?.trim() : undefined);
  await assertControl(scope, explicitBrowserId ?? body.serial);
  const browserCaseProfile = explicitBrowserId
    ? await browserCaseProfileForAdmission(explicitBrowserId)
    : await browserCaseProfileIfManaged(body.serial);
  const browserTargetId = explicitBrowserId ?? (browserCaseProfile ? body.serial : undefined);
  const authenticationHealth = await rejectBlockedClaimedBrowserJob({
    projectId: scope.projectId,
    targetId: browserTargetId,
    browserCaseProfile,
  });
  const job = enqueue({
    recipe: runMatch.id!,
    ...(browserCaseProfile
      ? {
          targetKind: "browser" as const,
          browserTargetId,
          browserCaseProfile,
          ...(authenticationHealth ? { authenticationHealth } : {}),
        }
      : {
          serial: body.serial,
          platform: body.platform ?? (await resolveJobDevicePlatform(body.serial)),
        }),
    prodAccountMatch: body.prodAccountMatch,
    projectId: scope.projectId,
    ownerId: currentOperationContext()!.actorId,
  });
  if (body.wait === false) {
    json(response, 202, { job });
    return true;
  }
  for (;;) {
    const current = getJob(job.id);
    if (!current) {
      throw new HttpError(500, "Job disappeared while waiting");
    }
    if (
      current.status === "ok" ||
      current.status === "error" ||
      current.status === "healed" ||
      current.status === "cancelled"
    ) {
      json(response, 200, {
        ok: current.status === "ok" || current.status === "healed",
        action: current.action,
        result: current.result,
        error: current.error,
        healed: current.healed,
        healMessage: current.healMessage,
        cancelled: current.status === "cancelled",
        job: current,
        logs: current.logs,
      });
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
