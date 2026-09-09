import { randomUUID } from "node:crypto";
import {
  authoringSessions,
  currentOperationContext,
  readAppMap,
  refreshAppMapScreen,
  type AppMapScreenVariantCaptureInput,
} from "@relay/core";
import type { AuthoringSession, OperationInput } from "@relay/protocol";
import { assertTargetLease } from "./access-control.js";
import { currentTakeRevision, profileForCapture } from "./app-map-capture-support.js";
import { createAuthoringRuntime } from "./authoring-routes.js";
import type { AppMapRouteInput } from "./app-map-route-input.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";

type Capture = Omit<AppMapScreenVariantCaptureInput, "map" | "screen" | "at">;
type Prepared = { scope: string; revision: number; expiresAt: number; capture: Capture };
const previews = new Map<string, Prepared>();
const ttl = 5 * 60_000;
const capacity = 64;

export async function handleAppMapScreenRefreshRoute(input: AppMapRouteInput): Promise<boolean> {
  const path = matchPath(input.pathname, "/app-maps/:appMapId/screens/:screenId/refresh/:phase");
  if (input.method !== "POST" || !path || !["prepare", "apply"].includes(path.phase!)) return false;
  const { appMapId, screenId } = path as { appMapId: string; screenId: string };
  const operation = currentOperationContext();
  if (!operation) throw new HttpError(500, "Screen refresh operation context is unavailable");
  const scopeKey = JSON.stringify([
    input.scope.organizationId,
    input.scope.projectId,
    operation.actorId,
    appMapId,
    screenId,
  ]);
  for (const [token, preview] of previews)
    if (preview.expiresAt <= Date.now()) previews.delete(token);
  const current = await readAppMap(input.scope.projectId, appMapId);
  if (!current?.screens[screenId]) throw new HttpError(404, "Mapped screen does not exist");
  const body = (await parseJsonBody(
    input.request,
  )) as OperationInput<"app-map.screen.refresh.prepare"> &
    OperationInput<"app-map.screen.refresh.apply">;
  if (body.expectedRevision !== current.revision)
    throw new HttpError(409, "The App Map changed. Prepare a new screen refresh.", {
      code: "revision-conflict",
    });
  if (path.phase === "apply") {
    const preview = previews.get(body.token);
    if (!preview || preview.scope !== scopeKey || preview.revision !== body.expectedRevision) {
      throw new HttpError(
        409,
        "The screen refresh expired or belongs to another screen, actor, or revision. Capture again.",
        { code: "refresh-token-invalid" },
      );
    }
    // Consume before awaiting the mutation: simultaneous applies cannot replay it.
    previews.delete(body.token);
    const variantId = `variant-refresh-${body.token}`;
    const appMap = await applyAppMapMutation(
      input.scope,
      appMapId,
      body.expectedRevision,
      undefined,
      (map, context) => refreshAppMapScreen(map, screenId, variantId, preview.capture, context),
    );
    json(input.response, 200, {
      appMap,
      screen: appMap.screens[screenId],
      variant: appMap.screenVariants[variantId],
    });
    return true;
  }
  await assertTargetLease(input.scope, body.target.targetId, body.leaseId);
  const runtime = input.authoringRuntime ?? createAuthoringRuntime();
  let session: AuthoringSession | undefined;
  try {
    session = await authoringSessions.create({
      appMapId,
      target: body.target,
      leaseId: body.leaseId,
      expectedAppMapRevision: body.expectedRevision,
    });
    session = await authoringSessions.capture(session.id, runtime);
    const take = currentTakeRevision(session);
    if (!take?.before) throw new HttpError(502, "The target returned no screen observation");
    const screenshotUri = take.evidence.find(
      (item) => item.kind === "screenshot" && take.before!.evidenceIds.includes(item.id),
    )?.uri;
    if (!screenshotUri) throw new HttpError(502, "The target returned no screenshot evidence");
    const capture: Capture = {
      target: body.target,
      observation: take.before,
      targetProfile: await profileForCapture(
        body.target,
        take.before.capturedAt,
        take.before.bounds,
      ),
      evidenceUrisById: Object.fromEntries(take.evidence.map((item) => [item.id, item.uri])),
      evidenceKindsById: Object.fromEntries(take.evidence.map((item) => [item.id, item.kind])),
      evidenceById: Object.fromEntries(take.evidence.map((item) => [item.id, item])),
    };
    const latest = await readAppMap(input.scope.projectId, appMapId);
    if (latest?.revision !== body.expectedRevision)
      throw new HttpError(409, "The App Map changed during capture. Capture again.", {
        code: "revision-conflict",
      });
    while (previews.size >= capacity) previews.delete(previews.keys().next().value!);
    const token = randomUUID();
    const expiresAt = Date.now() + ttl;
    previews.set(token, {
      scope: scopeKey,
      revision: body.expectedRevision,
      expiresAt,
      capture: structuredClone(capture),
    });
    json(input.response, 200, { token, screenshotUri, expiresAt });
  } finally {
    if (session) {
      if (!["committed", "cancelled", "failed"].includes(session.state))
        await authoringSessions.cancel(session.id, runtime).catch(() => undefined);
      await authoringSessions.cleanup(session.id).catch(() => undefined);
    }
  }
  return true;
}
