import {
  consolidateAppMapScreens,
  previewScreenConsolidation,
  readAppMap,
  removeAppMapScreen,
} from "@relay/core";
import type { OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";

export async function handleScreenConsolidationRoute({
  method,
  pathname,
  request,
  response,
  scope,
}: AppMapRouteInput): Promise<boolean> {
  const route = matchPath(pathname, "/app-maps/:appMapId/screens/:targetScreenId/consolidate");
  if (method !== "POST" || !route) return false;
  const body = (await parseJsonBody(request)) as Omit<
    OperationInput<"app-map.screen.consolidate">,
    "appMapId" | "targetScreenId"
  >;
  const current = await readAppMap(scope.projectId, route.appMapId!);
  if (!current) throw new HttpError(404, `App Map ${route.appMapId} not found`);
  const completed = body.eventId
    ? current.screens[route.targetScreenId!]?.consolidations?.find(
        (record) => record.eventId === body.eventId,
      )
    : undefined;
  if (completed) {
    json(response, 200, { appMap: current, applied: true, preview: completed.preview });
    return true;
  }
  if (current.revision !== body.expectedRevision) {
    throw new HttpError(
      409,
      `Expected App Map revision ${body.expectedRevision}, current revision is ${current.revision}`,
      { code: "revision-conflict", current },
    );
  }
  const input = { targetScreenId: route.targetScreenId!, sourceScreenIds: body.sourceScreenIds };
  const preview = previewScreenConsolidation(current, input);
  if (body.dryRun) {
    json(response, 200, { appMap: current, applied: false, preview });
    return true;
  }
  const appMap = await applyAppMapMutation(
    scope,
    route.appMapId!,
    body.expectedRevision,
    body.eventId,
    (map, context) => consolidateAppMapScreens(map, input, context),
  );
  json(response, 200, { appMap, applied: true, preview });
  return true;
}

export async function handleScreenRemovalRoute({
  method,
  pathname,
  request,
  response,
  scope,
}: AppMapRouteInput): Promise<boolean> {
  const route = matchPath(pathname, "/app-maps/:appMapId/screens/:screenId/remove");
  if (method !== "POST" || !route) return false;
  const body = (await parseJsonBody(request)) as Omit<
    OperationInput<"app-map.screen.remove">,
    "appMapId" | "screenId"
  >;
  const appMap = await applyAppMapMutation(
    scope,
    route.appMapId!,
    body.expectedRevision,
    body.eventId,
    (map, context) => removeAppMapScreen(map, route.screenId!, context),
  );
  json(response, 200, { appMap });
  return true;
}
