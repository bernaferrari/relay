import type http from "node:http";
import { clearPresence, listPresence, upsertPresence } from "@relay/core";
import type { ActorKind, CollaborationActivity } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

type PresenceRouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handlePresenceRoute(input: PresenceRouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  if (method === "GET" && pathname === "/presence") {
    json(response, 200, { actors: listPresence(scope.projectId) });
    return true;
  }

  if (method === "POST" && pathname === "/presence") {
    const body = (await parseJsonBody(request)) as {
      actorId?: string;
      actorKind?: ActorKind;
      activity?: CollaborationActivity;
      displayName?: string;
      cursor?: { x: number; y: number };
      selection?: { screenId?: string; connectionId?: string };
      viewport?: { x: number; y: number; zoom: number; width: number; height: number };
      ttlMs?: number;
    };
    const actorId = body.actorId?.trim() || scope.subject;
    const actorKind = body.actorKind ?? (scope.localTrusted ? "human" : "agent");
    const activity = body.activity ?? "idle";
    if (
      activity !== "editing" &&
      activity !== "recording" &&
      activity !== "running" &&
      activity !== "idle"
    ) {
      throw new HttpError(400, "activity must be editing, recording, running, or idle");
    }
    try {
      const actor = upsertPresence({
        projectId: scope.projectId,
        actorId,
        actorKind,
        activity,
        ...(body.displayName ? { displayName: body.displayName } : {}),
        ...(body.cursor ? { cursor: body.cursor } : {}),
        ...(body.selection ? { selection: body.selection } : {}),
        ...(body.viewport ? { viewport: body.viewport } : {}),
        ...(typeof body.ttlMs === "number" ? { ttlMs: body.ttlMs } : {}),
      });
      json(response, 200, { actor });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const clearMatch = matchPath(pathname, "/presence/:actorId");
  if (method === "DELETE" && clearMatch) {
    clearPresence(scope.projectId, clearMatch.actorId!);
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}
