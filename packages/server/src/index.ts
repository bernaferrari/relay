/**
 * HTTP + SSE API over @relay/core.
 * Jobs, traces, heal retries, persisted runs/, live capture.
 */
import http from "node:http";
import { join } from "node:path";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
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
  freezeRecipeGraph,
  formatSnapshotTree,
  formatRecipeYaml,
  formatMatrixYaml,
  parseMatrixYaml,
  getActiveJob,
  getActiveJobs,
  getJob,
  interact,
  IdempotencyConflict,
  listActionsWithTrace,
  listDevices,
  devicePlatformForSerial,
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
  toJobReport,
  toJunitXml,
  type InteractInput,
  type JobReport,
  generateValues,
  leaseDevice,
  listBuilds,
  listDeviceLeases,
  listDevicePools,
  listCompatibilityMatrices,
  readCompatibilityMatrix,
  listProjects,
  readJourney,
  readProjectVariables,
  releaseDeviceLease,
  saveBuild,
  saveDevicePool,
  saveCompatibilityMatrix,
  saveProject,
  writeJourney,
  writeProjectVariables,
  buildTestAtlas,
  listRecipeHistory,
  restoreRecipeHistory,
  recipeStability,
  listSchedules,
  saveSchedule,
  deleteSchedule,
  listTargets,
  readTarget,
  saveBrowserTarget,
  deleteTarget,
  deleteCompatibilityMatrix,
  preflightTarget,
  openBrowserTarget,
  buildTargetProfiles,
  createDiscoverySession,
  renameDiscoverySession,
  listDiscoverySessions,
  readDiscoverySession,
  readDiscoveryScreenAsset,
  recordObservedScreen,
  recordObservedTransition,
  setDiscoveryStatus,
  formatDiscoveryExport,
  isSensitiveDiscoveryAction,
  promoteDiscoveryPath,
  suggestDiscoveryControl,
  resolveCompatibilityMatrix,
  buildDiscoveryCoverage,
  type RecipeParameter,
  createSuiteRunManifest,
  deleteSuite,
  listSuiteHistory,
  listSuites,
  readSuite,
  restoreSuiteHistory,
  saveSuite,
  type SaveSuiteInput,
  getRedactionPolicy,
  getEvidenceCollectionPolicy,
  loadEvidenceCollectionPolicy,
  loadRedactionPolicy,
  RedactionPolicyLockedError,
  setRedactionEnabled,
  setSensitiveEvidenceConsent,
  inspectAppleDeviceSetup,
  inspectAndroidDeviceSetup,
  loadDeviceSetup,
  readDeviceSetup,
  runWithTargetContext,
  saveAppleDeviceSetup,
  restartAgentDeviceDaemonForSetup,
  resetDeviceClients,
  resetIosRunnerState,
  authoringSessions,
  runWithOperationContext,
  readAuthoringEvidence,
  listJourneyAggregates,
  findWorkspaceRoot,
  type AuthoringRuntime,
} from "@relay/core";
import { createSseHub } from "./sse.js";
import { startScheduler } from "./scheduler.js";
import { handleRunRoute } from "./run-routes.js";
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
  streamAndroidVideo,
  type AndroidKeyboardInput,
  type AndroidTouchAction,
} from "./live-video.js";
import {
  readIosVideoTake,
  pruneIosVideoTakes,
  reconcileIosVideoTake,
  startIosVideoTake,
  stopIosVideoTake,
} from "./ios-video-capture.js";
import {
  bindOperationRequest,
  OperationContractError,
  serverOperationManifest,
} from "./operations.js";
import { handleAuthoringActionReplace, handleAuthoringRoute } from "./authoring-routes.js";
import { handleActivityRoute, recordOperationActivity } from "./activity-routes.js";
import { handleAppMapRoute } from "./app-map-routes.js";
import { handleAppMapRunRoute } from "./app-map-run-routes.js";
import {
  handleTargetRuntimeRoute,
  type TargetRuntimeRouteRuntime,
} from "./target-runtime-routes.js";
import {
  createCollaborationRouteService,
  handleCollaborationRoute,
  type CollaborationRouteService,
} from "./collaboration-routes.js";
import type { CollaborationAwarenessService } from "./collaboration-awareness.js";
import {
  DurableCollaborativeJourneyStore,
  LocalCollaborativeJourneyStorageProvider,
} from "./collaborative-journey-store.js";
import { createReadStream } from "node:fs";
import type {
  Build,
  DevicePool,
  GenerationRequest,
  JourneyMetadata,
  Project,
  RevisionWrite,
  TestVariable,
  SensitiveEvidenceChannel,
  ActorKind,
} from "@relay/protocol";

