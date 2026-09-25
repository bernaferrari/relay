/** HTTP + SSE API over @relay/core: jobs, evidence, recovery, and live capture. */
import http from "node:http";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import {
  authenticatedBrowserOrigin,
  allowedBrowserOrigin,
  assertExplicitRemoteServiceTokenScope,
  isLocalWorkspacePath,
  assertSafeBinding,
  authenticateRequest,
  configuredBrowserOrigins,
  isLoopbackHost,
  listAuditEvents,
  recordAudit,
  resolveRequestContext,
  type RequestContext,
} from "./security.js";
import { liveEventVisible } from "./live-event-scope.js";
import type { ExternalIdentityVerifier } from "./external-identity.js";
export {
  verifiedExternalIdentity,
  type ExternalIdentityInput,
  type ExternalIdentityVerifier,
  type ExternalIdentityVerificationRequest,
  type VerifiedExternalIdentity,
} from "./external-identity.js";
export {
  ProofCheckPublishError,
  publishGitHubProofCheck,
  type GitHubProofCheckConfig,
  type PublishedProofCheck,
} from "./github-proof-check.js";
export { publishChangeProofToGitHub } from "./change-proof-github-publisher.js";
export * from "./github-proof-intake.js";
import { githubProofWebhookConfigurationFromEnvironment as githubWebhookFromEnv } from "./github-proof-intake.js";
import {
  captureScreenshot,
  currentOperationContext,
  defaultTargetDriverRegistry,
  enqueueJob,
  getActiveJobs,
  getJob,
  listActionsWithTrace,
  listAndroidDevicesFast,
  listDevices,
  publicShareBaseUrl,
  resolveJobDevicePlatform,
  bootDevice,
  requestAndroidAuthorization,
  listJobs,
  listTargetWorkers,
  now,
  publish,
  runsRoot,
  runDoctor,
  doctorFailureMessage,
  toJobReport,
  toJunitXml,
  releaseDeviceLease,
  listTargets,
  loadEvidenceCollectionPolicy,
  loadRedactionPolicy,
  loadDeviceSetup,
  restartAgentDeviceDaemonForBuildDrift,
  restartAgentDeviceDaemonForSigningEnvDrift,
  authoringSessions,
  runWithOperationContext,
  recoverCollaborationState,
  recoverDurableWorkerAssignments,
  pruneExpiredShares,
  acquireRelayStateServerLease,
  beginDurableWorkerServerLifecycle,
  type AuthoringRuntime,
  type RelayStateServerLease,
} from "@relay/core";
import { cleanupAbandonedAndroidPacketCaptures } from "./startup-cleanup.js";
import { collectVisibleReports } from "./report-access.js";
import { createSseHub } from "./sse.js";
import { startScheduler } from "./scheduler.js";
import { runDueSchedulesWithCombineStarter } from "./scheduler-combine.js";
import { createRequestHandlerLifecycle } from "./request-handler-lifecycle.js";
import { createFailClosedServerShutdown } from "./server-shutdown.js";
import { createTargetRuntimeScope } from "./target-runtime-scope.js";
import { shutdownServerSessions } from "./server-session-shutdown.js";
import { handleRunRoute, type RunRouteRuntime } from "./run-routes.js";
import { handleCaptureReferenceRoute } from "./capture-reference-routes.js";
import { createPreAuthenticatedRoute } from "./pre-authenticated-routes.js";
import { handleJobRoute, scopedActiveJob, type JobRouteRuntime } from "./job-routes.js";
import { assertTargetControl } from "./access-control.js";
import {
  browserCaseProfileForAdmission,
  browserCaseProfileIfManaged,
  rejectBlockedClaimedBrowserJob,
} from "./claimed-browser-job-admission.js";
import {
  CORS_HEADERS,
  HttpError,
  json,
  matchPath,
  parseJsonBody,
  parseLimit,
  text,
} from "./http.js";
import { streamTargetVideo } from "./target-video-stream.js";
import { pruneIosVideoTakes, reconcileIosVideoTake } from "./ios-video-capture.js";
import { bindOperationRequest, serverOperationManifest } from "./operations.js";
import { handleAuthoringActionReplace, handleAuthoringRoute } from "./authoring-routes.js";
import {
  flushOperationActivity,
  handleActivityRoute,
  recordOperationActivity,
} from "./activity-routes.js";
import { handleDiscoveryRoute } from "./discovery-routes.js";
import { handlePresenceRoute } from "./presence-routes.js";
import { handleSettingsRoute } from "./settings-routes.js";
import { handleTargetRoute } from "./target-routes.js";
import { handleManualTargetRoute } from "./manual-target-routes.js";
import { handleTargetObservationRoute } from "./target-observation-route.js";
import { handleControlPlaneRoute } from "./control-plane-routes.js";
import { handleWorkspaceRoute } from "./workspace-routes.js";
import { handleInteractionRoute } from "./interaction-routes.js";
import {
  createGoalRouteRuntimeBinding,
  dispatchGoalRoute,
  type GoalRouteRuntimeFactory,
} from "./goal-routes.js";
import { handleStepRunRoute, type StepRunRouteRuntime } from "./step-run-route.js";
import { handleAndroidAvdRoute } from "./android-avd-routes.js";
import type { AppMapTestRunRouteRuntime } from "./app-map-run-routes.js";
import type { CampaignDurationRouteRuntime } from "./campaign-duration-routes.js";
import type { TargetRuntimeRouteRuntime } from "./target-runtime-routes.js";
import type { StartServerOptions, StartedServer } from "./server-types.js";
import type { WorkflowRouteRuntime } from "./workflow-routes.js";
import { handlePrimaryOperationRoutes } from "./primary-operation-routes.js";
import type { ChangeVerificationRouteRuntime } from "./change-verification-routes.js";
import { createProofRuntimeBootstrap } from "./proof-runtime-bootstrap.js";
import { runServerCliIfInvoked } from "./server-cli.js";
import { requestsBearerAuthentication, setCorsOrigin } from "./cors.js";
import { respondToRequestError } from "./request-error-response.js";
export type { StartServerOptions, StartedServer } from "./server-types.js";

