/**
 * HTTP + SSE API over @relay/core.
 * Jobs, traces, heal retries, persisted runs/, live capture.
 */
import http from "node:http";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { optionalFiniteSearchNumber } from "./search-params.js";
import {
  allowedBrowserOrigin,
  isLocalWorkspacePath,
  assertSafeBinding,
  authorizationMatches,
  isLoopbackHost,
  listAuditEvents,
  recordAudit,
  resolveCommandActor,
  resolveRequestContext,
  type RequestContext,
} from "./security.js";
import {
  captureScreenshot,
  currentOperationContext,
  cleanupScreenshot,
  captureSnapshot,
  createDevice,
  enqueueJob,
  formatSnapshotTree,
  formatRecipeYaml,
  formatMatrixYaml,
  parseMatrixYaml,
  getActiveJob,
  getActiveJobs,
  getJob,
  interact,
  previewInteract,
  IdempotencyConflict,
  listActionsWithTrace,
  listAndroidDevicesFast,
  listDevices,
  devicePlatformForSerial,
  resolveJobDevicePlatform,
  bootDevice,
  requestAndroidAuthorization,
  listJobs,
  listTargetWorkers,
  listRecipes,
  readRecipe,
  readRecipeEvidenceImage,
  saveRecipe,
  saveRecipeEvidenceImage,
  deleteRecipe,
  runRecipeStep,
  validateRecipeSteps,
  now,
  publish,
  parseRecipeYaml,
  runsRoot,
  runDoctor,
  doctorFailureMessage,
  toJobReport,
  toJunitXml,
  type InteractInput,
  type JobReport,
  generateValues,
  DEVICE_LEASE_TTL_MS,
  leaseDevice,
  listBuilds,
  listDeviceLeases,
  listDevicePools,
  listCompatibilityMatrices,
  readCompatibilityMatrix,
  listProjects,
  readProjectVariables,
  releaseDeviceLease,
  takeOverDeviceLease,
  saveBuild,
  saveDevicePool,
  saveCompatibilityMatrix,
  saveProject,
  writeProjectVariables,
  listRecipeHistory,
  restoreRecipeHistory,
  recipeStability,
  listSchedules,
  saveSchedule,
  deleteSchedule,
  listTargets,
  deleteCompatibilityMatrix,
  buildTargetProfiles,
  resolveCompatibilityMatrix,
  type RecipeParameter,
  loadEvidenceCollectionPolicy,
  loadRedactionPolicy,
  loadDeviceSetup,
  describeTargetUi,
  dismissTowardParent,
  exploreControls,
  scrollCollectControls,
  runWithTargetContext,
  restartAgentDeviceDaemonForBuildDrift,
  restartAgentDeviceDaemonForSigningEnvDrift,
  authoringSessions,
  listAppMaps,
  runWithOperationContext,
  readAuthoringEvidence,
  reconcilePersistedAppMapRuns,
  type AuthoringRuntime,
} from "@relay/core";
import { createSseHub } from "./sse.js";
import { startScheduler } from "./scheduler.js";
import { handleRunRoute } from "./run-routes.js";
import { handlePublicRunShareRoute } from "./run-share-routes.js";
import { handleJobRoute } from "./job-routes.js";
import {
  assertTargetControl,
  assertTargetLease,
  assertTargetObservation,
} from "./access-control.js";
import {
  CORS_HEADERS,
  HttpError,
  json,
  matchPath,
  parseJsonBody,
  parseLimit,
  text,
} from "./http.js";
import { RevisionConflict } from "@relay/protocol";
import {
  injectAndroidKey,
  injectAndroidScroll,
  injectAndroidTouch,
  type AndroidKeyboardInput,
  type AndroidTouchAction,
} from "./live-video.js";
import { streamTargetVideo } from "./target-video-stream.js";
import {
  readIosVideoTake,
  pruneIosVideoTakes,
  reconcileIosVideoTake,
  startIosVideoTake,
  stopIosVideoTake,
} from "./ios-video-capture.js";
import {
  bindOperationRequest,
  OperationAuthorizationError,
  OperationContractError,
  serverOperationManifest,
} from "./operations.js";
import { handleAuthoringActionReplace, handleAuthoringRoute } from "./authoring-routes.js";
import {
  flushOperationActivity,
  handleActivityRoute,
  recordOperationActivity,
} from "./activity-routes.js";
import { handleAppMapRoute } from "./app-map-routes.js";
import { handleDiscoveryRoute } from "./discovery-routes.js";
import { handleCorpusRoute } from "./corpus-routes.js";
import { handlePresenceRoute } from "./presence-routes.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";
import { handleSettingsRoute } from "./settings-routes.js";
import { handleTargetRoute } from "./target-routes.js";
import {
  handleTargetRuntimeRoute,
  type TargetRuntimeRouteRuntime,
} from "./target-runtime-routes.js";
import { createReadStream } from "node:fs";
import type {
  Build,
  DevicePool,
  GenerationRequest,
  Project,
  RevisionWrite,
  TestData,
  ActorKind,
} from "@relay/protocol";

