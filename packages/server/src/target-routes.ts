import type http from "node:http";
import {
  BrowserDeviceConflictError,
  browserCaseProfileForTarget,
  captureBrowserDeviceFrame,
  closeBrowserDeviceSession,
  controlBrowserDevice,
  currentOperationContext,
  deleteTarget,
  listDeviceLeases,
  listTargets,
  now,
  openBrowserDeviceSession,
  openBrowserTarget,
  preflightTarget,
  readTarget,
  saveBrowserTarget,
} from "@relay/core";
import {
  browserDeviceControlInputSchema,
  browserDeviceFrameInputSchema,
  browserDeviceOpenInputSchema,
  compileBrowserEnvironment,
  type BrowserDeviceSession,
  type BrowserEnvironmentInput,
  type BrowserViewport,
} from "@relay/protocol";
import {
  assertTargetControl,
  assertTargetLease,
  assertTargetObservation,
  targetLeaseBelongsToCaller,
} from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export type TargetRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

async function browserOwnership(
  scope: RequestContext,
  targetId: string,
): Promise<BrowserDeviceSession["ownership"]> {
  const operation = currentOperationContext();
  const at = now();
  const active = (await listDeviceLeases(scope.projectId)).find(
    (lease) => lease.deviceSerial === targetId && lease.status === "leased" && lease.expiresAt > at,
  );
  if (!active) return "available";
  return operation && targetLeaseBelongsToCaller(scope, active, operation.actorId)
    ? "controlled"
    : "occupied";
}

async function withOwnership(
  scope: RequestContext,
  session: Omit<BrowserDeviceSession, "ownership">,
): Promise<BrowserDeviceSession> {
  return { ...session, ownership: await browserOwnership(scope, session.targetId) };
}

export async function handleTargetRoute(context: TargetRouteContext): Promise<boolean> {
  const { method, pathname, url, request: req, response: res, scope } = context;

  if (method === "GET" && pathname === "/targets") {
    json(res, 200, { targets: await listTargets() });
    return true;
  }

  if (method === "POST" && pathname === "/targets") {
    const body = (await parseJsonBody(req)) as {
      id?: string;
      name?: string;
      startUrl?: string;
      headless?: boolean;
      viewport?: BrowserViewport;
      environment?: BrowserEnvironmentInput;
    };
    if (!body.name || !body.startUrl) throw new HttpError(400, "name and startUrl are required");
    json(res, 201, {
      target: await saveBrowserTarget({
        id: body.id,
        name: body.name,
        startUrl: body.startUrl,
        headless: body.headless,
        viewport: body.viewport,
        environment: body.environment,
      }),
    });
    return true;
  }

  const targetMatch = matchPath(pathname, "/targets/:id");
  if (method === "DELETE" && targetMatch) {
    await closeBrowserDeviceSession(targetMatch.id!);
    await deleteTarget(targetMatch.id!);
    json(res, 200, { ok: true });
    return true;
  }

  const targetPreflightMatch = matchPath(pathname, "/targets/:id/preflight");
  if (method === "POST" && targetPreflightMatch) {
    const target = await readTarget(targetPreflightMatch.id!);
    if (!target) throw new HttpError(404, "Target not found");
    json(res, 200, { preflight: await preflightTarget(target) });
    return true;
  }

  const targetOpenMatch = matchPath(pathname, "/targets/:id/open");
  if (method === "POST" && targetOpenMatch) {
    const target = await readTarget(targetOpenMatch.id!);
    if (!target) throw new HttpError(404, "Target not found");
    if (target.kind !== "browser") throw new HttpError(400, "Target is not a browser");
    await assertTargetControl(scope, target.id);
    json(res, 200, { session: await openBrowserTarget(target.id) });
    return true;
  }

  const browserDeviceMatch = matchPath(pathname, "/targets/:id/browser-device");
  if (method === "POST" && browserDeviceMatch) {
    const targetId = browserDeviceMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    await assertTargetControl(scope, targetId);
    const parsed = browserDeviceOpenInputSchema.parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    const base = browserCaseProfileForTarget(target);
    const profile = parsed.environment
      ? compileBrowserEnvironment({ ...base, ...parsed.environment })
      : base;
    const session = await openBrowserDeviceSession(targetId, profile);
    json(res, 200, { session: await withOwnership(scope, session) });
    return true;
  }

  const browserFrameMatch = matchPath(pathname, "/targets/:id/browser-device/frame");
  if (method === "GET" && browserFrameMatch) {
    const targetId = browserFrameMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    assertTargetObservation(scope, targetId);
    const afterRaw = url.searchParams.get("afterSequence");
    const { afterSequence } = browserDeviceFrameInputSchema.parse({
      targetId,
      ...(afterRaw === null ? {} : { afterSequence: afterRaw }),
    });
    try {
      const result = await captureBrowserDeviceFrame(targetId);
      const dropped =
        afterSequence === undefined ? 0 : Math.max(0, result.frame.sequence - afterSequence - 1);
      json(res, 200, {
        session: await withOwnership(scope, result.session),
        frame: result.frame,
        ...(dropped > 0
          ? { gap: { afterSequence, currentSequence: result.frame.sequence, dropped } }
          : {}),
      });
    } catch (error) {
      if (error instanceof BrowserDeviceConflictError) {
        throw new HttpError(409, error.message, {
          code: error.code,
          ...(error.currentSequence === undefined
            ? {}
            : { currentSequence: error.currentSequence }),
        });
      }
      throw error;
    }
    return true;
  }

  const browserInputMatch = matchPath(pathname, "/targets/:id/browser-device/input");
  if (method === "POST" && browserInputMatch) {
    const targetId = browserInputMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const lease = await assertTargetControl(scope, targetId);
    const parsed = browserDeviceControlInputSchema.parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    try {
      const result = await controlBrowserDevice(targetId, parsed.input, () =>
        assertTargetLease(scope, targetId, lease.id),
      );
      json(res, 200, { ok: true, session: await withOwnership(scope, result.session) });
    } catch (error) {
      if (error instanceof BrowserDeviceConflictError) {
        throw new HttpError(409, error.message, {
          code: error.code,
          ...(error.currentSequence === undefined
            ? {}
            : { currentSequence: error.currentSequence }),
        });
      }
      throw error;
    }
    return true;
  }

  return false;
}
