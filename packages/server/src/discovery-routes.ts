import type http from "node:http";
import {
  buildDiscoveryCoverage,
  buildExplorationTimeline,
  buildTargetProfiles,
  cancelDiscoveryExplore,
  createDiscoverySession,
  formatDiscoveryExport,
  IosMutationOutcomeUnknownError,
  listDevices,
  listDiscoverySessions,
  listTargets,
  promoteDiscoveryPath,
  readDiscoveryScreenAsset,
  readDiscoverySession,
  renameDiscoverySession,
  runDiscoveryCapture,
  runDiscoveryDo,
  runDiscoveryHere,
  runDiscoveryInteract,
  setDiscoveryStatus,
  startDiscoveryExplore,
  suggestDiscoveryControl,
  type InteractInput,
} from "@relay/core";
import type {
  DiscoveryAgentContext,
  DiscoveryDecisionProvenance,
  DiscoveryScope,
  DiscoverySession,
  DiscoveryStatus,
} from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, text } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import type { RequestContext } from "./security.js";

type DiscoveryRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function projectFilter(scope: RequestContext): { projectId: string } | undefined {
  return scope.localTrusted ? undefined : { projectId: scope.projectId };
}

async function loadScopedSession(id: string, scope: RequestContext) {
  const session = await readDiscoverySession(id, projectFilter(scope));
  if (!session) throw new HttpError(404, "Discovery session not found");
  return session;
}

/**
 * A Discovery interaction captures its pre-action screen before it sends a
 * physical command. If iOS cannot prove that command's outcome, that existing
 * observation is the only state we can honestly call proven. Do not turn it
 * into a claim about the current device; instead give callers an explicit,
 * reviewable capture action before they choose any follow-up.
 */
export function discoveryOutcomeUnknownReview(
  session: Pick<DiscoverySession, "id" | "currentScreenId" | "screens">,
): {
  sessionId: string;
  sessionHref: string;
  lastProvenScreen?: {
    id: string;
    capturedAt: number;
    screenshotHref?: string;
  };
  captureCurrent: { method: "POST"; href: string };
} {
  const sessionHref = `/discovery/${encodeURIComponent(session.id)}`;
  const current = session.currentScreenId
    ? session.screens.find((screen) => screen.id === session.currentScreenId)
    : undefined;
  return {
    sessionId: session.id,
    sessionHref,
    ...(current
      ? {
          lastProvenScreen: {
            id: current.id,
            capturedAt: current.capturedAt,
            ...(current.screenshotPath
              ? {
                  screenshotHref: `${sessionHref}/screens/${encodeURIComponent(current.id)}`,
                }
              : {}),
          },
        }
      : {}),
    // This is deliberately a pointer, not an implicit request from an error
    // handler. Fresh pixels are evidence for a person/agent to review before
    // deciding whether any new action is safe.
    captureCurrent: { method: "POST", href: `${sessionHref}/capture` },
  };
}

/** Keep Discovery's policy errors intact while giving an uncertain iOS action
 * the same canonical one-command diagnostic used by /interact. */
