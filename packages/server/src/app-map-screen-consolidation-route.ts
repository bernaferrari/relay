import {
  consolidateAppMapScreens,
  materializeLogicalScrollSurfaceImport,
  previewScreenConsolidation,
  readAppMap,
  removeAppMapScreen,
} from "@relay/core";
import type { LogicalScrollSurface, OperationInput } from "@relay/protocol";
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
  const consolidationInput = {
    targetScreenId: route.targetScreenId!,
    sourceScreenIds: body.sourceScreenIds,
    targetTitle: body.targetTitle,
  };
  let importedSurface: LogicalScrollSurface | undefined;
  if (body.surfaceImport) {
    const screenIds = [route.targetScreenId!, ...body.sourceScreenIds];
    const variants = screenIds.flatMap((screenId) => {
      const screen = current.screens[screenId];
      if (!screen) throw new HttpError(404, `Screen ${screenId} not found`);
      return screen.variantIds.map((variantId) => current.screenVariants[variantId]!);
    });
    const profileVariant = variants.find(
      (variant) => variant.targetProfile.id === body.surfaceImport!.targetProfileId,
    );
    if (!profileVariant) {
      throw new HttpError(400, "Logical surface import belongs to another target profile");
    }
    importedSurface = await materializeLogicalScrollSurfaceImport({
      surfaceImport: body.surfaceImport,
      targetProfile: profileVariant.targetProfile,
      ownedEvidenceIds: new Set(variants.flatMap((variant) => variant.evidenceIds)),
      ownedEvidenceUris: new Set(variants.flatMap((variant) => variant.evidenceUris ?? [])),
      persist: false,
    });
  }
  const preview = previewScreenConsolidation(current, {
    ...consolidationInput,
    importedSurface,
  });
  if (body.dryRun) {
    json(response, 200, { appMap: current, applied: false, preview });
    return true;
  }
  if (preview.blockers.length > 0) {
    throw new HttpError(409, preview.blockers.map(({ message }) => message).join("; "), {
      code: "in-use",
      preview,
    });
  }
  if (body.surfaceImport) {
    const screenIds = [route.targetScreenId!, ...body.sourceScreenIds];
    const variants = screenIds.flatMap((screenId) =>
      current.screens[screenId]!.variantIds.map((variantId) => current.screenVariants[variantId]!),
    );
    const profileVariant = variants.find(
      (variant) => variant.targetProfile.id === body.surfaceImport!.targetProfileId,
    )!;
    importedSurface = await materializeLogicalScrollSurfaceImport({
      surfaceImport: body.surfaceImport,
      targetProfile: profileVariant.targetProfile,
      ownedEvidenceIds: new Set(variants.flatMap((variant) => variant.evidenceIds)),
      ownedEvidenceUris: new Set(variants.flatMap((variant) => variant.evidenceUris ?? [])),
      persist: true,
    });
  }
  const appMap = await applyAppMapMutation(
    scope,
    route.appMapId!,
    body.expectedRevision,
    body.eventId,
    (map, context) =>
      consolidateAppMapScreens(map, { ...consolidationInput, importedSurface }, context),
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
