import type http from "node:http";
import {
  buildDiscoveryCoverage,
  buildTargetProfiles,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  createDiscoverySession,
  formatDiscoveryExport,
  interact,
  isSensitiveDiscoveryAction,
  listDevices,
  listDiscoverySessions,
  listTargets,
  promoteDiscoveryPath,
  readDiscoveryScreenAsset,
  readDiscoverySession,
  recordObservedScreen,
  recordObservedTransition,
  renameDiscoverySession,
  setDiscoveryStatus,
  suggestDiscoveryControl,
  type InteractInput,
} from "@relay/core";
import type {
  DiscoveryAgentContext,
  DiscoveryDecisionProvenance,
  DiscoveryScope,
  DiscoveryStatus,
} from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, text } from "./http.js";
import type { RequestContext } from "./security.js";

type DiscoveryRouteInput = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function discoveryInteraction(input: InteractInput): {
  kind: "tap" | "type" | "scroll" | "back" | "manual";
  label?: string;
  target?: {
    identifier?: string;
    ref?: string;
    label?: string;
    text?: string;
    point?: { x: number; y: number };
  };
  text?: string;
  direction?: "up" | "down";
} {
  switch (input.kind) {
    case "identifier":
      return {
        kind: "tap",
        label: input.identifier,
        target: { identifier: input.identifier },
      };
    case "label":
      return { kind: "tap", label: input.label, target: { label: input.label } };
    case "ref":
      return { kind: "tap", label: input.ref, target: { ref: input.ref } };
    case "text-match":
      return { kind: "tap", label: input.match, target: { text: input.match } };
    case "find":
      return { kind: "tap", label: input.query, target: { text: input.query } };
    case "point":
      return {
        kind: "tap",
        label: "Coordinate tap",
        target: { point: { x: input.x, y: input.y } },
      };
    case "swipe":
      return {
        kind: "scroll",
        label: "Swipe",
        direction: input.to.y < input.from.y ? "down" : "up",
      };
    case "type":
      return { kind: "type", label: "Type text", text: input.text };
    case "replace":
      return {
        kind: "type",
        label: "Replace text",
        target: input.target,
        text: input.text,
      };
    case "key":
      return { kind: "manual", label: `Press ${input.key}` };
  }
}

function projectFilter(scope: RequestContext): { projectId: string } | undefined {
  return scope.localTrusted ? undefined : { projectId: scope.projectId };
}

async function loadScopedSession(id: string, scope: RequestContext) {
  const session = await readDiscoverySession(id, projectFilter(scope));
  if (!session) throw new HttpError(404, "Discovery session not found");
  return session;
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

  const discoverySuggestionMatch = matchPath(pathname, "/discovery/:id/suggestion");
  if (method === "GET" && discoverySuggestionMatch) {
    const session = await loadScopedSession(discoverySuggestionMatch.id!, scope);
    json(response, 200, { suggestion: suggestDiscoveryControl(session) });
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

  const discoveryCaptureMatch = matchPath(pathname, "/discovery/:id/capture");
  if (method === "POST" && discoveryCaptureMatch) {
    const session = await loadScopedSession(discoveryCaptureMatch.id!, scope);
    await assertTargetControl(scope, session.targetId);
    const snap = await captureSnapshot({ serial: session.targetId });
    const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
    const captured = await recordObservedScreen({
      sessionId: session.id,
      nodes: snap.nodes,
      screenshotPath: shot.path,
      makeCurrent: true,
    }).finally(() => cleanupScreenshot(shot.path));
    json(response, 201, {
      screen: captured.screen,
      isNew: captured.isNew,
      session: captured.session,
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
    const interaction = raw as InteractInput;
    const observed = discoveryInteraction(interaction);
    if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(observed)) {
      throw new HttpError(403, "Discovery policy blocks this sensitive interaction");
    }
    const beforeSnapshot = await captureSnapshot({ serial: session.targetId });
    const beforeShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
    const before = await recordObservedScreen({
      sessionId: session.id,
      nodes: beforeSnapshot.nodes,
      screenshotPath: beforeShot.path,
      makeCurrent: true,
    }).finally(() => cleanupScreenshot(beforeShot.path));
    await interact(interaction, { serial: session.targetId });
    const afterSnapshot = await captureSnapshot({ serial: session.targetId });
    const afterShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
    const after = await recordObservedScreen({
      sessionId: session.id,
      nodes: afterSnapshot.nodes,
      screenshotPath: afterShot.path,
      makeCurrent: true,
    }).finally(() => cleanupScreenshot(afterShot.path));
    const transition = await recordObservedTransition({
      sessionId: session.id,
      fromScreenId: before.screen.id,
      ...(before.screen.id !== after.screen.id ? { toScreenId: after.screen.id } : {}),
      ...observed,
      ...(decision ? { decision } : {}),
      changedScreen: before.screen.id !== after.screen.id,
    });
    json(response, 201, { transition, before: before.screen, after: after.screen });
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
      const promoted = await promoteDiscoveryPath({
        sessionId: discoveryPromoteMatch.id!,
        transitionIds: body.transitionIds,
        recipeId: body.recipeId,
        title: body.title,
        description: body.description,
        transitionLabels: body.transitionLabels,
      });
      json(response, 201, promoted);
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
