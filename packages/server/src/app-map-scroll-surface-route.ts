import type http from "node:http";
import {
  attachAppMapScrollSurface,
  captureScrollableSurveyForTarget,
  getActiveJob,
  IosMutationOutcomeUnknownError,
  logicalScrollSurfaceId,
  persistLogicalScrollSurface,
  readAppMap,
  regenerateLogicalScrollSurface,
  replaceAppMapScrollSurfaceDerived,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { assertTargetLease } from "./access-control.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";
import {
  resolveScrollSurfaceCaptureSelection,
  resolveScrollSurfaceRegenerationSelection,
} from "./app-map-scroll-surface-support.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";
import type { RequestContext } from "./security.js";

export async function handleAppMapScrollSurfaceRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  const regenerationMatch = matchPath(
    input.pathname,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/regenerate",
  );
  if (input.method === "POST" && regenerationMatch) {
    const body = (await parseJsonBody(input.request)) as Pick<
      OperationInput<"app-map.scroll-surface.regenerate">,
      "expectedRevision" | "eventId"
    >;
    const appMapId = regenerationMatch.appMapId!;
    const screenId = regenerationMatch.screenId!;
    const variantId = regenerationMatch.variantId!;
    const captureId = regenerationMatch.captureId!;
    const current = await readAppMap(input.scope.projectId, appMapId);
    if (!current) throw new HttpError(404, `App Map ${appMapId} not found`);
    const { variant, surface } = resolveScrollSurfaceRegenerationSelection({
      appMap: current,
      expectedRevision: body.expectedRevision,
      screenId,
      variantId,
      captureId,
    });
    const regenerated = await regenerateLogicalScrollSurface({
      surface,
      targetProfile: variant.targetProfile,
    });
    const appMap = await applyAppMapMutation(
      input.scope,
      appMapId,
      body.expectedRevision,
      body.eventId,
      (map, context) =>
        replaceAppMapScrollSurfaceDerived(
          map,
          { screenId, variantId, surface: regenerated },
          context,
        ),
    );
    json(input.response, 200, {
      appMap,
      screen: appMap.screens[screenId],
      variant: appMap.screenVariants[variantId],
      scrollSurface: regenerated,
    });
    return true;
  }
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
    (!Number.isInteger(body.maxScrolls) || body.maxScrolls < 1 || body.maxScrolls > 12)
  ) {
    throw new HttpError(400, "maxScrolls must be an integer between 1 and 12");
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
  let survey: Awaited<ReturnType<typeof captureScrollableSurveyForTarget>>;
  try {
    survey = await captureScrollableSurveyForTarget({
      serial: body.target.targetId,
      ...(body.maxScrolls !== undefined ? { maxScrolls: body.maxScrolls } : {}),
    });
  } catch (error) {
    if (error instanceof IosMutationOutcomeUnknownError) {
      throw iosMutationOutcomeUnknownHttpError(error);
    }
    throw error;
  }
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
