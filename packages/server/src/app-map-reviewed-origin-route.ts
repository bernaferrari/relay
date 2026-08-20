import type http from "node:http";
import {
  ReviewedDocumentOriginError,
  currentOperationContext,
  inspectReviewedDocumentOrigin,
  readAppMap,
  reviewDocumentOrigin,
  revokeReviewedDocumentOrigin,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { resolveCommandActor, type RequestContext } from "./security.js";

type RouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function reviewedOriginHttpError(error: unknown): never {
  if (!(error instanceof ReviewedDocumentOriginError)) throw error;
  const status =
    error.code === "missing-reference" || error.code === "not-found"
      ? 404
      : error.code === "revision-conflict"
        ? 409
        : 400;
  throw new HttpError(status, error.message, {
    code: error.code,
    recovery:
      error.code === "revision-conflict"
        ? "Reload the App Map and inspect the current immutable first viewport before deciding again."
        : "Inspect the reviewed-origin lineage and its immutable raw evidence before retrying.",
  });
}

function commandActor(input: RouteInput) {
  const operation = currentOperationContext();
  return operation
    ? { actorId: operation.actorId, actorKind: operation.actorKind }
    : resolveCommandActor(input.request.headers, input.scope);
}

async function currentMap(scope: RequestContext, appMapId: string) {
  const appMap = await readAppMap(scope.projectId, appMapId);
  if (!appMap) throw new HttpError(404, `App Map ${appMapId} not found`);
  return appMap;
}

/** Offline-only review/revocation routes. None obtain a lease, resolve a
 * target, capture a screenshot, or issue device input. */
export async function handleAppMapReviewedOriginRoute(input: RouteInput): Promise<boolean> {
  const inspect = matchPath(
    input.pathname,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/reviewed-origin",
  );
  if (input.method === "GET" && inspect) {
    try {
      const appMap = await currentMap(input.scope, inspect.appMapId!);
      json(input.response, 200, {
        inspection: await inspectReviewedDocumentOrigin({
          appMap,
          screenId: inspect.screenId!,
          variantId: inspect.variantId!,
          captureId: inspect.captureId!,
        }),
      });
    } catch (error) {
      reviewedOriginHttpError(error);
    }
    return true;
  }
  const review = matchPath(
    input.pathname,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/reviewed-origin/review",
  );
  if (input.method === "POST" && review) {
    const body = (await parseJsonBody(input.request)) as Omit<
      OperationInput<"app-map.scroll-surface.reviewed-origin.review">,
      "appMapId" | "screenId" | "variantId" | "captureId"
    >;
    try {
      const appMap = await currentMap(input.scope, review.appMapId!);
      const result = await reviewDocumentOrigin({
        appMap,
        screenId: review.screenId!,
        variantId: review.variantId!,
        captureId: review.captureId!,
        expectedRevision: body.expectedRevision,
        actor: commandActor(input),
        reason: body.reason,
        assertion: body.assertion,
      });
      json(input.response, 200, result);
    } catch (error) {
      reviewedOriginHttpError(error);
    }
    return true;
  }
  const revoke = matchPath(
    input.pathname,
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/reviewed-origin/:projectionId/revoke",
  );
  if (input.method !== "POST" || !revoke) return false;
  const body = (await parseJsonBody(input.request)) as Omit<
    OperationInput<"app-map.scroll-surface.reviewed-origin.revoke">,
    "appMapId" | "screenId" | "variantId" | "captureId" | "projectionId"
  >;
  try {
    const appMap = await currentMap(input.scope, revoke.appMapId!);
    const result = await revokeReviewedDocumentOrigin({
      appMap,
      screenId: revoke.screenId!,
      variantId: revoke.variantId!,
      captureId: revoke.captureId!,
      projectionId: revoke.projectionId!,
      expectedRevision: body.expectedRevision,
      actor: commandActor(input),
      reason: body.reason,
      assertion: body.assertion,
    });
    json(input.response, 200, result);
  } catch (error) {
    reviewedOriginHttpError(error);
  }
  return true;
}
