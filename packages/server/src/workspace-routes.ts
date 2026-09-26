import type http from "node:http";
import {
  authoringSessions,
  deleteSchedule,
  listAppMaps,
  listLanes,
  listSchedules,
  readAuthoringEvidence,
  removeLane,
  saveLane,
  saveSchedule,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

type WorkspaceRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

const sessionHistoryInFlight = new Map<string, ReturnType<typeof authoringSessions.list>>();

/** One session-history read shared by requests that arrive together; never cached after. */
function sessionHistory(projectId: string): ReturnType<typeof authoringSessions.list> {
  let pending = sessionHistoryInFlight.get(projectId);
  if (!pending) {
    pending = authoringSessions
      .list(projectId, { includeHistory: true })
      .finally(() => sessionHistoryInFlight.delete(projectId));
    sessionHistoryInFlight.set(projectId, pending);
  }
  return pending;
}

/** Routes for project-owned schedules and immutable authoring evidence.
 * Compiled execution plans intentionally have no public storage route. */

export async function handleWorkspaceRoute(input: WorkspaceRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;
  if (method === "GET" && pathname === "/lanes") {
    json(response, 200, { lanes: await listLanes(scope.projectId) });
    return true;
  }
  if (method === "POST" && pathname === "/lanes") {
    const body = (await parseJsonBody(request)) as Parameters<typeof saveLane>[0];
    try {
      json(response, 201, {
        lane: await saveLane({ ...body, projectId: scope.projectId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/was not found/u.test(message)) throw new HttpError(404, message);
      if (/must not persist|unique runtime profile/u.test(message)) {
        throw new HttpError(409, message);
      }
      throw new HttpError(400, message);
    }
    return true;
  }
  const laneMatch = matchPath(pathname, "/lanes/:laneId");
  if (method === "DELETE" && laneMatch) {
    const removed = await removeLane(scope.projectId, laneMatch.laneId!);
    if (!removed) throw new HttpError(404, "Lane not found");
    json(response, 200, { ok: true });
    return true;
  }
  if (method === "GET" && pathname === "/schedules") {
    json(response, 200, {
      schedules: await listSchedules(
        scope.localTrusted ? undefined : { projectId: scope.projectId },
      ),
    });
    return true;
  }
  if (method === "POST" && pathname === "/schedules") {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Schedules can only be changed from a local Relay host");
    }
    try {
      const body = (await parseJsonBody(request)) as Parameters<typeof saveSchedule>[0];
      await assertTargetControl(scope, body.targetId);
      json(response, 201, {
        schedule: await saveSchedule({ ...body, projectId: scope.projectId }),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }
  const scheduleMatch = matchPath(pathname, "/schedules/:id");
  if (method === "DELETE" && scheduleMatch) {
    if (!scope.localTrusted) {
      throw new HttpError(403, "Schedules can only be changed from a local Relay host");
    }
    const removed = await deleteSchedule(scheduleMatch.id!, { projectId: scope.projectId });
    if (!removed) throw new HttpError(404, "Schedule not found");
    json(response, 200, { ok: true });
    return true;
  }

  const authoringEvidenceMatch = matchPath(pathname, "/authoring-evidence/:sha256");
  if (method === "GET" && authoringEvidenceMatch) {
    const sha256 = authoringEvidenceMatch.sha256!;
    const uri = `relay-evidence://${sha256}`;
    // App Map screens are the common case and cheap to check; session history
    // can be tens of megabytes, so concurrent image requests share one load.
    const permitted =
      (await listAppMaps(scope.projectId)).some((appMap) =>
        Object.values(appMap.screenVariants).some(
          (variant) =>
            variant.screenshotUri === uri || variant.evidenceUris?.includes(uri) === true,
        ),
      ) ||
      (await sessionHistory(scope.projectId)).some(
        (session) =>
          session.take?.revisions.some((revision) =>
            revision.evidence.some((evidence) => evidence.uri === uri),
          ) ||
          session.take?.replayAttempts.some((attempt) =>
            attempt.evidence.some((evidence) => evidence.uri === uri),
          ),
      );
    if (!permitted) throw new HttpError(404, "Authoring evidence not found");
    const artifact = await readAuthoringEvidence(sha256);
    if (!artifact) throw new HttpError(404, "Authoring evidence not found");
    const requestedMime = url.searchParams.get("mime") ?? "";
    const contentType = requestedMime.startsWith("video/")
      ? requestedMime
      : requestedMime === "application/json"
        ? requestedMime
        : "image/png";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": artifact.byteLength,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...CORS_HEADERS,
    });
    response.end(artifact);
    return true;
  }

  return false;
}