export type StartServerOptions = {
  port?: number;
  host?: string;
  token?: string;
  authoringRuntime?: AuthoringRuntime;
  /** Test seam for the host-owned Android stream transport. */
  liveVideoStream?: (response: http.ServerResponse, serial: string) => Promise<void>;
  /** Test seam for target observation without starting a device daemon. */
  captureTargetScreenshot?: typeof captureScreenshot;
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>;
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

function collectReports(limit: number, scope?: RequestContext): JobReport[] {
  return listJobs(Math.max(limit, 200))
    .filter(
      (job) =>
        !scope ||
        scope.localTrusted ||
        (job.projectId === scope.projectId && job.ownerId === scope.subject),
    )
    .slice(0, limit)
    .map(toJobReport);
}

const serverStartedAt = Date.now();
let lastKnownDeviceCount: number | null = null;
const PRODUCT_VERSION = "0.1.0";

function actorKindForLeaseOwner(ownerId: string, scope: RequestContext): ActorKind {
  if (!scope.localTrusted) return "agent";
  if (ownerId.startsWith("agent:")) return "agent";
  if (ownerId.startsWith("system:")) return "system";
  return "human";
}

async function liveStreamOperationContext(
  request: http.IncomingMessage,
  scope: RequestContext,
  targetId: string,
  leaseId: string | undefined,
) {
  const at = now();
  const leases = await listDeviceLeases(scope.projectId);
  const requestedActorHeader = request.headers["x-relay-actor-id"];
  let requestedActor: { actorId: string; actorKind: ActorKind } | undefined;
  if (requestedActorHeader !== undefined || !leaseId) {
    try {
      requestedActor = resolveCommandActor(request.headers, scope);
    } catch (error) {
      throw new HttpError(403, error instanceof Error ? error.message : String(error));
    }
  }
  const lease = leaseId
    ? leases.find(
        (candidate) =>
          candidate.id === leaseId &&
          candidate.deviceSerial === targetId &&
          candidate.status === "leased" &&
          candidate.expiresAt > at,
      )
    : leases.find(
        (candidate) =>
          candidate.deviceSerial === targetId &&
          candidate.ownerId === requestedActor?.actorId &&
          candidate.status === "leased" &&
          candidate.expiresAt > at,
      );
  if (!leaseId && !lease) {
    throw new HttpError(403, "A target lease is required for live streaming");
  }
  const attributable =
    lease &&
    (!requestedActorHeader || requestedActor?.actorId === lease.ownerId) &&
    (scope.localTrusted || lease.ownerId === scope.subject);
  if (!attributable) {
    recordAudit(scope, {
      action: "target.stream",
      resource: "lease",
      target: targetId,
      result: "deny",
    });
    throw new HttpError(403, "The live-stream target lease is unavailable");
  }
  recordAudit(scope, {
    action: "target.stream",
    resource: "lease",
    target: targetId,
    result: "allow",
  });
  const requestId = crypto.randomUUID();
  return {
    schemaVersion: 1 as const,
    actorId: lease.ownerId,
    actorKind: requestedActor?.actorKind ?? actorKindForLeaseOwner(lease.ownerId, scope),
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    operationId: "target.stream.open" as const,
    requestId,
    idempotencyKey: requestId,
    issuedAt: at,
    leaseId: lease.id,
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token?: string,
  localTrusted = true,
  sse = createSseHub(CORS_HEADERS),
  authoringRuntime?: AuthoringRuntime,
  liveVideoStream = streamTargetVideo,
  captureTargetScreenshot = captureScreenshot,
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>,
): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  const requestOrigin = req.headers.origin;
  const corsOrigin = allowedBrowserOrigin(requestOrigin);
  if (requestOrigin && !corsOrigin) {
    json(res, 403, { error: "This browser origin is not allowed to access Relay" });
    return;
  }
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Vary", "Origin");
  }

  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Signed report URLs are bearer capabilities with their own expiry and
  // revocation checks. They deliberately bypass the workspace bearer token,
  // but expose only the redacted public projection handled by this route.
  if (await handlePublicRunShareRoute({ method, pathname, response: res })) return;

  if (!authorizationMatches(req.headers.authorization, token)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="relay"');
    json(res, 401, { error: "Authentication required" });
    return;
  }

  let resolvedScope: RequestContext | undefined;
  try {
    let scope: RequestContext;
    try {
      scope = resolveRequestContext(req.headers, {
        authenticated: Boolean(token),
        localTrusted,
      });
    } catch (error) {
      json(res, 403, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    resolvedScope = scope;
    if (!scope.localTrusted && isLocalWorkspacePath(pathname)) {
      recordAudit(scope, { action: "workspace.access", resource: pathname, result: "deny" });
      throw new HttpError(403, "This workspace asset is available only from the local Relay host");
    }
    const operation = bindOperationRequest(req, res, method, pathname, url, scope);
    if (await handleActivityRoute({ method, pathname, url, response: res, scope })) return;
    if (operation) await recordOperationActivity({ operation, pathname, scope, response: res });
    if (await handleAppMapRunRoute({ method, pathname, request: req, response: res, scope }))
      return;
    if (await handleAppMapRoute({ method, pathname, request: req, response: res, scope })) return;
    if (
      await handleTargetRuntimeRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
        runtime: targetRuntime,
      })
    )
      return;
    if (
      await handleAuthoringActionReplace({
        method,
        pathname,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (
      await handleAuthoringRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
        authoringRuntime,
      })
    )
      return;
    if (await handlePresenceRoute({ method, pathname, request: req, response: res, scope })) return;
    if (
      await handleDiscoveryRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (
      await handleCorpusRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (
      await handleSettingsRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (method === "GET" && pathname === "/audit") {
      json(res, 200, { events: listAuditEvents(parseLimit(url.searchParams.get("limit"), 100)) });
      return;
    }
    if (method === "GET" && pathname === "/health") {
      const currentActive = getActiveJob();
      const visibleActiveJobs = getActiveJobs().filter(
        (job) =>
          scope.localTrusted ||
          (job.projectId === scope.projectId && job.ownerId === scope.subject),
      );
      const active =
        currentActive &&
        (scope.localTrusted ||
          (currentActive.projectId === scope.projectId && currentActive.ownerId === scope.subject))
          ? currentActive
          : undefined;
      const visibleJobCount = scope.localTrusted
        ? listJobs(50).length
        : listJobs(50).filter(
            (job) => job.projectId === scope.projectId && job.ownerId === scope.subject,
          ).length;
      json(res, 200, {
        ok: true,
        product: "relay",
        version: PRODUCT_VERSION,
        mode: "app-testing",
        pid: process.pid,
        startedAt: serverStartedAt,
        at: now(),
        uptimeMs: now() - serverStartedAt,
        activeJob: active
          ? {
              id: active.id,
              action: active.action,
              status: active.status,
              serial: active.serial ?? null,
              deviceName: active.deviceName ?? null,
              startedAt: active.startedAt ?? null,
            }
          : null,
        activeJobs: visibleActiveJobs.map((job) => ({
          id: job.id,
          status: job.status,
          targetId: job.browserTargetId ?? job.serial,
          workerId: job.workerId,
        })),
        targetWorkers: listTargetWorkers(),
        jobs: visibleJobCount,
        // Health is a liveness probe and must answer within Electron's short
        // startup timeout. Device discovery can invoke adb/simctl and belongs
        // on /devices; report its last completed value without blocking here.
        deviceCount: lastKnownDeviceCount,
        sseClients: sse.count(),
        runsDir: scope.localTrusted ? runsRoot() : "runs",
        access: {
          role: scope.role,
          organizationId: scope.organizationId,
          projectId: scope.projectId,
        },
      });
      return;
    }

    if (method === "GET" && pathname === "/events") {
      sse.attach(req, res, (event) => {
        if (event.organizationId !== scope.organizationId || event.projectId !== scope.projectId) {
          return false;
        }
        if (scope.localTrusted) return true;
        const jobId = "jobId" in event.payload ? event.payload.jobId : undefined;
        if (typeof jobId !== "string") return true;
        const job = getJob(jobId);
        return job?.projectId === scope.projectId && job.ownerId === scope.subject;
      });
      return;
    }

    if (method === "GET" && pathname === "/actions") {
      json(res, 200, { actions: listActionsWithTrace() });
      return;
    }

    if (method === "GET" && pathname === "/devices") {
      if (url.searchParams.get("phase") === "android") {
        const devices = await listAndroidDevicesFast().catch(() => []);
        json(res, 200, { devices });
        return;
      }
      const mobile = await listDevices().catch(() => []);
      const browsers = (await listTargets()).map((target) => ({
        id: target.id,
        serial: target.id,
        name: target.name,
        kind: "Managed browser",
        booted: true,
        platform: "browser",
        targetKind: "browser",
      }));
      const devices = [...mobile, ...browsers];
      lastKnownDeviceCount = mobile.length;
      json(res, 200, { devices });
      return;
    }

    if (
      await handleTargetRoute({
        method,
        pathname,
        request: req,
        response: res,
      })
    )
      return;

    // ---- Project-scoped control plane ----
    if (method === "GET" && pathname === "/projects") {
      json(res, 200, { projects: await listProjects(scope.organizationId) });
      return;
    }

    if (method === "POST" && pathname === "/projects") {
      const body = (await parseJsonBody(req)) as Partial<Project>;
      if (!body.id?.trim() || !body.name?.trim())
        throw new HttpError(400, "id and name are required");
      const project = await saveProject({
        id: body.id.trim(),
        name: body.name.trim(),
        organizationId: scope.organizationId,
      });
      json(res, 201, { project });
      return;
    }

    if (method === "GET" && pathname === "/builds") {
      json(res, 200, { builds: await listBuilds(scope.projectId) });
      return;
    }

    if (method === "POST" && pathname === "/builds") {
      const body = (await parseJsonBody(req)) as Partial<Build>;
      if (!body.id || !body.name || (body.platform !== "android" && body.platform !== "ios")) {
        throw new HttpError(400, "id, name, and a valid platform are required");
      }
      const build = await saveBuild({
        id: body.id,
        projectId: scope.projectId,
        name: body.name,
        platform: body.platform,
        sourceUrl: body.sourceUrl,
        status: body.status ?? "uploaded",
      });
      json(res, 201, { build });
      return;
    }

    if (method === "GET" && pathname === "/device-pools") {
      json(res, 200, { pools: await listDevicePools(scope.projectId) });
      return;
    }

    if (method === "POST" && pathname === "/device-pools") {
      const body = (await parseJsonBody(req)) as Partial<DevicePool>;
      if (!body.id || !body.name || !Array.isArray(body.deviceSerials)) {
        throw new HttpError(400, "id, name, and deviceSerials are required");
      }
      const pool = await saveDevicePool({
        id: body.id,
        projectId: scope.projectId,
        name: body.name,
        platform: body.platform ?? "mixed",
        deviceSerials: body.deviceSerials.map(String),
      });
      json(res, 201, { pool });
      return;
    }

    if (method === "GET" && pathname === "/target-profiles") {
      const devices = await listDevices().catch(() => []);
      json(res, 200, { profiles: buildTargetProfiles({ devices, targets: await listTargets() }) });
      return;
    }

    if (method === "GET" && pathname === "/matrices") {
      json(res, 200, { matrices: await listCompatibilityMatrices(scope.projectId) });
      return;
    }

    const matrixYamlMatch = matchPath(pathname, "/matrices/:id/yaml");
    if (method === "GET" && matrixYamlMatch) {
      const matrix = await readCompatibilityMatrix(scope.projectId, matrixYamlMatch.id!);
      if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
      json(res, 200, { yaml: formatMatrixYaml(matrix) });
      return;
    }

    if (method === "POST" && pathname === "/matrices/import") {
      const body = (await parseJsonBody(req)) as {
        yaml?: string;
        conflict?: "reject" | "replace";
      };
      if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
      let parsed;
      try {
        parsed = parseMatrixYaml(body.yaml, {
          projectId: scope.projectId,
          createdAt: 0,
          updatedAt: 0,
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const existing = await readCompatibilityMatrix(scope.projectId, parsed.id);
      if (existing && body.conflict !== "replace") {
        throw new HttpError(409, `Compatibility matrix “${parsed.id}” already exists`);
      }
      const matrix = await saveCompatibilityMatrix({
        id: parsed.id,
        projectId: scope.projectId,
        name: parsed.name,
        selectors: parsed.selectors,
      });
      json(res, existing ? 200 : 201, { matrix });
      return;
    }

    if (method === "POST" && pathname === "/matrices") {
      const body = (await parseJsonBody(req)) as {
        id?: string;
        name?: string;
        selectors?: import("@relay/protocol").TargetSelector[];
      };
      if (!body.id || !body.name || !Array.isArray(body.selectors)) {
        throw new HttpError(400, "id, name, and selectors are required");
      }
      try {
        const matrix = await saveCompatibilityMatrix({
          id: body.id,
          projectId: scope.projectId,
          name: body.name,
          selectors: body.selectors,
        });
        json(res, 201, { matrix });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const matrixMatch = matchPath(pathname, "/matrices/:id");
    if (method === "PUT" && matrixMatch) {
      const existing = await readCompatibilityMatrix(scope.projectId, matrixMatch.id!);
      if (!existing) throw new HttpError(404, "Compatibility matrix not found");
      const body = (await parseJsonBody(req)) as {
        name?: string;
        selectors?: import("@relay/protocol").TargetSelector[];
      };
      try {
        const matrix = await saveCompatibilityMatrix({
          id: existing.id,
          projectId: scope.projectId,
          name: body.name ?? existing.name,
          selectors: body.selectors ?? existing.selectors,
        });
        json(res, 200, { matrix });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (method === "DELETE" && matrixMatch) {
      await deleteCompatibilityMatrix(scope.projectId, matrixMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    const matrixResolveMatch = matchPath(pathname, "/matrices/:id/resolve");
    if (method === "POST" && matrixResolveMatch) {
      const matrix = await readCompatibilityMatrix(scope.projectId, matrixResolveMatch.id!);
      if (!matrix) throw new HttpError(404, "Compatibility matrix not found");
      const devices = await listDevices().catch(() => []);
      json(res, 200, {
        expansion: resolveCompatibilityMatrix(
          matrix,
          buildTargetProfiles({ devices, targets: await listTargets() }),
        ),
      });
      return;
    }

    if (method === "GET" && pathname === "/device-leases") {
      const status = url.searchParams.get("status") ?? "active";
      const leases = await listDeviceLeases(scope.projectId);
      json(res, 200, {
        leases: status === "all" ? leases : leases.filter((lease) => lease.status === "leased"),
      });
      return;
    }

    if (method === "POST" && pathname === "/device-leases") {
      const body = (await parseJsonBody(req)) as {
        poolId?: string;
        deviceSerial?: string;
        expiresAt?: number;
      };
      if (!body.poolId || !body.deviceSerial)
        throw new HttpError(400, "poolId and deviceSerial are required");
      let lease;
      try {
        lease = await leaseDevice({
          projectId: scope.projectId,
          poolId: body.poolId,
          deviceSerial: body.deviceSerial,
          ownerId: currentOperationContext()!.actorId,
          expiresAt: body.expiresAt ?? now() + DEVICE_LEASE_TTL_MS,
        });
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
      json(res, 201, { lease });
      return;
    }

    const takeoverLeaseMatch = matchPath(pathname, "/device-leases/:id/takeover");
    if (method === "POST" && takeoverLeaseMatch) {
      const body = (await parseJsonBody(req)) as {
        expiresAt?: number;
        reason?: string;
        confirm?: boolean;
      };
      if (body.confirm !== true)
        throw new HttpError(403, "Explicit takeover confirmation required");
      if (!body.reason?.trim()) {
        throw new HttpError(400, "A takeover reason is required");
      }
      try {
        json(res, 200, {
          lease: await takeOverDeviceLease(takeoverLeaseMatch.id!, {
            projectId: scope.projectId,
            ownerId: currentOperationContext()!.actorId,
            expiresAt: body.expiresAt ?? now() + DEVICE_LEASE_TTL_MS,
            reason: body.reason,
          }),
        });
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const releaseLeaseMatch = matchPath(pathname, "/device-leases/:id/release");
    if (method === "POST" && releaseLeaseMatch) {
      try {
        json(res, 200, {
          lease: await releaseDeviceLease(releaseLeaseMatch.id!, {
            projectId: scope.projectId,
            ownerId: currentOperationContext()!.actorId,
          }),
        });
      } catch (error) {
        throw new HttpError(404, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (method === "GET" && pathname === "/project/variables") {
      json(res, 200, await readProjectVariables(scope.projectId));
      return;
    }

    if (method === "PUT" && pathname === "/project/variables") {
      const body = (await parseJsonBody(req)) as RevisionWrite<TestData[]>;
      if (!Number.isInteger(body.expectedRevision) || !Array.isArray(body.value)) {
        throw new HttpError(400, "expectedRevision and value are required");
      }
      body.idempotencyKey ||= req.headers["idempotency-key"] as string | undefined;
      json(res, 200, await writeProjectVariables(scope.projectId, body));
      return;
    }

    if (method === "POST" && pathname === "/generate") {
      const body = (await parseJsonBody(req)) as GenerationRequest;
      if (!body.prompt?.trim() || (body.purpose !== "variable" && body.purpose !== "test-plan")) {
        throw new HttpError(400, "purpose and prompt are required");
      }
      json(res, 200, await generateValues(body));
      return;
    }

    if (method === "POST" && pathname === "/device/boot") {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        platform?: "android" | "ios";
      };
      if (!body.serial?.trim()) throw new HttpError(400, "serial is required");
      await assertTargetControl(scope, body.serial);
      const known = (await listDevices().catch(() => [])).find(
        (device) => device.serial === body.serial,
      );
      if (known?.kind && !/simulator|emulator/i.test(known.kind)) {
        throw new HttpError(400, "Only simulators and emulators can be booted from Relay");
      }
      try {
        await bootDevice(body.serial.trim(), body.platform ?? known?.platform ?? "ios");
      } catch (error) {
        throw new HttpError(502, error instanceof Error ? error.message : String(error));
      }
      json(res, 200, { ok: true, serial: body.serial.trim() });
      return;
    }

    if (method === "POST" && pathname === "/device/authorize") {
      const body = (await parseJsonBody(req)) as { serial?: string };
      if (!body.serial?.trim()) throw new HttpError(400, "serial is required");
      await assertTargetControl(scope, body.serial);
      const known = (await listDevices().catch(() => [])).find(
        (device) => device.serial === body.serial,
      );
      if (!known) throw new HttpError(404, "Android device is no longer attached");
      if (known.platform !== "android" || known.kind !== "Physical device") {
        throw new HttpError(400, "Only attached Android hardware can be authorized");
      }
      try {
        await requestAndroidAuthorization(body.serial);
      } catch (error) {
        throw new HttpError(502, error instanceof Error ? error.message : String(error));
      }
      json(res, 200, { ok: true, serial: body.serial });
      return;
    }

    if (await handleJobRoute({ method, pathname, url, request: req, response: res, scope })) {
      return;
    }

    if (method === "GET" && pathname === "/recipes") {
      json(res, 200, { recipes: await listRecipes() });
      return;
    }

    if (method === "GET" && pathname === "/schedules") {
      json(res, 200, {
        schedules: await listSchedules(
          scope.localTrusted ? undefined : { projectId: scope.projectId },
        ),
      });
      return;
    }
    if (method === "POST" && pathname === "/schedules") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Schedules can only be changed from a local Relay host");
      }
      try {
        const body = (await parseJsonBody(req)) as Parameters<typeof saveSchedule>[0];
        await assertTargetControl(scope, body.targetId);
        json(res, 201, {
          schedule: await saveSchedule({ ...body, projectId: scope.projectId }),
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const scheduleMatch = matchPath(pathname, "/schedules/:id");
    if (method === "DELETE" && scheduleMatch) {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Schedules can only be changed from a local Relay host");
      }
      const removed = await deleteSchedule(scheduleMatch.id!, {
        projectId: scope.projectId,
      });
      if (!removed) throw new HttpError(404, "Schedule not found");
      json(res, 200, { ok: true });
      return;
    }

    const recipeEvidenceImageMatch = matchPath(pathname, "/recipes/:recipeId/evidence/:evidenceId");
    if (method === "GET" && recipeEvidenceImageMatch) {
      const image = await readRecipeEvidenceImage(
        recipeEvidenceImageMatch.recipeId!,
        recipeEvidenceImageMatch.evidenceId!,
      );
      if (!image) throw new HttpError(404, "Recording evidence not found");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": image.byteLength,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...CORS_HEADERS,
      });
      res.end(image);
      return;
    }

    const authoringEvidenceMatch = matchPath(pathname, "/authoring-evidence/:sha256");
    if (method === "GET" && authoringEvidenceMatch) {
      const sha256 = authoringEvidenceMatch.sha256!;
      const uri = `relay-evidence://${sha256}`;
      const sessions = await authoringSessions.list(scope.projectId);
      const permitted =
        sessions.some((session) =>
          session.take?.revisions.some((revision) =>
            revision.evidence.some((evidence) => evidence.uri === uri),
          ),
        ) ||
        sessions.some((session) =>
          session.take?.replayAttempts.some((attempt) =>
            attempt.evidence.some((evidence) => evidence.uri === uri),
          ),
        ) ||
        (await listAppMaps(scope.projectId)).some((appMap) =>
          Object.values(appMap.screenVariants).some(
            (variant) =>
              variant.screenshotUri === uri || variant.evidenceUris?.includes(uri) === true,
          ),
        );
      if (!permitted) throw new HttpError(404, "Authoring evidence not found");
      const artifact = await readAuthoringEvidence(sha256);
      if (!artifact) throw new HttpError(404, "Authoring evidence not found");
      const requestedMime = url.searchParams.get("mime") ?? "";
      const contentType = requestedMime.startsWith("video/")
        ? requestedMime
        : requestedMime === "application/json"
          ? requestedMime
          : "image/png";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": artifact.byteLength,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...CORS_HEADERS,
      });
      res.end(artifact);
      return;
    }

    const recipeHistoryMatch = matchPath(pathname, "/recipes/:recipeId/history");
    if (method === "GET" && recipeHistoryMatch) {
      json(res, 200, { versions: await listRecipeHistory(recipeHistoryMatch.recipeId!) });
      return;
    }
    if (method === "POST" && recipeHistoryMatch) {
      const body = (await parseJsonBody(req)) as { updatedAt?: number };
      if (!Number.isFinite(body.updatedAt)) throw new HttpError(400, "updatedAt is required");
      try {
        json(res, 200, {
          recipe: await restoreRecipeHistory(recipeHistoryMatch.recipeId!, body.updatedAt!),
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const recipeStabilityMatch = matchPath(pathname, "/recipes/:recipeId/stability");
    if (method === "GET" && recipeStabilityMatch) {
      json(res, 200, { stability: await recipeStability(recipeStabilityMatch.recipeId!) });
      return;
    }

    const recipeYamlMatch = matchPath(pathname, "/recipes/:recipeId/yaml");
    if (method === "GET" && recipeYamlMatch) {
      const recipe = await readRecipe(recipeYamlMatch.recipeId!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      const yaml = formatRecipeYaml(recipe);
      // The HTTP API defaults to JSON while direct links, curl, and Git tooling
      // receive the portable source file. Keeping both forms at one address
      // avoids an app-only serialization format.
      if (req.headers.accept?.includes("application/json")) json(res, 200, { yaml });
      else text(res, 200, yaml, "application/yaml; charset=utf-8");
      return;
    }

    if (method === "POST" && pathname === "/recipes/import") {
      const body = (await parseJsonBody(req)) as {
        yaml?: string;
        dryRun?: boolean;
        conflict?: "reject" | "replace" | "copy";
      };
      if (!body.yaml?.trim()) throw new HttpError(400, "yaml is required");
      try {
        const parsed = parseRecipeYaml(body.yaml);
        const existing = await readRecipe(parsed.id);
        if (body.dryRun) {
          json(res, 200, {
            preview: {
              recipe: parsed,
              exists: Boolean(existing),
              canonicalYaml: formatRecipeYaml(parsed),
            },
          });
          return;
        }
        const conflict = body.conflict ?? "reject";
        if (existing && conflict === "reject") {
          throw new HttpError(409, `Test “${parsed.id}” already exists`);
        }
        let id = parsed.id;
        let title = parsed.title;
        if (existing && conflict === "copy") {
          let suffix = 2;
          while (await readRecipe(`${parsed.id}-copy-${suffix}`)) suffix += 1;
          id = `${parsed.id}-copy-${suffix}`;
          title = `${parsed.title} copy`;
        }
        const recipe = await saveRecipe({
          id,
          expectedRevision: existing && conflict === "replace" ? existing.updatedAt : 0,
          title,
          description: parsed.description,
          variables: parsed.variables,
          parameters: parsed.parameters,
          steps: parsed.steps,
          quarantined: parsed.quarantined,
          quarantineReason: parsed.quarantineReason,
          recordingFormatVersion: parsed.recordingFormatVersion,
        });
        json(res, 201, { recipe });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const recipeEvidenceMatch = matchPath(pathname, "/recipes/:recipeId/evidence");
    if (method === "POST" && recipeEvidenceMatch) {
      const recipe = await readRecipe(recipeEvidenceMatch.recipeId!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      const body = (await parseJsonBody(req, 12 * 1024 * 1024)) as {
        evidenceId?: string;
        mime?: string;
        base64?: string;
      };
      if (!body.evidenceId || body.mime !== "image/png" || !body.base64) {
        throw new HttpError(400, "evidenceId, image/png mime, and base64 are required");
      }
      try {
        const saved = await saveRecipeEvidenceImage({
          recipeId: recipe.id,
          evidenceId: body.evidenceId,
          base64: body.base64,
        });
        json(res, 201, { ok: true, ...saved });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const recipeMatch = matchPath(pathname, "/recipes/:recipeId");
    if (method === "GET" && recipeMatch) {
      const recipe = await readRecipe(recipeMatch.recipeId!);
      if (!recipe) throw new HttpError(404, "Recipe not found");
      json(res, 200, { recipe });
      return;
    }

    if (method === "POST" && pathname === "/recipes") {
      const body = (await parseJsonBody(req)) as {
        expectedRevision?: number;
        title?: string;
        description?: string;
        variables?: Record<string, string>;
        parameters?: RecipeParameter[];
        steps?: unknown;
        quarantined?: boolean;
        quarantineReason?: string;
      };
      if (body.expectedRevision !== 0) throw new HttpError(409, "New recipes require revision 0");
      if (!body.title || !body.title.trim()) throw new HttpError(400, "title is required");
      let steps;
      try {
        steps = validateRecipeSteps(body.steps);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      const recipe = await saveRecipe({
        expectedRevision: 0,
        title: body.title,
        description: body.description,
        variables: body.variables,
        parameters: body.parameters,
        steps,
        quarantined: body.quarantined,
        quarantineReason: body.quarantineReason,
      });
      json(res, 201, { recipe });
      return;
    }

    if (method === "PUT" && recipeMatch) {
      const id = recipeMatch.recipeId!;
      // saveRecipe refuses builtin ids with a clear message.
      const body = (await parseJsonBody(req)) as {
        expectedRevision?: number;
        title?: string;
        description?: string;
        variables?: Record<string, string>;
        parameters?: RecipeParameter[];
        steps?: unknown;
        quarantined?: boolean;
        quarantineReason?: string;
      };
      if (!Number.isFinite(body.expectedRevision) || body.expectedRevision! < 0) {
        throw new HttpError(400, "expectedRevision is required");
      }
      let steps;
      try {
        steps = validateRecipeSteps(body.steps);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      let recipe;
      try {
        recipe = await saveRecipe({
          id,
          expectedRevision: body.expectedRevision!,
          title: body.title ?? id,
          description: body.description,
          variables: body.variables,
          parameters: body.parameters,
          steps,
          quarantined: body.quarantined,
          quarantineReason: body.quarantineReason,
        });
      } catch (err) {
        if (err instanceof RevisionConflict || err instanceof IdempotencyConflict) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
      json(res, 200, { recipe });
      return;
    }

    if (method === "DELETE" && recipeMatch) {
      try {
        await deleteRecipe(recipeMatch.recipeId!);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
      json(res, 200, { ok: true });
      return;
    }

    const runMatch = matchPath(pathname, "/actions/:id/run");
    if (method === "POST" && runMatch) {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        platform?: "android" | "ios";
        prodAccountMatch?: string;
        wait?: boolean;
      };
      await assertTargetControl(scope, body.serial);
      const job = enqueueJob({
        recipe: runMatch.id!,
        serial: body.serial,
        platform: body.platform ?? (await resolveJobDevicePlatform(body.serial)),
        prodAccountMatch: body.prodAccountMatch,
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
      if (body.wait === false) {
        json(res, 202, { job });
        return;
      }
      for (;;) {
        const current = getJob(job.id);
        if (!current) {
          throw new HttpError(500, "Job disappeared while waiting");
        }
        if (
          current.status === "ok" ||
          current.status === "error" ||
          current.status === "healed" ||
          current.status === "cancelled"
        ) {
          json(res, 200, {
            ok: current.status === "ok" || current.status === "healed",
            action: current.action,
            result: current.result,
            error: current.error,
            healed: current.healed,
            healMessage: current.healMessage,
            cancelled: current.status === "cancelled",
            job: current,
            logs: current.logs,
          });
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    if (method === "GET" && pathname === "/snapshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const interactiveOnly = url.searchParams.get("interactiveOnly") === "1";
      const includeVisual =
        url.searchParams.get("visual") === "1" || url.searchParams.get("visual") === "true";
      assertTargetObservation(scope, serial);
      const snap = await captureSnapshot({ serial, interactiveOnly, includeVisual });
      const tree = formatSnapshotTree(snap.nodes);
      json(res, 200, { ...snap, tree });
      return;
    }

    if (method === "GET" && pathname === "/screenshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const caption = url.searchParams.get("caption") ?? undefined;
      const jobId = url.searchParams.get("jobId") ?? undefined;
      const ephemeral = url.searchParams.get("ephemeral") === "1";
      const previewX = optionalFiniteSearchNumber(url.searchParams, "previewX");
      const previewY = optionalFiniteSearchNumber(url.searchParams, "previewY");
      assertTargetObservation(scope, serial);
      const shot = await captureTargetScreenshot({
        serial,
        caption: caption ?? undefined,
        jobId,
        ephemeral,
        // Screenshots must not take an accessibility tree — that wedges XCTest
        // on physical iPads and blocks the next interact/snapshot.
        includeScreenMatch: false,
        ...(previewX !== undefined && previewY !== undefined
          ? { previewTap: { x: previewX, y: previewY } }
          : {}),
      });
      json(res, 200, shot);
      if (ephemeral) await cleanupScreenshot(shot.path);
      return;
    }

    if (method === "GET" && pathname === "/device/stream") {
      const serial = url.searchParams.get("serial")?.trim();
      if (!serial) throw new HttpError(400, "serial is required");
      const leaseId = url.searchParams.get("lease") ?? undefined;
      const streamContext = await liveStreamOperationContext(req, scope, serial, leaseId);
      await runWithOperationContext(streamContext, async () => {
        await assertTargetLease(scope, serial, streamContext.leaseId);
        await liveVideoStream(res, serial);
      });
      return;
    }

    if (method === "POST" && pathname === "/device/video") {
      const body = (await parseJsonBody(req)) as { serial?: unknown; action?: unknown };
      const serial = typeof body.serial === "string" ? body.serial.trim() : "";
      if (!serial) throw new HttpError(400, "serial is required");
      if (body.action !== "start" && body.action !== "stop") {
        throw new HttpError(400, "action must be start or stop");
      }
      await assertTargetControl(scope, serial);
      if ((await devicePlatformForSerial(serial)) !== "ios") {
        throw new HttpError(400, "Recorded video capture is available for Apple devices only");
      }
      try {
        const take =
          body.action === "start"
            ? await startIosVideoTake(serial)
            : await stopIosVideoTake(serial);
        json(res, 200, {
          take: take && {
            id: take.id,
            serial: take.serial,
            startedAt: take.startedAt,
            ...(take.finishedAt ? { finishedAt: take.finishedAt } : {}),
            state: take.state,
            ...(take.warning ? { warning: take.warning } : {}),
          },
        });
      } catch (error) {
        throw new HttpError(502, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const iosVideoMatch = matchPath(pathname, "/device/video/:id");
    if (method === "GET" && iosVideoMatch) {
      // A finished take is workspace evidence, not live device control. Keep
      // it local-only, but let review continue after the iPhone/iPad is
      // unplugged or a different target has been selected.
      if (!scope.localTrusted) {
        throw new HttpError(
          403,
          "Recorded Apple video is available only from the local Relay host",
        );
      }
      const take = await readIosVideoTake(iosVideoMatch.id!);
      if (!take || take.state !== "ready") throw new HttpError(404, "Video take is not ready");
      try {
        await new Promise<void>((resolve, reject) => {
          res.writeHead(200, {
            "content-type": "video/mp4",
            "cache-control": "private, max-age=0, no-store",
          });
          const stream = createReadStream(take.path);
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.pipe(res);
        });
      } catch {
        throw new HttpError(404, "Recorded video is unavailable");
      }
      return;
    }

    if (method === "POST" && pathname === "/device/touch") {
      const body = (await parseJsonBody(req)) as {
        serial?: unknown;
        action?: unknown;
        x?: unknown;
        y?: unknown;
      };
      const serial = typeof body.serial === "string" ? body.serial.trim() : "";
      const action = body.action;
      const x = body.x;
      const y = body.y;
      if (!serial) throw new HttpError(400, "serial is required");
      if (!(["down", "move", "up", "cancel"] as unknown[]).includes(action)) {
        throw new HttpError(400, "action must be down|move|up|cancel");
      }
      if (
        typeof x !== "number" ||
        !Number.isFinite(x) ||
        typeof y !== "number" ||
        !Number.isFinite(y)
      ) {
        throw new HttpError(400, "x and y must be finite normalized coordinates");
      }
      if (getActiveJob(serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      await assertTargetControl(scope, serial);
      await injectAndroidTouch(serial, action as AndroidTouchAction, x, y);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/device/key") {
      const body = (await parseJsonBody(req)) as Record<string, unknown>;
      const serial = typeof body.serial === "string" ? body.serial.trim() : "";
      if (!serial) throw new HttpError(400, "serial is required");
      if (getActiveJob(serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }

      let input: AndroidKeyboardInput;
      if (body.kind === "text" && typeof body.text === "string" && body.text.length > 0) {
        input = { kind: "text", text: body.text };
      } else if (body.kind === "key" && (body.key === "enter" || body.key === "backspace")) {
        input = { kind: "key", key: body.key };
      } else {
        throw new HttpError(400, "kind must be text with text, or key with enter|backspace");
      }

      await assertTargetControl(scope, serial);
      try {
        // The live H.264 stream is the lowest-latency path when the device
        // stage is open. Keep the CLI usable without that optional stream by
        // falling back to the shared semantic device adapter.
        await injectAndroidKey(serial, input);
      } catch (error) {
        if (!(error instanceof HttpError) || !/control is not ready/i.test(error.message)) {
          throw error;
        }
        await interact(
          input.kind === "text"
            ? { kind: "type", text: input.text }
            : { kind: "key", key: input.key },
          { serial },
        );
      }
      json(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/device/scroll") {
      const body = (await parseJsonBody(req)) as Record<string, unknown>;
      const serial = typeof body.serial === "string" ? body.serial.trim() : "";
      const values = [body.x, body.y, body.scrollX, body.scrollY];
      if (!serial) throw new HttpError(400, "serial is required");
      if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new HttpError(400, "x, y, scrollX, and scrollY must be finite numbers");
      }
      if (getActiveJob(serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      await assertTargetControl(scope, serial);
      await injectAndroidScroll(
        serial,
        body.x as number,
        body.y as number,
        body.scrollX as number,
        body.scrollY as number,
      );
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/target/ui") {
      const serial = url.searchParams.get("serial") ?? undefined;
      if (!serial) throw new HttpError(400, "serial is required");
      assertTargetObservation(scope, serial);
      const description = await describeTargetUi(serial);
      json(res, 200, description);
      return;
    }

    if (method === "POST" && pathname === "/target/ui/back") {
      const body = (await parseJsonBody(req)) as { serial?: string; parentTitles?: string[] };
      const serial = body.serial;
      if (!serial) throw new HttpError(400, "serial is required");
      await assertTargetControl(scope, serial);
      const methodUsed = await dismissTowardParent({
        serial,
        parentTitles: body.parentTitles,
      });
      json(res, 200, { method: methodUsed });
      return;
    }

    if (method === "POST" && pathname === "/target/ui/scroll-collect") {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        maxScrolls?: number;
        allowSensitive?: boolean;
      };
      const serial = body.serial;
      if (!serial) throw new HttpError(400, "serial is required");
      await assertTargetControl(scope, serial);
      const collected = await scrollCollectControls({
        serial,
        maxScrolls: body.maxScrolls,
        extract: (nodes) =>
          exploreControls(nodes, {
            allowSensitive: body.allowSensitive === true,
          }),
      });
      json(res, 200, { controls: collected.controls, count: collected.controls.length });
      return;
    }

    if (method === "POST" && pathname === "/interact") {
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(
          400,
          "body.kind required (identifier|label|point|ref|find|text-match|swipe|key|type|replace)",
        );
      }
      const { serial, preview, ...input } = body as InteractInput & {
        serial?: string;
        preview?: unknown;
      };
      if (preview === true) {
        assertTargetObservation(scope, serial);
        const result = await previewInteract(input as InteractInput, { serial });
        json(res, 200, {
          ok: true,
          preview: true,
          mime: "image/png",
          base64: result.base64,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          inspectable: result.inspectable,
          ...(result.resolution ? { resolution: result.resolution } : {}),
        });
        return;
      }
      if (getActiveJob(serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      await assertTargetControl(scope, serial);
      const result = await interact(input as InteractInput, { serial });
      json(res, 200, {
        ok: true,
        ...(result.resolution ? { resolution: result.resolution } : {}),
      });
      return;
    }

    if (method === "POST" && pathname === "/step/run") {
      const body = (await parseJsonBody(req)) as { step?: unknown; serial?: string };
      if (!body || typeof body !== "object" || body.step === undefined) {
        throw new HttpError(400, "body.step is required");
      }
      await assertTargetControl(scope, body.serial);
      let steps;
      try {
        steps = validateRecipeSteps([body.step]);
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      const step = steps[0]!;
      if (step.kind === "pause") {
        throw new HttpError(400, "pause steps cannot run standalone");
      }
      if (getActiveJob(body.serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      // No connected device would surface as a confusing step-level failure
      // (e.g. "expect ... not visible") — report it plainly instead.
      let deviceCount = 0;
      try {
        deviceCount = (await listDevices()).length;
      } catch {
        deviceCount = 0;
      }
      if (deviceCount === 0) {
        json(res, 200, { ok: false, error: "No device connected", durationMs: 0, logs: [] });
        return;
      }
      const logs: string[] = [];
      const started = now();
      try {
        const serial = body.serial!;
        const platform = await devicePlatformForSerial(serial);
        if (!platform) throw new Error(`Target ${serial} is not connected`);
        await runWithTargetContext({ kind: "device", platform, serial }, async () => {
          await runRecipeStep(createDevice(), step, { log: (line) => logs.push(line) });
        });
        json(res, 200, { ok: true, durationMs: now() - started, logs });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 200, { ok: false, error: message, durationMs: now() - started, logs });
      }
      return;
    }

    if (await handleRunRoute({ method, pathname, url, request: req, response: res, scope })) return;

    if (method === "GET" && pathname === "/doctor") {
      const result = await runDoctor();
      json(
        res,
        result.ok ? 200 : 503,
        result.ok ? result : { ...result, error: doctorFailureMessage(result) },
      );
      return;
    }

    // Must be registered before /report/:jobId so "junit" is not treated as an id.
    if (method === "GET" && pathname === "/report/junit") {
      const limit = parseLimit(url.searchParams.get("limit"), 50);
      text(res, 200, toJunitXml(collectReports(limit, scope)), "text/xml; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/report") {
      const limit = parseLimit(url.searchParams.get("limit"), 20);
      json(res, 200, { reports: collectReports(limit, scope) });
      return;
    }

    const reportMatch = matchPath(pathname, "/report/:jobId");
    if (method === "GET" && reportMatch) {
      const job = getJob(reportMatch.jobId!);
      if (!job) throw new HttpError(404, "Job not found");
      if (
        !scope.localTrusted &&
        (job.projectId !== scope.projectId || job.ownerId !== scope.subject)
      ) {
        throw new HttpError(404, "Job not found");
      }
      json(res, 200, toJobReport(job));
      return;
    }

    if (method === "GET" && pathname === "/meta") {
      json(res, 200, {
        name: "relay",
        description: "Relay app graph authoring and testing server",
        version: PRODUCT_VERSION,
        runsDir: scope.localTrusted ? runsRoot() : "runs",
        operations: serverOperationManifest(),
        resources: [
          { method: "GET", path: "/events", mediaType: "text/event-stream" },
          { method: "GET", path: "/device/stream", mediaType: "application/x-relay-h264" },
          { method: "GET", path: "/runs/:id/frames/:file", mediaType: "image/*" },
          { method: "GET", path: "/runs/:id/video/:file", mediaType: "video/*" },
          { method: "GET", path: "/runs/:id/evidence", mediaType: "application/json" },
          { method: "GET", path: "/authoring-evidence/:sha256", mediaType: "image/*|video/*" },
        ],
      });
      return;
    }

    json(res, 404, { error: `Not found: ${method} ${pathname}` });
  } catch (err) {
    // Streaming routes have already committed their response by the time a
    // browser disconnect or decoder restart can reject. Attempting to send a
    // JSON error after that point crashes the entire local server with
    // ERR_HTTP_HEADERS_SENT. Close the abandoned stream and keep serving the
    // rest of Relay instead.
    if (res.headersSent || res.destroyed || res.writableEnded) {
      if (!res.destroyed && !res.writableEnded) res.destroy();
      return;
    }
    if (err instanceof RevisionConflict) {
      json(res, 409, { error: err.message, current: err.current });
      return;
    }
    if (err instanceof IdempotencyConflict) {
      json(res, 409, { error: err.message });
      return;
    }
    if (err instanceof OperationAuthorizationError) {
      json(res, 403, {
        error: err.message,
        code: "PROJECT_ROLE_REQUIRED",
        operationId: err.operationId,
        role: err.actualRole,
        requiredRole: err.requiredRole,
        recovery:
          "Use a Relay connection whose configured project role permits this operation, or ask a project administrator to perform it.",
      });
      return;
    }
    if (err instanceof OperationContractError) {
      const status = err.phase === "input" ? 400 : 500;
      const message =
        status === 500 && resolvedScope && !resolvedScope.localTrusted
          ? "Internal server error"
          : err.message;
      json(res, status, { error: message });
      return;
    }
    if (err instanceof HttpError) {
      // Structured context must augment the human-readable failure, never
      // replace it. Clients key off `error`; omitting it reduced actionable
      // replay failures to an opaque "422 Unprocessable Entity".
      json(res, err.status, { error: err.message, ...err.body });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    publish({ type: "error", at: now(), message, where: "server" });
    json(res, 500, {
      error: resolvedScope && !resolvedScope.localTrusted ? "Internal server error" : message,
    });
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  // Apply saved signing settings, then replace only a verified helper from a
  // different installed build. A matching daemon may own the only controllable
  // session on an unattended iPad and is deliberately preserved.
  await loadDeviceSetup();
  await restartAgentDeviceDaemonForBuildDrift();
  // Signing env is frozen at daemon spawn. Reconcile shell/stale identity drift
  // against the saved Apple setup so prepare does not fight automatic signing.
  await restartAgentDeviceDaemonForSigningEnvDrift();
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;
  const token = opts.token ?? process.env.RELAY_AUTH_TOKEN;
  const redaction = await loadRedactionPolicy();
  await loadEvidenceCollectionPolicy();
  for (const recoveryScope of await authoringSessions.recoveryScopes()) {
    const recoveryRequestId = crypto.randomUUID();
    await runWithOperationContext(
      {
        schemaVersion: 1,
        actorId: "system:authoring-recovery",
        actorKind: "system",
        organizationId: recoveryScope.organizationId,
        projectId: recoveryScope.projectId,
        operationId: "authoring.session.recover",
        requestId: recoveryRequestId,
        idempotencyKey: recoveryRequestId,
        issuedAt: now(),
      },
      () =>
        authoringSessions.recover({
          async releaseLease(session) {
            await releaseDeviceLease(session.leaseId, {
              projectId: session.projectId,
              ownerId: session.actorId,
            });
          },
          async reconcileRecording(session) {
            if (session.target.kind !== "device" || session.target.platform !== "ios") return;
            const take = await reconcileIosVideoTake(session.target.targetId);
            if (!take) return;
            const data = await readFile(take.path).catch(() => undefined);
            return data ? { data, mime: "video/mp4" } : undefined;
          },
        }),
    );
  }
  // App Map run entities are a rebuildable projection of immutable reports.
  // Reconcile before accepting requests so a crash can never leave Coverage
  // permanently behind the Run Observatory.
  await reconcilePersistedAppMapRuns();
  await pruneIosVideoTakes();
  assertSafeBinding(host, token);
  if (!isLoopbackHost(host) && !redaction.enabled) {
    throw new Error("Refusing a non-local binding while evidence redaction is disabled");
  }
  const sse = createSseHub(CORS_HEADERS);
  const server = http.createServer((req, res) => {
    void handleRequest(
      req,
      res,
      token,
      isLoopbackHost(host),
      sse,
      opts.authoringRuntime,
      opts.liveVideoStream,
      opts.captureTargetScreenshot,
      opts.targetRuntime,
    );
  });
  const scheduler = startScheduler();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : preferredPort;
  publish({ type: "server.ready", at: now(), host, port });

  return {
    port,
    host,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        scheduler.close();
        sse.close();
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await flushOperationActivity();
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const tokenIdx = argv.indexOf("--token");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const token = tokenIdx >= 0 ? argv[tokenIdx + 1] : process.env.RELAY_AUTH_TOKEN;
  const started = await startServer({
    port,
    host,
    token,
  });
  console.log(`@relay/server listening on http://${started.host}:${started.port}`);
  console.log(`  runs → ${runsRoot()}`);
}

const invokedDirectly =
  process.argv[1]?.endsWith("/server/src/index.ts") ||
  process.argv[1]?.endsWith("\\server\\src\\index.ts") ||
  process.argv[1]?.endsWith("/server/index.cjs") ||
  process.argv[1]?.endsWith("\\server\\index.cjs") ||
  process.argv[1]?.includes("@relay/server");

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