export type StartServerOptions = {
  port?: number;
  host?: string;
  token?: string;
  authoringRuntime?: AuthoringRuntime;
  /** Test seam for the host-owned Android stream transport. */
  liveVideoStream?: (response: http.ServerResponse, serial: string) => Promise<void>;
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>;
  collaboration?: {
    enabled: boolean;
    store?: DurableCollaborativeJourneyStore;
    awareness?: CollaborationAwarenessService;
    clock?: () => number;
  };
};

export type StartedServer = {
  port: number;
  host: string;
  close: () => Promise<void>;
};

function discoveryInteraction(input: InteractInput): {
  kind: "tap" | "type" | "scroll" | "back" | "manual";
  label?: string;
  target?: { ref?: string; label?: string; text?: string; point?: { x: number; y: number } };
  text?: string;
  direction?: "up" | "down";
} {
  switch (input.kind) {
    case "label":
      return { kind: "tap", label: input.label, target: { label: input.label } };
    case "ref":
      return { kind: "tap", label: input.ref, target: { ref: input.ref } };
    case "text-match":
      return { kind: "tap", label: input.match, target: { text: input.match } };
    case "find":
      return { kind: "tap", label: input.query, target: { text: input.query } };
    case "point":
      return {
        kind: "tap",
        label: "Coordinate tap",
        target: { point: { x: input.x, y: input.y } },
      };
    case "swipe":
      return {
        kind: "scroll",
        label: "Swipe",
        direction: input.to.y < input.from.y ? "down" : "up",
      };
    case "type":
      return { kind: "type", label: "Type text", text: input.text };
  }
}