const serverStartedAt = Date.now();
let lastKnownDeviceCount: number | null = null;
const PRODUCT_VERSION = "0.1.0";

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token?: string,
  externalIdentityVerifier?: ExternalIdentityVerifier,
  localTrusted = true,
  browserOrigins: readonly string[] = [],
  sse = createSseHub(CORS_HEADERS),
  authoringRuntime?: AuthoringRuntime,
  liveVideoStream = streamTargetVideo,
  captureTargetScreenshot = captureScreenshot,
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>,
  appMapTestRunRuntime?: Partial<AppMapTestRunRouteRuntime>,
  jobRouteRuntime?: Partial<JobRouteRuntime>,
  workflowRouteRuntime?: Partial<WorkflowRouteRuntime>,
  runRouteRuntime?: Partial<RunRouteRuntime>,
  stepRunRuntime?: Partial<StepRunRouteRuntime>,
  campaignDurationRuntime?: CampaignDurationRouteRuntime,
  proofRouteRuntime?: Partial<ChangeVerificationRouteRuntime>,
  preAuthenticatedRoute = createPreAuthenticatedRoute(),
  goalRouteRuntimeFactory?: GoalRouteRuntimeFactory,
): Promise<void> {
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  const requestOrigin = req.headers.origin;
  const configuredCorsOrigin = allowedBrowserOrigin(requestOrigin, browserOrigins);
  if (configuredCorsOrigin) setCorsOrigin(res, configuredCorsOrigin);

  if (method === "OPTIONS") {
    const corsOrigin =
      configuredCorsOrigin ??
      (requestsBearerAuthentication(req) ? authenticatedBrowserOrigin(requestOrigin) : null);
    if (requestOrigin && !corsOrigin) {
      json(res, 403, { error: "This browser origin is not allowed to access Relay" });
      return;
    }
    if (corsOrigin && !configuredCorsOrigin) setCorsOrigin(res, corsOrigin);
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (await preAuthenticatedRoute({ method, pathname, request: req, response: res })) return;

  const authentication = await authenticateRequest(req.headers.authorization, {
    token,
    externalIdentityVerifier,
    localTrusted,
  });
  if (!authentication) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="relay"');
    json(res, 401, { error: "Authentication required" });
    return;
  }

  // Originless Electron/CLI traffic keeps its local trusted behavior. A
  // browser origin must instead be explicitly Relay-owned, or prove bearer
  // authentication before it can reach an administrative route.
  const corsOrigin =
    configuredCorsOrigin ??
    (authentication.kind !== "local" ? authenticatedBrowserOrigin(requestOrigin) : null);
  if (requestOrigin && !corsOrigin) {
    json(res, 403, { error: "This browser origin is not allowed to access Relay" });
    return;
  }
  if (corsOrigin && !configuredCorsOrigin) setCorsOrigin(res, corsOrigin);

  let resolvedScope: RequestContext | undefined;
  try {
    let scope: RequestContext;
    try {
      scope = resolveRequestContext(req.headers, {
        authenticated: authentication.kind !== "local",
        localTrusted,
        ...(authentication.kind === "external"
          ? { externalIdentity: authentication.identity }
          : {}),
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
    if (await dispatchGoalRoute(req, res, method, pathname, scope, goalRouteRuntimeFactory)) return;
    if (
      await handlePrimaryOperationRoutes({
        method,
        pathname,
        request: req,
        response: res,
        scope,
        runtimes: {
          authoring: authoringRuntime,
          appMapTestRun: appMapTestRunRuntime,
          jobs: jobRouteRuntime,
          workflow: {
            ...workflowRouteRuntime,
            ...(authoringRuntime ? { authoringRuntime } : {}),
          },
          proof: proofRouteRuntime,
          target: targetRuntime,
          campaignDuration: campaignDurationRuntime,
        },
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
      await handleSettingsRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (
      await handleInteractionRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (
      await handleStepRunRoute({
        method,
        pathname,
        request: req,
        response: res,
        scope,
        runtime: stepRunRuntime,
      })
    )
      return;
    if (method === "GET" && pathname === "/audit") {
      json(res, 200, {
        events: listAuditEvents(parseLimit(url.searchParams.get("limit"), 100), scope),
      });
      return;
    }
    if (method === "GET" && pathname === "/health") {
      const visibleActiveJobs = getActiveJobs().filter(
        (job) =>
          scope.localTrusted ||
          (job.projectId === scope.projectId && job.ownerId === scope.subject),
      );
      const active = scopedActiveJob(visibleActiveJobs, scope);
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
      sse.attach(req, res, (event) =>
        liveEventVisible(event, scope, (jobId) => {
          const job = getJob(jobId);
          return job ? { projectId: job.projectId, ownerId: job.ownerId } : undefined;
        }),
      );
      return;
    }

    if (method === "GET" && pathname === "/actions") {
      json(res, 200, { actions: listActionsWithTrace() });
      return;
    }

    if (method === "GET" && pathname === "/devices") {
      const phase = url.searchParams.get("phase");
      if (phase === "android") {
        const devices = await listAndroidDevicesFast().catch(() => []);
        json(res, 200, { devices });
        return;
      }
      if (phase === "ios") {
        const devices = (await listDevices().catch(() => [])).filter(
          (device) => device.platform === "ios",
        );
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

    if (await handleAndroidAvdRoute({ method, pathname, request: req, response: res, scope })) {
      return;
    }

    if (
      await handleTargetRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
      })
    )
      return;
    if (await handleTargetObservationRoute({ method, pathname, url, response: res, scope })) return;

    // ---- Project-scoped control plane ----
    if (
      await handleControlPlaneRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
      })
    )
      return;
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

    if (
      await handleJobRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
        runtime: jobRouteRuntime,
      })
    ) {
      return;
    }

    if (await handleWorkspaceRoute({ method, pathname, url, request: req, response: res, scope })) {
      return;
    }

    const runMatch = matchPath(pathname, "/actions/:id/run");
    if (method === "POST" && runMatch) {
      const body = (await parseJsonBody(req)) as {
        serial?: string;
        platform?: "android" | "ios";
        targetKind?: "device" | "browser";
        browserTargetId?: string;
        prodAccountMatch?: string;
        wait?: boolean;
      };
      const assertControl = jobRouteRuntime?.assertTargetControl ?? assertTargetControl;
      const enqueue = jobRouteRuntime?.enqueueJob ?? enqueueJob;
      const explicitBrowserId =
        body.browserTargetId?.trim() ||
        (body.targetKind === "browser" ? body.serial?.trim() : undefined);
      await assertControl(scope, explicitBrowserId ?? body.serial);
      const browserCaseProfile = explicitBrowserId
        ? await browserCaseProfileForAdmission(explicitBrowserId)
        : await browserCaseProfileIfManaged(body.serial);
      const browserTargetId = explicitBrowserId ?? (browserCaseProfile ? body.serial : undefined);
      const authenticationHealth = await rejectBlockedClaimedBrowserJob({
        projectId: scope.projectId,
        targetId: browserTargetId,
        browserCaseProfile,
      });
      const job = enqueue({
        recipe: runMatch.id!,
        ...(browserCaseProfile
          ? {
              targetKind: "browser" as const,
              browserTargetId,
              browserCaseProfile,
              ...(authenticationHealth ? { authenticationHealth } : {}),
            }
          : {
              serial: body.serial,
              platform: body.platform ?? (await resolveJobDevicePlatform(body.serial)),
            }),
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

    if (
      await handleManualTargetRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
        liveVideoStream,
        captureTargetScreenshot,
      })
    )
      return;

    if (
      await handleCaptureReferenceRoute({
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
      await handleRunRoute({
        method,
        pathname,
        url,
        request: req,
        response: res,
        scope,
        runtime: runRouteRuntime,
      })
    )
      return;

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
      text(res, 200, toJunitXml(collectVisibleReports(limit, scope)), "text/xml; charset=utf-8");
      return;
    }

    if (method === "GET" && pathname === "/report") {
      const limit = parseLimit(url.searchParams.get("limit"), 20);
      json(res, 200, { reports: collectVisibleReports(limit, scope) });
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
          { method: "POST", path: "/goal", mediaType: "application/json" },
          { method: "POST", path: "/explore", mediaType: "application/json" },
          { method: "GET", path: "/goal/:id", mediaType: "application/json" },
          { method: "GET", path: "/explore/:id", mediaType: "application/json" },
          { method: "POST", path: "/goal/:id/resume", mediaType: "application/json" },
          { method: "POST", path: "/explore/:id/resume", mediaType: "application/json" },
          { method: "POST", path: "/goal/:id/reproduce", mediaType: "application/json" },
          { method: "POST", path: "/goal/:id/promote", mediaType: "application/json" },
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
    respondToRequestError(err, res, resolvedScope);
  }
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  // Acquire before recovery so a concurrent process cannot touch this daemon or journal.
  const stateLease = acquireRelayStateServerLease();
  beginDurableWorkerServerLifecycle();
  try {
    return await startServerWithStateLease(opts, stateLease);
  } catch (error) {
    stateLease.release();
    throw error;
  }
}

async function startServerWithStateLease(
  opts: StartServerOptions,
  stateLease: RelayStateServerLease,
): Promise<StartedServer> {
  // Preserve a matching daemon; it may own the only controllable unattended iPad session.
  await loadDeviceSetup();
  await restartAgentDeviceDaemonForBuildDrift();
  // Signing env is frozen at daemon spawn. Reconcile shell/stale identity drift
  // against the saved Apple setup so prepare does not fight automatic signing.
  await restartAgentDeviceDaemonForSigningEnvDrift();
  const host = opts.host ?? "127.0.0.1";
  const preferredPort = opts.port ?? 8787;
  const token = opts.token ?? process.env.RELAY_AUTH_TOKEN;
  const goalRouteRuntimeBinding = createGoalRouteRuntimeBinding({
    port: preferredPort,
    ...(token ? { staticToken: token } : {}),
    ...(opts.goalRouteRuntime ? { runtime: opts.goalRouteRuntime } : {}),
  });
  const goalRouteRuntimeFactory = goalRouteRuntimeBinding.factory;
  const externalIdentityVerifier = opts.externalIdentityVerifier;
  const browserOrigins = opts.browserOrigins
    ? configuredBrowserOrigins(opts.browserOrigins.join(","))
    : configuredBrowserOrigins();
  // Share links absolutize against this origin. Fail startup on a bad value
  // rather than minting capability links that cannot be resolved.
  publicShareBaseUrl();
  // Remote provider adapters are host-owned and intentionally opt-in. Each
  // request runs under this explicit registry; core captures it at admission
  // so a queued job cannot later resolve a provider against ambient defaults.
  const targetDriverRegistry = opts.targetDriverRegistry ?? defaultTargetDriverRegistry;
  const githubProofWebhook = opts.githubProofWebhook ?? githubWebhookFromEnv();
  const preAuthenticatedRoute = createPreAuthenticatedRoute(githubProofWebhook);
  const { proofRouteRuntime, proofPublicationWorker, proofCoordinator, recoverProofCell } =
    createProofRuntimeBootstrap(opts.proofRouteRuntime, opts.webDeploymentLookup);
  const redaction = await loadRedactionPolicy();
  await loadEvidenceCollectionPolicy();
  await cleanupAbandonedAndroidPacketCaptures();
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
  // Rebuild App Map run projections and repair persisted collaboration state.
  await recoverCollaborationState();
  // No job is replayed after a process boundary: target pixels, lease
  // ownership, and UI state may all have changed. Before quarantining work,
  // reconcile any immutable manifest that committed just before the process
  // stopped so it cannot leave its target/host fence behind.
  await recoverDurableWorkerAssignments();
  await proofPublicationWorker.recover();
  // Retention sweep for expired share records. A corrupt or locked store must
  // never block the server from coming up; the next start retries the sweep.
  await pruneExpiredShares(runsRoot()).catch((error: unknown) => {
    console.warn(
      `Share retention sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  await pruneIosVideoTakes();
  assertSafeBinding(host, token, externalIdentityVerifier);
  if (!isLoopbackHost(host) && !redaction.enabled) {
    throw new Error("Refusing a non-local binding while evidence redaction is disabled");
  }
  assertExplicitRemoteServiceTokenScope(host, token);
  const targetRuntimeScope = createTargetRuntimeScope(targetDriverRegistry);
  const sse = createSseHub(CORS_HEADERS);
  const requestHandlers = createRequestHandlerLifecycle();
  const server = http.createServer((req, res) => {
    if (
      !requestHandlers.run(() =>
        targetRuntimeScope.run(() =>
          handleRequest(
            req,
            res,
            token,
            externalIdentityVerifier,
            isLoopbackHost(host),
            browserOrigins,
            sse,
            opts.authoringRuntime,
            opts.liveVideoStream,
            opts.captureTargetScreenshot,
            opts.targetRuntime,
            opts.appMapTestRunRuntime,
            opts.jobRouteRuntime,
            opts.workflowRouteRuntime,
            opts.runRouteRuntime,
            opts.stepRunRuntime,
            opts.campaignDurationRuntime,
            proofRouteRuntime,
            preAuthenticatedRoute,
            goalRouteRuntimeFactory,
          ),
        ),
      )
    ) {
      json(res, 503, { error: "Relay server is shutting down" });
    }
  });
  // Scheduled admissions originate outside an HTTP request, so give them the
  // same durable target runtime scope before they freeze and queue a Run.
  const scheduler = startScheduler(30_000, () =>
    targetRuntimeScope.run(runDueSchedulesWithCombineStarter),
  );
  proofPublicationWorker.start();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(preferredPort, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    proofPublicationWorker.stop();
    targetRuntimeScope.close();
    await scheduler.close().catch(() => undefined);
    sse.close();
    throw error;
  }

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : preferredPort;
  goalRouteRuntimeBinding.setPort(port);
  publish({ type: "server.ready", at: now(), host, port });
  const proofRecovery = proofCoordinator.recover?.(recoverProofCell);
  void proofRecovery?.catch((error: unknown) =>
    console.warn(
      `Proof execution recovery failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
  );

  const close = createFailClosedServerShutdown({
    stopRequestAdmission: () => requestHandlers.stopAdmission(),
    closeHttp: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    drainRequestHandlers: () => requestHandlers.drain(),
    closeScheduler: async () => {
      proofPublicationWorker.stop();
      await scheduler.close();
    },
    closeSse: () => sse.close(),
    drainSessionExecutions: shutdownServerSessions,
    flushActivity: flushOperationActivity,
    releaseStateLease: () => {
      targetRuntimeScope.close();
      stateLease.release();
    },
  });
  return { port, host, close };
}

runServerCliIfInvoked(startServer);
