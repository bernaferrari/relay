import type http from "node:http";
import {
  attachAppMapScrollSurface,
  captureScrollableSurveyForTarget,
  getActiveJob,
  logicalScrollSurfaceId,
  persistLogicalScrollSurface,
  readAppMap,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetLease } from "./access-control.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";
import { resolveScrollSurfaceCaptureSelection } from "./app-map-scroll-surface-support.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export async function handleAppMapScrollSurfaceRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  const match = matchPath(
    input.pathname,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/capture",
  );
  if (input.method !== "POST" || !match) return false;
  const body = (await parseJsonBody(input.request)) as Omit<
    OperationInput<"app-map.scroll-surface.capture">,
    "appMapId" | "screenId" | "variantId"
  >;
  const appMapId = match.appMapId!;
  const screenId = match.screenId!;
  const variantId = match.variantId!;
  if (
    body.target?.kind !== "device" ||
    (body.target.platform !== "android" && body.target.platform !== "ios")
  ) {
    throw new HttpError(400, "Scrollable surfaces require an Android or iOS device target");
  }
  if (
    body.maxScrolls !== undefined &&
    (!Number.isInteger(body.maxScrolls) || body.maxScrolls < 1 || body.maxScrolls > 6)
  ) {
    throw new HttpError(400, "maxScrolls must be an integer between 1 and 6");
  }
  const current = await readAppMap(input.scope.projectId, appMapId);
  if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
  const { variant } = resolveScrollSurfaceCaptureSelection({
    appMap: current,
    expectedRevision: body.expectedRevision,
    screenId,
    variantId,
    target: body.target,
  });
  if (getActiveJob(body.target.targetId)?.status === "running") {
    throw new HttpError(
      409,
      "A job is running — pause or cancel it before capturing a scrollable surface",
    );
  }
  await assertTargetLease(input.scope, body.target.targetId, body.leaseId);
  const survey = await captureScrollableSurveyForTarget({
    serial: body.target.targetId,
    ...(body.maxScrolls !== undefined ? { maxScrolls: body.maxScrolls } : {}),
  });
  const scrollSurface = await persistLogicalScrollSurface({
    survey,
    targetProfile: variant.targetProfile,
    surfaceId: logicalScrollSurfaceId(screenId, variantId),
    capturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "Full-surface coverage was explicitly captured from the selected Screen Variant.",
      decidedAt: survey.frames[0]?.screenshot.capturedAt ?? Date.now(),
    },
  });
  const appMap = await applyAppMapMutation(
    input.scope,
    appMapId,
    body.expectedRevision,
    body.eventId,
    (map, context) =>
      attachAppMapScrollSurface(map, { screenId, variantId, surface: scrollSurface }, context),
  );
  json(input.response, 200, {
    appMap,
    screen: appMap.screens[screenId],
    variant: appMap.screenVariants[variantId],
    scrollSurface,
  });
  return true;
}