export function discoveryInteractionHttpError(
  error: unknown,
  session: Pick<DiscoverySession, "id" | "currentScreenId" | "screens">,
): HttpError {
  if (error instanceof IosMutationOutcomeUnknownError) {
    return iosMutationOutcomeUnknownHttpError(error, {
      discoveryReview: discoveryOutcomeUnknownReview(session),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/blocks sensitive/.test(message)) return new HttpError(403, message);
  return new HttpError(409, message);
}

async function latestSessionForOutcomeReview(
  session: DiscoverySession,
  scope: RequestContext,
): Promise<DiscoverySession> {
  // runDiscoveryInteract may have persisted the before screen after the route
  // loaded its session. Re-read only after the stopped one-command outcome so
  // review points at that durable evidence, never at a guessed after state.
  return (
    (await readDiscoverySession(session.id, projectFilter(scope)).catch(() => undefined)) ?? session
  );
}

export async function handleDiscoveryRoute(input: DiscoveryRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;

  if (method === "GET" && pathname === "/discovery") {
    json(response, 200, { sessions: await listDiscoverySessions(projectFilter(scope)) });
    return true;
  }

  if (method === "POST" && pathname === "/discovery") {
    const body = (await parseJsonBody(request)) as {
      name?: string;
      targetId?: string;
      scope?: DiscoveryScope;
      agent?: Omit<DiscoveryAgentContext, "createdBy">;
    };
    if (!body.name || !body.targetId) throw new HttpError(400, "name and targetId are required");
    const profiles = buildTargetProfiles({
      devices: await listDevices().catch(() => []),
      targets: await listTargets(),
    });
    const session = await createDiscoverySession({
      name: body.name,
      targetId: body.targetId,
      targetProfile: profiles.find((profile) => profile.targetId === body.targetId),
      scope: body.scope,
      agent: body.agent,
      projectId: scope.projectId,
      organizationId: scope.organizationId,
    });
    json(response, 201, { session });
    return true;
  }

  const discoveryRenameMatch = matchPath(pathname, "/discovery/:id/name");
  if (method === "POST" && discoveryRenameMatch) {
    const body = (await parseJsonBody(request)) as { name?: string };
    if (!body.name?.trim()) throw new HttpError(400, "name is required");
    await loadScopedSession(discoveryRenameMatch.id!, scope);
    json(response, 200, {
      session: await renameDiscoverySession(discoveryRenameMatch.id!, body.name),
    });
    return true;
  }

  const discoveryMatch = matchPath(pathname, "/discovery/:id");
  if (method === "GET" && discoveryMatch) {
    const session = await loadScopedSession(discoveryMatch.id!, scope);
    json(response, 200, { session });
    return true;
  }

  const discoveryStatusMatch = matchPath(pathname, "/discovery/:id/status");
  if (method === "POST" && discoveryStatusMatch) {
    const body = (await parseJsonBody(request)) as {
      status?: DiscoveryStatus;
    };
    if (!body.status) throw new HttpError(400, "status is required");
    await loadScopedSession(discoveryStatusMatch.id!, scope);
    json(response, 200, {
      session: await setDiscoveryStatus(discoveryStatusMatch.id!, body.status),
    });
    return true;
  }

  const discoveryStartMatch = matchPath(pathname, "/discovery/:id/start");
  if (method === "POST" && discoveryStartMatch) {
    const session = await loadScopedSession(discoveryStartMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    json(response, 202, { session: await startDiscoveryExplore(session.id) });
    return true;
  }

  const discoveryCancelMatch = matchPath(pathname, "/discovery/:id/cancel");
  if (method === "POST" && discoveryCancelMatch) {
    await loadScopedSession(discoveryCancelMatch.id!, scope);
    json(response, 200, { session: await cancelDiscoveryExplore(discoveryCancelMatch.id!) });
    return true;
  }

  const discoverySuggestionMatch = matchPath(pathname, "/discovery/:id/suggestion");
  if (method === "GET" && discoverySuggestionMatch) {
    const session = await loadScopedSession(discoverySuggestionMatch.id!, scope);
    json(response, 200, { suggestion: suggestDiscoveryControl(session) });
    return true;
  }

  const discoveryHereMatch = matchPath(pathname, "/discovery/:id/here");
  if (method === "POST" && discoveryHereMatch) {
    const session = await loadScopedSession(discoveryHereMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    if (session.status !== "running" && session.status !== "draft") {
      throw new HttpError(409, "Start or resume this Discovery Map before asking where you are");
    }
    try {
      json(response, 200, { here: await runDiscoveryHere(session.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(409, message);
    }
    return true;
  }

  const discoveryDoMatch = matchPath(pathname, "/discovery/:id/do");
  if (method === "POST" && discoveryDoMatch) {
    const session = await loadScopedSession(discoveryDoMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    if (session.status !== "running") {
      throw new HttpError(409, "Start or resume this Discovery Map before interacting");
    }
    const body = (await parseJsonBody(request)) as {
      controlId?: string;
      interaction?: InteractInput;
      kind?: InteractInput["kind"];
      decision?: DiscoveryDecisionProvenance;
      serial?: string;
    };
    const interaction =
      body.interaction ?? (body.kind ? ({ ...body } as InteractInput) : undefined);
    try {
      const result = await runDiscoveryDo({
        sessionId: session.id,
        ...(body.controlId ? { controlId: body.controlId } : {}),
        ...(interaction ? { interaction } : {}),
        ...(body.decision ? { decision: body.decision } : {}),
      });
      json(response, 201, result);
    } catch (error) {
      const reviewSession =
        error instanceof IosMutationOutcomeUnknownError
          ? await latestSessionForOutcomeReview(session, scope)
          : session;
      throw discoveryInteractionHttpError(error, reviewSession);
    }
    return true;
  }

  const discoveryCoverageMatch = matchPath(pathname, "/discovery/:id/coverage");
  if (method === "GET" && discoveryCoverageMatch) {
    const session = await loadScopedSession(discoveryCoverageMatch.id!, scope);
    json(response, 200, {
      coverage: buildDiscoveryCoverage(session, await listDiscoverySessions(projectFilter(scope))),
    });
    return true;
  }

  const explorationTimelineMatch = matchPath(pathname, "/discovery/:id/exploration-timeline");
  if (method === "GET" && explorationTimelineMatch) {
    const session = await loadScopedSession(explorationTimelineMatch.id!, scope);
    json(response, 200, { explorationTimeline: buildExplorationTimeline(session) });
    return true;
  }

  const discoveryCaptureMatch = matchPath(pathname, "/discovery/:id/capture");
  if (method === "POST" && discoveryCaptureMatch) {
    const session = await loadScopedSession(discoveryCaptureMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    const captured = await runDiscoveryCapture(session.id);
    const latest = await readDiscoverySession(session.id);
    json(response, 201, {
      screen: captured.screen,
      isNew: captured.isNew,
      session: latest ?? session,
    });
    return true;
  }

  const discoveryInteractMatch = matchPath(pathname, "/discovery/:id/interact");
  if (method === "POST" && discoveryInteractMatch) {
    const session = await loadScopedSession(discoveryInteractMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    if (session.status !== "running") {
      throw new HttpError(409, "Start or resume this Discovery Map before interacting");
    }
    const body = (await parseJsonBody(request)) as InteractInput & {
      serial?: string;
      decision?: DiscoveryDecisionProvenance;
    };
    if (!body || typeof body !== "object" || !("kind" in body)) {
      throw new HttpError(400, "body.kind required for Discovery Map interaction");
    }
    const { serial: _serial, decision, ...raw } = body;
    try {
      const result = await runDiscoveryInteract({
        sessionId: session.id,
        interaction: raw as InteractInput,
        ...(decision ? { decision } : {}),
      });
      json(response, 201, {
        transition: result.transition,
        before: result.before,
        after: result.after,
      });
    } catch (error) {
      const reviewSession =
        error instanceof IosMutationOutcomeUnknownError
          ? await latestSessionForOutcomeReview(session, scope)
          : session;
      throw discoveryInteractionHttpError(error, reviewSession);
    }
    return true;
  }

  const discoveryScreenMatch = matchPath(pathname, "/discovery/:id/screens/:screenId");
  if (method === "GET" && discoveryScreenMatch) {
    await loadScopedSession(discoveryScreenMatch.id!, scope);
    const asset = await readDiscoveryScreenAsset(
      discoveryScreenMatch.id!,
      discoveryScreenMatch.screenId!,
    );
    if (!asset) throw new HttpError(404, "Discovery screenshot not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": asset.byteLength,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...CORS_HEADERS,
    });
    response.end(asset);
    return true;
  }

  const discoveryPromoteMatch = matchPath(pathname, "/discovery/:id/promote");
  if (method === "POST" && discoveryPromoteMatch) {
    const body = (await parseJsonBody(request)) as {
      transitionIds?: string[];
      recipeId?: string;
      title?: string;
      description?: string;
      transitionLabels?: Record<string, string>;
    };
    if (!Array.isArray(body.transitionIds) || !body.recipeId || !body.title) {
      throw new HttpError(400, "transitionIds, recipeId, and title are required");
    }
    try {
      await loadScopedSession(discoveryPromoteMatch.id!, scope);
      await promoteDiscoveryPath({
        sessionId: discoveryPromoteMatch.id!,
        transitionIds: body.transitionIds,
        recipeId: body.recipeId,
        title: body.title,
        description: body.description,
        transitionLabels: body.transitionLabels,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const discoveryExportMatch = matchPath(pathname, "/discovery/:id/export");
  if (method === "GET" && discoveryExportMatch) {
    const session = await loadScopedSession(discoveryExportMatch.id!, scope);
    const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";
    text(
      response,
      200,
      formatDiscoveryExport(session, format),
      format === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
    );
    return true;
  }

  return false;
}