/** In-memory job reports, newest first. Falls back empty when none. */
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
  if (!leaseId) throw new HttpError(403, "A target lease is required for live streaming");
  const lease = (await listDeviceLeases(scope.projectId)).find(
    (candidate) =>
      candidate.id === leaseId &&
      candidate.deviceSerial === targetId &&
      candidate.status === "leased" &&
      candidate.expiresAt > now(),
  );
  const requestedActorHeader = request.headers["x-relay-actor-id"];
  let requestedActor: { actorId: string; actorKind: ActorKind } | undefined;
  if (requestedActorHeader !== undefined) {
    try {
      requestedActor = resolveCommandActor(request.headers, scope);
    } catch (error) {
      throw new HttpError(403, error instanceof Error ? error.message : String(error));
    }
  }
  const attributable =
    lease &&
    (!requestedActor || requestedActor.actorId === lease.ownerId) &&
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
    operationId: "target.stream.open",
    requestId,
    idempotencyKey: requestId,
    issuedAt: now(),
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token?: string,
  localTrusted = true,
  sse = createSseHub(CORS_HEADERS),
  authoringRuntime?: AuthoringRuntime,
  collaboration?: CollaborationRouteService,
  liveVideoStream = streamAndroidVideo,
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

  if (!authorizationMatches(req.headers.authorization, token)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="relay"');
    json(res, 401, { error: "Authentication required" });
    return;
  }

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
    if (!scope.localTrusted && isLocalWorkspacePath(pathname)) {
      recordAudit(scope, { action: "workspace.access", resource: pathname, result: "deny" });
      throw new HttpError(403, "This workspace asset is available only from the local Relay host");
    }
    const operation = bindOperationRequest(req, res, method, pathname, url, scope);
    if (await handleActivityRoute({ method, pathname, url, response: res, scope })) return;
    if (operation) await recordOperationActivity({ operation, pathname, scope });
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
      await handleCollaborationRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
        service: collaboration,
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
    if (method === "GET" && pathname === "/settings/privacy") {
      json(res, 200, { policy: getRedactionPolicy() });
      return;
    }
    if (method === "PUT" && pathname === "/settings/privacy") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Privacy settings can only be changed from a local Relay host");
      }
      const body = (await parseJsonBody(req)) as { enabled?: unknown };
      if (typeof body.enabled !== "boolean") {
        throw new HttpError(400, "enabled must be a boolean");
      }
      try {
        json(res, 200, { policy: await setRedactionEnabled(body.enabled) });
      } catch (error) {
        if (error instanceof RedactionPolicyLockedError) {
          throw new HttpError(409, error.message);
        }
        throw error;
      }
      return;
    }
    if (method === "GET" && pathname === "/settings/evidence") {
      json(res, 200, { policy: getEvidenceCollectionPolicy() });
      return;
    }
    if (method === "GET" && pathname === "/settings/devices/apple") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Device setup can only be read from a local Relay host");
      }
      json(res, 200, await inspectAppleDeviceSetup());
      return;
    }
    if (method === "GET" && pathname === "/settings/devices/apple/preflight") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Device setup can only be read from a local Relay host");
      }
      // Stage startup only needs to know whether the runner has been configured.
      // Keep it filesystem-only: the fuller Settings check runs Xcode commands and
      // can take seconds on first use.
      const setup = await readDeviceSetup();
      json(res, 200, { configured: Boolean(setup.ios) });
      return;
    }
    if (method === "GET" && pathname === "/settings/devices/android") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Device setup can only be read from a local Relay host");
      }
      json(res, 200, await inspectAndroidDeviceSetup());
      return;
    }
    if (method === "PUT" && pathname === "/settings/devices/apple") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Device setup can only be changed from a local Relay host");
      }
      const body = (await parseJsonBody(req)) as {
        teamId?: unknown;
        bundleId?: unknown;
        signingIdentity?: unknown;
        provisioningProfile?: unknown;
      };
      if (typeof body.teamId !== "string" || typeof body.bundleId !== "string") {
        throw new HttpError(400, "teamId and bundleId are required");
      }
      const setup = await saveAppleDeviceSetup({
        teamId: body.teamId,
        bundleId: body.bundleId,
        ...(typeof body.signingIdentity === "string"
          ? { signingIdentity: body.signingIdentity }
          : {}),
        ...(typeof body.provisioningProfile === "string"
          ? { provisioningProfile: body.provisioningProfile }
          : {}),
      });
      resetDeviceClients();
      resetIosRunnerState();
      await restartAgentDeviceDaemonForSetup();
      json(res, 200, { setup });
      return;
    }
    if (method === "PUT" && pathname === "/settings/evidence") {
      if (!scope.localTrusted) {
        throw new HttpError(403, "Evidence consent can only be changed from a local Relay host");
      }
      const body = (await parseJsonBody(req)) as {
        channel?: unknown;
        enabled?: unknown;
        reason?: unknown;
      };
      if (body.channel !== "audio" && body.channel !== "crash" && body.channel !== "network-body") {
        throw new HttpError(400, "channel must be audio, crash, or network-body");
      }
      if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
      if (body.reason !== undefined && typeof body.reason !== "string") {
        throw new HttpError(400, "reason must be a string");
      }
      const policy = await setSensitiveEvidenceConsent({
        channel: body.channel as SensitiveEvidenceChannel,
        enabled: body.enabled,
        grantedBy: scope.subject,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      });
      recordAudit(scope, {
        action: body.enabled ? "evidence.consent.grant" : "evidence.consent.revoke",
        resource: body.channel,
        result: "allow",
      });
      json(res, 200, { policy });
      return;
    }
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
        runsDir: runsRoot(),
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

    if (method === "GET" && pathname === "/targets") {
      json(res, 200, { targets: await listTargets() });
      return;
    }

    if (method === "POST" && pathname === "/targets") {
      const body = (await parseJsonBody(req)) as {
        id?: string;
        name?: string;
        startUrl?: string;
        headless?: boolean;
      };
      if (!body.name || !body.startUrl) throw new HttpError(400, "name and startUrl are required");
      json(res, 201, {
        target: await saveBrowserTarget({
          id: body.id,
          name: body.name,
          startUrl: body.startUrl,
          headless: body.headless,
        }),
      });
      return;
    }

    const targetMatch = matchPath(pathname, "/targets/:id");
    if (method === "DELETE" && targetMatch) {
      await deleteTarget(targetMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    const targetPreflightMatch = matchPath(pathname, "/targets/:id/preflight");
    if (method === "POST" && targetPreflightMatch) {
      const target = await readTarget(targetPreflightMatch.id!);
      if (!target) throw new HttpError(404, "Target not found");
      json(res, 200, { preflight: await preflightTarget(target) });
      return;
    }

    const targetOpenMatch = matchPath(pathname, "/targets/:id/open");
    if (method === "POST" && targetOpenMatch) {
      const target = await readTarget(targetOpenMatch.id!);
      if (!target) throw new HttpError(404, "Target not found");
      if (target.kind !== "browser") throw new HttpError(400, "Target is not a browser");
      json(res, 200, { session: await openBrowserTarget(target.id) });
      return;
    }

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

    if (method === "GET" && pathname === "/discovery") {
      json(res, 200, { sessions: await listDiscoverySessions() });
      return;
    }

    if (method === "POST" && pathname === "/discovery") {
      const body = (await parseJsonBody(req)) as {
        name?: string;
        targetId?: string;
        scope?: import("@relay/protocol").DiscoveryScope;
      };
      if (!body.name || !body.targetId) throw new HttpError(400, "name and targetId are required");
      const profiles = buildTargetProfiles({
        devices: await listDevices().catch(() => []),
        targets: await listTargets(),
      });
      const session = await createDiscoverySession({
        name: body.name,
        targetId: body.targetId,
        targetProfile: profiles.find((profile) => profile.targetId === body.targetId),
        scope: body.scope,
      });
      json(res, 201, { session });
      return;
    }

    const discoveryRenameMatch = matchPath(pathname, "/discovery/:id/name");
    if (method === "POST" && discoveryRenameMatch) {
      const body = (await parseJsonBody(req)) as { name?: string };
      if (!body.name?.trim()) throw new HttpError(400, "name is required");
      json(res, 200, {
        session: await renameDiscoverySession(discoveryRenameMatch.id!, body.name),
      });
      return;
    }

    const discoveryMatch = matchPath(pathname, "/discovery/:id");
    if (method === "GET" && discoveryMatch) {
      const session = await readDiscoverySession(discoveryMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { session });
      return;
    }

    const discoveryStatusMatch = matchPath(pathname, "/discovery/:id/status");
    if (method === "POST" && discoveryStatusMatch) {
      const body = (await parseJsonBody(req)) as {
        status?: import("@relay/protocol").DiscoveryStatus;
      };
      if (!body.status) throw new HttpError(400, "status is required");
      json(res, 200, { session: await setDiscoveryStatus(discoveryStatusMatch.id!, body.status) });
      return;
    }

    const discoverySuggestionMatch = matchPath(pathname, "/discovery/:id/suggestion");
    if (method === "GET" && discoverySuggestionMatch) {
      const session = await readDiscoverySession(discoverySuggestionMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { suggestion: suggestDiscoveryControl(session) });
      return;
    }

    const discoveryCoverageMatch = matchPath(pathname, "/discovery/:id/coverage");
    if (method === "GET" && discoveryCoverageMatch) {
      const session = await readDiscoverySession(discoveryCoverageMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      json(res, 200, { coverage: buildDiscoveryCoverage(session, await listDiscoverySessions()) });
      return;
    }

    const discoveryCaptureMatch = matchPath(pathname, "/discovery/:id/capture");
    if (method === "POST" && discoveryCaptureMatch) {
      const session = await readDiscoverySession(discoveryCaptureMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      await assertTargetControl(scope, session.targetId);
      const snap = await captureSnapshot({ serial: session.targetId });
      const shot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const captured = await recordObservedScreen({
        sessionId: session.id,
        nodes: snap.nodes,
        screenshotPath: shot.path,
        makeCurrent: true,
      }).finally(() => cleanupScreenshot(shot.path));
      json(res, 201, { screen: captured.screen, isNew: captured.isNew, session: captured.session });
      return;
    }

    const discoveryInteractMatch = matchPath(pathname, "/discovery/:id/interact");
    if (method === "POST" && discoveryInteractMatch) {
      const session = await readDiscoverySession(discoveryInteractMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      await assertTargetControl(scope, session.targetId);
      if (session.status !== "running") {
        throw new HttpError(409, "Start or resume this Discovery Map before interacting");
      }
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(400, "body.kind required for Discovery Map interaction");
      }
      const { serial: _serial, ...raw } = body;
      const input = raw as InteractInput;
      const observed = discoveryInteraction(input);
      if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(observed)) {
        throw new HttpError(403, "Discovery policy blocks this sensitive interaction");
      }
      const beforeSnapshot = await captureSnapshot({ serial: session.targetId });
      const beforeShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const before = await recordObservedScreen({
        sessionId: session.id,
        nodes: beforeSnapshot.nodes,
        screenshotPath: beforeShot.path,
        makeCurrent: true,
      }).finally(() => cleanupScreenshot(beforeShot.path));
      await interact(input, { serial: session.targetId });
      const afterSnapshot = await captureSnapshot({ serial: session.targetId });
      const afterShot = await captureScreenshot({ serial: session.targetId, ephemeral: true });
      const after = await recordObservedScreen({
        sessionId: session.id,
        nodes: afterSnapshot.nodes,
        screenshotPath: afterShot.path,
        makeCurrent: true,
      }).finally(() => cleanupScreenshot(afterShot.path));
      const transition = await recordObservedTransition({
        sessionId: session.id,
        fromScreenId: before.screen.id,
        ...(before.screen.id !== after.screen.id ? { toScreenId: after.screen.id } : {}),
        ...observed,
        changedScreen: before.screen.id !== after.screen.id,
      });
      json(res, 201, { transition, before: before.screen, after: after.screen });
      return;
    }

    const discoveryScreenMatch = matchPath(pathname, "/discovery/:id/screens/:screenId");
    if (method === "GET" && discoveryScreenMatch) {
      const asset = await readDiscoveryScreenAsset(
        discoveryScreenMatch.id!,
        discoveryScreenMatch.screenId!,
      );
      if (!asset) throw new HttpError(404, "Discovery screenshot not found");
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": asset.byteLength,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...CORS_HEADERS,
      });
      res.end(asset);
      return;
    }

    const discoveryPromoteMatch = matchPath(pathname, "/discovery/:id/promote");
    if (method === "POST" && discoveryPromoteMatch) {
      const body = (await parseJsonBody(req)) as {
        transitionIds?: string[];
        recipeId?: string;
        title?: string;
        description?: string;
        transitionLabels?: Record<string, string>;
      };
      if (!Array.isArray(body.transitionIds) || !body.recipeId || !body.title) {
        throw new HttpError(400, "transitionIds, recipeId, and title are required");
      }
      try {
        const promoted = await promoteDiscoveryPath({
          sessionId: discoveryPromoteMatch.id!,
          transitionIds: body.transitionIds,
          recipeId: body.recipeId,
          title: body.title,
          description: body.description,
          transitionLabels: body.transitionLabels,
        });
        json(res, 201, promoted);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const discoveryExportMatch = matchPath(pathname, "/discovery/:id/export");
    if (method === "GET" && discoveryExportMatch) {
      const session = await readDiscoverySession(discoveryExportMatch.id!);
      if (!session) throw new HttpError(404, "Discovery session not found");
      const format = url.searchParams.get("format") === "markdown" ? "markdown" : "json";
      text(
        res,
        200,
        formatDiscoveryExport(session, format),
        format === "markdown" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
      );
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
      json(res, 200, { leases: await listDeviceLeases(scope.projectId) });
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
          expiresAt: body.expiresAt ?? now() + 15 * 60_000,
        });
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
      json(res, 201, { lease });
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
      const body = (await parseJsonBody(req)) as RevisionWrite<TestVariable[]>;
      if (!Number.isInteger(body.expectedRevision) || !Array.isArray(body.value)) {
        throw new HttpError(400, "expectedRevision and value are required");
      }
      body.idempotencyKey ||= req.headers["idempotency-key"] as string | undefined;
      json(res, 200, await writeProjectVariables(scope.projectId, body));
      return;
    }

    const journeyMatch = matchPath(pathname, "/journeys/:id/document");
    if (method === "GET" && journeyMatch) {
      json(res, 200, await readJourney(scope.projectId, journeyMatch.id!));
      return;
    }
    if (method === "PUT" && journeyMatch) {
      const body = (await parseJsonBody(req)) as RevisionWrite<JourneyMetadata>;
      if (
        !Number.isInteger(body.expectedRevision) ||
        !body.value?.positions ||
        !body.value?.edgeLabels ||
        !body.value?.edgeKinds
      ) {
        throw new HttpError(400, "expectedRevision and Journey metadata are required");
      }
      body.idempotencyKey ||= req.headers["idempotency-key"] as string | undefined;
      json(res, 200, await writeJourney(scope.projectId, journeyMatch.id!, body));
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

    // ---- Collection CRUD and execution ----
    if (method === "GET" && pathname === "/collections") {
      json(res, 200, { collections: await listSuites() });
      return;
    }

    if (method === "POST" && pathname === "/collections") {
      const body = (await parseJsonBody(req)) as SaveSuiteInput;
      if (body.expectedRevision !== 0)
        throw new HttpError(409, "New Collections require revision 0");
      try {
        const collection = await saveSuite(body);
        json(res, 201, { collection });
      } catch (error) {
        if (error instanceof RevisionConflict || error instanceof IdempotencyConflict) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const suiteHistoryMatch = matchPath(pathname, "/collections/:id/history");
    if (method === "GET" && suiteHistoryMatch) {
      json(res, 200, { history: await listSuiteHistory(suiteHistoryMatch.id!) });
      return;
    }

    const suiteRestoreMatch = matchPath(pathname, "/collections/:id/restore");
    if (method === "POST" && suiteRestoreMatch) {
      const body = (await parseJsonBody(req)) as { updatedAt?: number };
      if (!Number.isFinite(body.updatedAt)) throw new HttpError(400, "updatedAt is required");
      try {
        const collection = await restoreSuiteHistory(suiteRestoreMatch.id!, body.updatedAt!);
        json(res, 200, { collection });
      } catch (error) {
        throw new HttpError(404, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const suiteRunMatch = matchPath(pathname, "/collections/:id/run");
    if (method === "POST" && suiteRunMatch) {
      const suite = await readSuite(suiteRunMatch.id!);
      if (!suite) throw new HttpError(404, "Collection not found");
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        platform?: "android" | "ios";
        targetKind?: "device" | "browser";
        browserTargetId?: string;
      };
      await assertTargetControl(scope, body.browserTargetId ?? body.serial);
      const recipes = await listRecipes();
      let manifest;
      try {
        manifest = createSuiteRunManifest(suite, recipes);
      } catch (error) {
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
      if (manifest.entries.length === 0)
        throw new HttpError(409, "This collection has no enabled Journeys");
      const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
      for (const entry of manifest.entries) {
        const current = recipesById.get(entry.testId);
        if (current && current.updatedAt !== entry.testUpdatedAt) {
          throw new HttpError(
            409,
            `“${current.title}” is pinned to an earlier version. Restore it or follow latest before running.`,
          );
        }
      }
      const recipeGraphs = new Map(
        await Promise.all(
          manifest.entries.map(async (entry) => {
            const recipe = recipesById.get(entry.testId)!;
            return [entry.testId, await freezeRecipeGraph(recipe)] as const;
          }),
        ),
      );
      const jobs = manifest.entries.map((entry, index) => {
        const recipe = recipesById.get(entry.testId)!;
        return enqueueJob({
          recipe: entry.testId,
          title: recipe.title,
          serial: body.serial,
          platform: body.platform,
          targetKind: body.targetKind,
          browserTargetId: body.browserTargetId,
          variables: entry.inputs,
          recipeSnapshot: structuredClone(recipe),
          recipeGraph: recipeGraphs.get(entry.testId),
          batchId: manifest.id,
          caseIndex: index,
          caseCount: manifest.entries.length,
          artifacts: [
            {
              kind: "suite-run-manifest",
              capturedAt: manifest.createdAt,
              data: { manifest, entry },
            },
          ],
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
        });
      });
      json(res, 202, { manifest, jobs });
      return;
    }

    const suiteMatch = matchPath(pathname, "/collections/:id");
    if (method === "GET" && suiteMatch) {
      const suite = await readSuite(suiteMatch.id!);
      if (!suite) throw new HttpError(404, "Collection not found");
      json(res, 200, { collection: suite });
      return;
    }
    if (method === "PUT" && suiteMatch) {
      const body = (await parseJsonBody(req)) as SaveSuiteInput;
      try {
        const collection = await saveSuite({ ...body, id: suiteMatch.id! });
        json(res, 200, { collection });
      } catch (error) {
        if (error instanceof RevisionConflict || error instanceof IdempotencyConflict) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (method === "DELETE" && suiteMatch) {
      await deleteSuite(suiteMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/journeys") {
      json(res, 200, { journeys: await listRecipes() });
      return;
    }

    if (method === "GET" && pathname === "/atlas") {
      json(res, 200, { atlas: buildTestAtlas(await listRecipes()) });
      return;
    }

    if (method === "GET" && pathname === "/schedules") {
      json(res, 200, { schedules: await listSchedules() });
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
      await deleteSchedule(scheduleMatch.id!);
      json(res, 200, { ok: true });
      return;
    }

    const recipeEvidenceImageMatch = matchPath(pathname, "/journeys/:id/evidence/:evidenceId");
    if (method === "GET" && recipeEvidenceImageMatch) {
      const image = await readRecipeEvidenceImage(
        recipeEvidenceImageMatch.id!,
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
      const [sessions, aggregates] = await Promise.all([
        authoringSessions.list(scope.projectId),
        listJourneyAggregates(scope.projectId),
      ]);
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
        aggregates.some((aggregate) => aggregate.evidence.some((evidence) => evidence.uri === uri));
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

    const recipeHistoryMatch = matchPath(pathname, "/journeys/:id/history");
    if (method === "GET" && recipeHistoryMatch) {
      json(res, 200, { versions: await listRecipeHistory(recipeHistoryMatch.id!) });
      return;
    }
    if (method === "POST" && recipeHistoryMatch) {
      const body = (await parseJsonBody(req)) as { updatedAt?: number };
      if (!Number.isFinite(body.updatedAt)) throw new HttpError(400, "updatedAt is required");
      try {
        json(res, 200, {
          journey: await restoreRecipeHistory(recipeHistoryMatch.id!, body.updatedAt!),
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const recipeStabilityMatch = matchPath(pathname, "/journeys/:id/stability");
    if (method === "GET" && recipeStabilityMatch) {
      json(res, 200, { stability: await recipeStability(recipeStabilityMatch.id!) });
      return;
    }

    const recipeYamlMatch = matchPath(pathname, "/journeys/:id/yaml");
    if (method === "GET" && recipeYamlMatch) {
      const recipe = await readRecipe(recipeYamlMatch.id!);
      if (!recipe) throw new HttpError(404, "Journey not found");
      const yaml = formatRecipeYaml(recipe);
      // The HTTP API defaults to JSON while direct links, curl, and Git tooling
      // receive the portable source file. Keeping both forms at one address
      // avoids an app-only serialization format.
      if (req.headers.accept?.includes("application/json")) json(res, 200, { yaml });
      else text(res, 200, yaml, "application/yaml; charset=utf-8");
      return;
    }

    if (method === "POST" && pathname === "/journeys/import") {
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
              journey: parsed,
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
        json(res, 201, { journey: recipe });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const recipeEvidenceMatch = matchPath(pathname, "/journeys/:id/evidence");
    if (method === "POST" && recipeEvidenceMatch) {
      const recipe = await readRecipe(recipeEvidenceMatch.id!);
      if (!recipe) throw new HttpError(404, "Journey not found");
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

    const recipeMatch = matchPath(pathname, "/journeys/:id");
    if (method === "GET" && recipeMatch) {
      const recipe = await readRecipe(recipeMatch.id!);
      if (!recipe) throw new HttpError(404, "Journey not found");
      json(res, 200, { journey: recipe });
      return;
    }

    if (method === "POST" && pathname === "/journeys") {
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
      if (body.expectedRevision !== 0) throw new HttpError(409, "New Journeys require revision 0");
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
      json(res, 201, { journey: recipe });
      return;
    }

    if (method === "PUT" && recipeMatch) {
      const id = recipeMatch.id!;
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
      json(res, 200, { journey: recipe });
      return;
    }

    if (method === "DELETE" && recipeMatch) {
      try {
        await deleteRecipe(recipeMatch.id!);
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
        action: runMatch.id!,
        serial: body.serial,
        platform: body.platform,
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
      assertTargetObservation(scope, serial);
      const snap = await captureSnapshot({ serial, interactiveOnly });
      const tree = formatSnapshotTree(snap.nodes);
      json(res, 200, { ...snap, tree });
      return;
    }

    if (method === "GET" && pathname === "/screenshot") {
      const serial = url.searchParams.get("serial") ?? undefined;
      const caption = url.searchParams.get("caption") ?? undefined;
      const jobId = url.searchParams.get("jobId") ?? undefined;
      const ephemeral = url.searchParams.get("ephemeral") === "1";
      assertTargetObservation(scope, serial);
      const shot = await captureScreenshot({
        serial,
        caption: caption ?? undefined,
        jobId,
        ephemeral,
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
        await assertTargetLease(scope, serial, leaseId);
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
      await injectAndroidKey(serial, input);
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

    if (method === "POST" && pathname === "/interact") {
      const body = (await parseJsonBody(req)) as InteractInput & { serial?: string };
      if (!body || typeof body !== "object" || !("kind" in body)) {
        throw new HttpError(400, "body.kind required (label|point|ref|find|text-match|swipe|type)");
      }
      const { serial, ...input } = body;
      if (getActiveJob(serial)?.status === "running") {
        throw new HttpError(
          409,
          "A job is running — pause or cancel it before interacting manually",
        );
      }
      await assertTargetControl(scope, serial);
      await interact(input as InteractInput, { serial });
      json(res, 200, { ok: true });
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
      json(res, result.ok ? 200 : 503, result);
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
        runsDir: runsRoot(),
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
    if (err instanceof OperationContractError) {
      json(res, err.phase === "input" ? 400 : 500, { error: err.message });
      return;
    }
    if (err instanceof HttpError) {
      json(res, err.status, err.body ?? { error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    publish({ type: "error", at: now(), message, where: "server" });
    json(res, 500, { error: message });
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  // Settings are applied once in the server process, rather than requiring a
  // person to export device-specific variables before launching Relay.
  await loadDeviceSetup();
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;
  const token = opts.token ?? process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN;
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
            return { data: await readFile(take.path), mime: "video/mp4" };
          },
        }),
    );
  }
  await pruneIosVideoTakes();
  assertSafeBinding(host, token);
  if (!isLoopbackHost(host) && !redaction.enabled) {
    throw new Error("Refusing a non-local binding while evidence redaction is disabled");
  }
  const sse = createSseHub(CORS_HEADERS);
  let collaboration: CollaborationRouteService | undefined;
  if (opts.collaboration?.enabled) {
    if (!opts.collaboration.store) {
      throw new Error("Collaboration is enabled but no durable store was configured");
    }
    collaboration = createCollaborationRouteService({
      store: opts.collaboration.store,
      ...(opts.collaboration.awareness ? { awareness: opts.collaboration.awareness } : {}),
      ...(opts.collaboration.clock ? { clock: opts.collaboration.clock } : {}),
    });
  }

  const server = http.createServer((req, res) => {
    void handleRequest(
      req,
      res,
      token,
      isLoopbackHost(host),
      sse,
      opts.authoringRuntime,
      collaboration,
      opts.liveVideoStream,
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        scheduler.close();
        sse.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const tokenIdx = argv.indexOf("--token");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const token =
    tokenIdx >= 0
      ? argv[tokenIdx + 1]
      : (process.env.RELAY_AUTH_TOKEN ?? process.env.GROK_DEVICE_AUTH_TOKEN);
  const collaborationEnabled = process.env.RELAY_COLLABORATION_ENABLED === "true";
  const collaboration = collaborationEnabled
    ? {
        enabled: true as const,
        store: new DurableCollaborativeJourneyStore({
          storage: new LocalCollaborativeJourneyStorageProvider({
            rootDirectory: join(
              process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(),
              ".relay",
            ),
          }),
        }),
      }
    : undefined;
  const started = await startServer({
    port,
    host,
    token,
    ...(collaboration ? { collaboration } : {}),
  });
  console.log(`@relay/server listening on http://${started.host}:${started.port}`);
  console.log(`  runs → ${runsRoot()}`);
  if (collaborationEnabled) console.log("  collaboration → enabled");
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
