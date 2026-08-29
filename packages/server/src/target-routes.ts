import type http from "node:http";
import {
  BrowserDeviceConflictError,
  BrowserDeviceInputOverloadedError,
  BrowserMutationOutcomeUnknownError,
  BrowserSupervisionRequiredError,
  browserCaseProfileForTarget,
  captureBrowserDeviceFrame,
  closeBrowserDeviceSession,
  controlBrowserDevice,
  currentOperationContext,
  deleteTarget,
  inspectBrowserDevice,
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
  browserDeviceBinaryFrameMetadataSchema,
  browserDeviceFrameInputSchema,
  browserDeviceInspectInputSchema,
  browserDeviceOpenInputSchema,
  BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
  MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
  MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES,
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
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody } from "./http.js";
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

  const browserBinaryFrameMatch = matchPath(pathname, "/targets/:id/browser-device/frame.bin");
  if (method === "GET" && browserBinaryFrameMatch) {
    const targetId = browserBinaryFrameMatch.id!;
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
      const session = await withOwnership(scope, result.session);
      const bytes = Buffer.from(result.frame.base64, "base64");
      if (bytes.byteLength !== result.frame.bytes) {
        throw new HttpError(502, "Browser Device frame bytes do not match their metadata");
      }
      if (bytes.byteLength > MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES) {
        throw new HttpError(413, "Browser Device frame is too large for binary transport");
      }
      const dropped =
        afterSequence === undefined ? 0 : Math.max(0, result.frame.sequence - afterSequence - 1);
      const metadata = browserDeviceBinaryFrameMetadataSchema.parse({
        schemaVersion: 1,
        transport: "binary",
        session,
        frame: (({ base64: _base64, ...frame }) => frame)(result.frame),
        ...(dropped > 0
          ? {
              gap: {
                afterSequence,
                currentSequence: result.frame.sequence,
                dropped,
              },
            }
          : {}),
      });
      const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
      if (metadataBytes.byteLength > MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES) {
        throw new HttpError(502, "Browser Device frame metadata is too large for binary transport");
      }
      const envelope = Buffer.allocUnsafe(4 + metadataBytes.byteLength + bytes.byteLength);
      envelope.writeUInt32BE(metadataBytes.byteLength, 0);
      metadataBytes.copy(envelope, 4);
      bytes.copy(envelope, 4 + metadataBytes.byteLength);
      res.writeHead(200, {
        "Content-Type": BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
        "Content-Length": envelope.byteLength,
        "Cache-Control": "no-store",
        "X-Relay-Browser-Device-Transport": "binary",
        ...CORS_HEADERS,
      });
      res.end(envelope);
    } catch (error) {
      if (error instanceof BrowserDeviceInputOverloadedError) {
        throw new HttpError(429, error.message, {
          code: error.code,
          pending: error.pending,
          limit: error.limit,
          retryable: true,
        });
      }
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
      if (error instanceof BrowserDeviceInputOverloadedError) {
        throw new HttpError(429, error.message, {
          code: error.code,
          pending: error.pending,
          limit: error.limit,
          retryable: true,
        });
      }
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

  const browserInspectMatch = matchPath(pathname, "/targets/:id/browser-device/inspect");
  if (method === "GET" && browserInspectMatch) {
    const targetId = browserInspectMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    assertTargetObservation(scope, targetId);
    const parsed = browserDeviceInspectInputSchema.parse({
      targetId,
      sessionId: url.searchParams.get("sessionId"),
      pageId: url.searchParams.get("pageId"),
      expectedSequence: url.searchParams.get("expectedSequence"),
    });
    try {
      json(res, 200, await inspectBrowserDevice(targetId, parsed));
    } catch (error) {
      if (error instanceof BrowserDeviceInputOverloadedError) {
        throw new HttpError(429, error.message, {
          code: error.code,
          pending: error.pending,
          limit: error.limit,
          retryable: true,
        });
      }
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
      json(res, 200, {
        ok: true,
        session: await withOwnership(scope, result.session),
        ...(result.resolution ? { resolution: result.resolution } : {}),
      });
    } catch (error) {
      if (error instanceof BrowserDeviceInputOverloadedError) {
        throw new HttpError(429, error.message, {
          code: error.code,
          pending: error.pending,
          limit: error.limit,
          retryable: true,
        });
      }
      if (error instanceof BrowserDeviceConflictError) {
        throw new HttpError(409, error.message, {
          code: error.code,
          ...(error.currentSequence === undefined
            ? {}
            : { currentSequence: error.currentSequence }),
        });
      }
      if (error instanceof BrowserMutationOutcomeUnknownError) {
        throw new HttpError(409, error.message, {
          code: "BROWSER_MUTATION_OUTCOME_UNKNOWN",
          mutationId: error.mutationId,
          recovery:
            "Capture the current page and reconcile the mutation outcome before issuing another browser input.",
        });
      }
      if (error instanceof BrowserSupervisionRequiredError) {
        throw new HttpError(503, error.message, {
          code: "BROWSER_SUPERVISION_REQUIRED",
          recovery: "Restart Relay so the durable target supervisor is available.",
        });
      }
      throw error;
    }
    return true;
  }

  return false;
}
