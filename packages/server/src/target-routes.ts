import type http from "node:http";
import {
  BrowserDeviceConflictError,
  BrowserDeviceInputOverloadedError,
  BrowserMutationOutcomeUnknownError,
  BrowserSupervisionRequiredError,
  browserCaseProfileForTarget,
  captureBrowserAuthenticationStorageState,
  captureBrowserDeviceFrame,
  closeBrowserDeviceSession,
  controlBrowserDevice,
  currentOperationContext,
  deleteTarget,
  inspectBrowserDevice,
  listBrowserAuthenticationFixtures,
  listDeviceLeases,
  listTargets,
  now,
  openBrowserDeviceSession,
  openBrowserTarget,
  preflightTarget,
  readTarget,
  saveBrowserTarget,
  saveBrowserAuthenticationFixture,
  revokeBrowserAuthenticationFixture,
} from "@relay/core";
import {
  browserDeviceControlInputSchema,
  browserDeviceBinaryFrameMetadataSchema,
  browserAuthenticationFixtureOperationInputSchemas,
  browserDeviceFrameInputSchema,
  browserDeviceInspectInputSchema,
  browserDeviceOpenInputSchema,
  BROWSER_DEVICE_BINARY_FRAME_CONTENT_TYPE,
  MAX_BROWSER_DEVICE_BINARY_FRAME_BYTES,
  MAX_BROWSER_DEVICE_BINARY_METADATA_BYTES,
  compileBrowserEnvironment,
  browserAuthenticationFixtureReferenceSchema,
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

function requireHumanBrowserAuthenticationReview(): { actorId: string } {
  const operation = currentOperationContext();
  if (!operation || operation.actorKind !== "human") {
    throw new HttpError(403, "Browser sign-in fixtures require a human reviewer");
  }
  return { actorId: operation.actorId };
}

function browserAuthenticationConflict(error: unknown, fallback: string): HttpError {
  const message =
    error instanceof Error &&
    (/^Browser authentication\b/u.test(error.message) ||
      /^Open the managed browser\b/u.test(error.message))
      ? error.message
      : fallback;
  return new HttpError(409, message);
}

async function saveTargetBrowserEnvironment(
  target: Awaited<ReturnType<typeof readTarget>> & {},
  environment: BrowserEnvironmentInput,
) {
  if (!target.browser) throw new HttpError(404, "Managed browser target not found");
  return saveBrowserTarget({
    id: target.id,
    name: target.name,
    startUrl: target.browser.startUrl,
    headless: target.browser.headless,
    viewport: environment.viewport,
    environment,
    profileRetention: target.browser.profileRetention,
  });
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
      profileRetention?: "retain" | "ephemeral";
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
        profileRetention: body.profileRetention,
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
    const body = (await parseJsonBody(req)) as {
      authenticationFixtureReference?: unknown;
      signedOut?: unknown;
    };
    const authenticationFixtureReference =
      typeof body.authenticationFixtureReference === "string"
        ? browserAuthenticationFixtureReferenceSchema.parse(body.authenticationFixtureReference)
        : undefined;
    const signedOut = body.signedOut === true;
    if (authenticationFixtureReference && signedOut) {
      throw new HttpError(400, "Choose an account fixture or attested signed-out, not both.");
    }
    const profile = browserCaseProfileForTarget(target);
    if (authenticationFixtureReference) {
      const fixtures = await listBrowserAuthenticationFixtures({
        projectId: scope.projectId,
        targetId: target.id,
      });
      const fixture = fixtures.find((item) => item.reference === authenticationFixtureReference);
      if (!fixture || fixture.revokedAt) {
        throw new HttpError(409, "That account fixture is not available on this Browser.");
      }
      await saveTargetBrowserEnvironment(target, {
        ...profile,
        authenticationFixtureId: fixture.reference,
      });
    } else if (signedOut) {
      if (target.browser?.profileRetention === "retain") {
        throw new HttpError(
          409,
          "A persistent Browser cannot attest a clean signed-out session. Use an ephemeral Browser.",
        );
      }
      const { authenticationFixtureId: _active, ...environment } = profile;
      await saveTargetBrowserEnvironment(target, environment);
    }
    const session = await openBrowserTarget(target.id, {
      projectId: scope.projectId,
      ...(authenticationFixtureReference
        ? { authenticationFixtureId: authenticationFixtureReference }
        : {}),
      ...(signedOut ? { signedOut: true as const } : {}),
    });
    json(res, 200, {
      session: {
        ...session,
        ...(authenticationFixtureReference
          ? { authenticationFixtureId: authenticationFixtureReference }
          : {}),
        ...(signedOut ? { signedOut: true as const } : {}),
      },
    });
    return true;
  }

  const browserAuthenticationMatch = matchPath(pathname, "/targets/:id/browser-auth-fixtures");
  if (method === "GET" && browserAuthenticationMatch) {
    const targetId = browserAuthenticationMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    json(res, 200, {
      fixtures: await listBrowserAuthenticationFixtures({ projectId: scope.projectId, targetId }),
    });
    return true;
  }

  if (method === "POST" && browserAuthenticationMatch) {
    const targetId = browserAuthenticationMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const { actorId } = requireHumanBrowserAuthenticationReview();
    await assertTargetControl(scope, targetId);
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.save"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    const fixture = await (async () => {
      try {
        return await saveBrowserAuthenticationFixture({
          projectId: scope.projectId,
          targetId,
          name: body.name,
          createdBy: actorId,
          storageState: await captureBrowserAuthenticationStorageState(targetId),
          expiresAt: body.expiresAt,
          fixtureId: body.fixtureId,
        });
      } catch (error) {
        throw browserAuthenticationConflict(error, "Could not save browser sign-in state");
      }
    })();
    const profile = browserCaseProfileForTarget(target);
    const updated = await saveTargetBrowserEnvironment(target, {
      ...profile,
      authenticationFixtureId: fixture.reference,
    });
    json(res, 201, { fixture, target: updated });
    return true;
  }

  const browserAuthenticationRevokeMatch = matchPath(
    pathname,
    "/targets/:id/browser-auth-fixtures/revoke",
  );
  if (method === "POST" && browserAuthenticationRevokeMatch) {
    const targetId = browserAuthenticationRevokeMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const { actorId } = requireHumanBrowserAuthenticationReview();
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.revoke"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    const fixture = await (async () => {
      try {
        return await revokeBrowserAuthenticationFixture({
          projectId: scope.projectId,
          targetId,
          reference: body.reference,
          revokedBy: actorId,
        });
      } catch (error) {
        throw browserAuthenticationConflict(error, "Could not revoke browser sign-in state");
      }
    })();
    const profile = browserCaseProfileForTarget(target);
    const { authenticationFixtureId: activeReference, ...environment } = profile;
    const updated =
      activeReference === fixture.reference
        ? await saveTargetBrowserEnvironment(target, environment)
        : target;
    json(res, 200, { fixture, target: updated });
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
    const session = await openBrowserDeviceSession(targetId, profile, {
      ...(parsed.authenticationFixtureId
        ? { authenticationFixtureId: parsed.authenticationFixtureId }
        : profile.authenticationFixtureId
          ? { authenticationFixtureId: profile.authenticationFixtureId }
          : {}),
      ...(parsed.signedOut ? { signedOut: true } : {}),
      ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
      projectId: scope.projectId,
    });
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
