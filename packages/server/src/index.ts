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
  recordAudit,
  resolveRequestContext,
  type RequestContext,
} from "./security.js";
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
} from "./github/github-proof-check.js";
export { publishChangeProofToGitHub } from "./change/change-proof-github-publisher.js";
export * from "./github/github-proof-intake.js";
import { githubProofWebhookConfigurationFromEnvironment as githubWebhookFromEnv } from "./github/github-proof-intake.js";
import { growAppMapsFromPastRuns, loadSavedModelKey } from "@relay/core";
import {
  captureScreenshot,
  getDefaultTargetDriverRegistry,
  publicShareBaseUrl,
  now,
  publish,
  runsRoot,
  releaseDeviceLease,
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
  warmBrowserPreflights,
} from "@relay/core";
import { cleanupAbandonedAndroidPacketCaptures } from "./startup-cleanup.js";
import { createSseHub } from "./sse.js";
import { startScheduler } from "./scheduler/scheduler.js";
import { runDueSchedulesWithCombineStarter } from "./scheduler/scheduler-combine.js";
import { createRequestHandlerLifecycle } from "./request-handler-lifecycle.js";
import { dispatchAuthenticatedRoute } from "./authenticated-routes.js";
import { createFailClosedServerShutdown } from "./server-shutdown.js";
import { createTargetRuntimeScope } from "./target/target-runtime-scope.js";
import { shutdownServerSessions } from "./server-session-shutdown.js";
import type { RunRouteRuntime } from "./run/run-routes.js";
import { createPreAuthenticatedRoute } from "./pre-authenticated-routes.js";
import type { JobRouteRuntime } from "./job-routes.js";
import { CORS_HEADERS, HttpError, json } from "./http.js";
import { streamTargetVideo } from "./target/target-video-stream.js";
import { pruneIosVideoTakes, reconcileIosVideoTake } from "./ios/ios-video-capture.js";
import { bindOperationRequest } from "./operations.js";
import {
  flushOperationActivity,
  handleActivityRoute,
  recordOperationActivity,
} from "./activity-routes.js";
import { createGoalRouteRuntimeBinding, type GoalRouteRuntimeFactory } from "./goal/goal-routes.js";
import type { StepRunRouteRuntime } from "./step-run-route.js";
import type { AppMapTestRunRouteRuntime } from "./app-map/app-map-test-run-runtime.js";
import type { CampaignDurationRouteRuntime } from "./campaign/campaign-duration-routes.js";
import type { TargetRuntimeRouteRuntime } from "./target/target-runtime-routes.js";
import type { StartServerOptions, StartedServer } from "./server-types.js";
import type { WorkflowRouteRuntime } from "./workflow/workflow-routes.js";
import type { ServerRouteInput } from "./server-route-input.js";
import type { ServerLivenessState } from "./server-liveness-routes.js";
import type { ChangeVerificationRouteRuntime } from "./change/change-verification-routes.js";
import { createProofRuntimeBootstrap } from "./proof/proof-runtime-bootstrap.js";
import { runServerCliIfInvoked } from "./server-cli.js";
import { loadRelayExtensionsFromEnvironment } from "./server-extensions.js";
import { requestsBearerAuthentication, setCorsOrigin } from "./cors.js";
import { respondToRequestError } from "./request-error-response.js";
export type { StartServerOptions, StartedServer } from "./server-types.js";

const serverStartedAt = Date.now();
const serverLiveness: ServerLivenessState = { serverStartedAt, lastKnownDeviceCount: null };

type ServerRequestContext = {
  token?: string;
  externalIdentityVerifier?: ExternalIdentityVerifier;
  localTrusted?: boolean;
  browserOrigins?: readonly string[];
  sse?: ReturnType<typeof createSseHub>;
  authoringRuntime?: AuthoringRuntime;
  liveVideoStream?: typeof streamTargetVideo;
  captureTargetScreenshot?: typeof captureScreenshot;
  targetRuntime?: Partial<TargetRuntimeRouteRuntime>;
  appMapTestRunRuntime?: Partial<AppMapTestRunRouteRuntime>;
  jobRouteRuntime?: Partial<JobRouteRuntime>;
  workflowRouteRuntime?: Partial<WorkflowRouteRuntime>;
  runRouteRuntime?: Partial<RunRouteRuntime>;
  stepRunRuntime?: Partial<StepRunRouteRuntime>;
  campaignDurationRuntime?: CampaignDurationRouteRuntime;
  proofRouteRuntime?: Partial<ChangeVerificationRouteRuntime>;
  preAuthenticatedRoute?: ReturnType<typeof createPreAuthenticatedRoute>;
  goalRouteRuntimeFactory?: GoalRouteRuntimeFactory;
};

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  context: ServerRequestContext = {},
): Promise<void> {
  const {
    token,
    externalIdentityVerifier,
    localTrusted = true,
    browserOrigins = [],
    sse = createSseHub(CORS_HEADERS),
    authoringRuntime,
    liveVideoStream = streamTargetVideo,
    captureTargetScreenshot = captureScreenshot,
    targetRuntime,
    appMapTestRunRuntime,
    jobRouteRuntime,
    workflowRouteRuntime,
    runRouteRuntime,
    stepRunRuntime,
    campaignDurationRuntime,
    proofRouteRuntime,
    preAuthenticatedRoute = createPreAuthenticatedRoute(),
    goalRouteRuntimeFactory,
  } = context;
  const method = req.method ?? "GET";
  const host = req.headers.host ?? "localhost";
  let url: URL;
  try {
    url = new URL(req.url ?? "/", `http://${host}`);
  } catch {
    json(res, 400, { error: "Malformed Host header or request URL" });
    return;
  }
  if (url.username || url.password || !url.hostname) {
    json(res, 400, { error: "Malformed Host header" });
    return;
  }
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
    const routeInput: ServerRouteInput = {
      method,
      pathname,
      url,
      request: req,
      response: res,
      scope,
    };
    if (await handleActivityRoute(routeInput)) return;
    if (operation) await recordOperationActivity({ operation, pathname, scope, response: res });
    if (
      await dispatchAuthenticatedRoute(routeInput, {
        goal: goalRouteRuntimeFactory,
        primary: {
          authoring: authoringRuntime,
          appMapTestRun: appMapTestRunRuntime,
          jobs: jobRouteRuntime,
          workflow: { ...workflowRouteRuntime, ...(authoringRuntime ? { authoringRuntime } : {}) },
          proof: proofRouteRuntime,
          target: targetRuntime,
          campaignDuration: campaignDurationRuntime,
        },
        stepRun: stepRunRuntime,
        run: runRouteRuntime,
        sse,
        liveness: serverLiveness,
        liveVideoStream,
        captureTargetScreenshot,
      })
    )
      return;

    json(res, 404, { error: `Not found: ${method} ${pathname}` });
  } catch (err) {
    respondToRequestError(err, res, resolvedScope);
  }
}

/** Server tests must never write into a developer workspace. The isolated
 * harness (scripts/test-environment.mjs) exports both directories up front;
 * when the node test runner is active without them, fail fast with the fix
 * instead of polluting real maps, jobs, and evidence. */
function assertServerTestIsolation(): void {
  if (!process.env.NODE_TEST_CONTEXT) return;
  const missing: string[] = [];
  if (!process.env.RELAY_STATE_DIR?.trim()) missing.push("RELAY_STATE_DIR");
  if (!process.env.RELAY_RUNS_DIR?.trim()) missing.push("RELAY_RUNS_DIR");
  if (missing.length === 0) return;
  throw new Error(
    `Server tests require isolated state (${missing.join(", ")} unset). ` +
      "Run `pnpm --filter @relay/server test` or " +
      "`npx tsx --import ./scripts/test-environment.mjs --test <file>` from packages/server.",
  );
}

export async function startServer(opts: StartServerOptions = {}): Promise<StartedServer> {
  assertServerTestIsolation();
  // Acquire before recovery so a concurrent process cannot touch this daemon or journal.
  const stateLease = acquireRelayStateServerLease();
  beginDurableWorkerServerLifecycle();
  try {
    await loadRelayExtensionsFromEnvironment();
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
  await loadSavedModelKey();
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
  const targetDriverRegistry = opts.targetDriverRegistry ?? getDefaultTargetDriverRegistry();
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
          handleRequest(req, res, {
            token,
            externalIdentityVerifier,
            localTrusted: isLoopbackHost(host),
            browserOrigins,
            sse,
            authoringRuntime: opts.authoringRuntime,
            liveVideoStream: opts.liveVideoStream,
            captureTargetScreenshot: opts.captureTargetScreenshot,
            targetRuntime: opts.targetRuntime,
            appMapTestRunRuntime: opts.appMapTestRunRuntime,
            jobRouteRuntime: opts.jobRouteRuntime,
            workflowRouteRuntime: opts.workflowRouteRuntime,
            runRouteRuntime: opts.runRouteRuntime,
            stepRunRuntime: opts.stepRunRuntime,
            campaignDurationRuntime: opts.campaignDurationRuntime,
            proofRouteRuntime,
            preAuthenticatedRoute,
            goalRouteRuntimeFactory,
          }),
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
  if (process.env.RELAY_SKIP_BROWSER_WARMUP !== "1") {
    setTimeout(() => void warmBrowserPreflights().catch(() => undefined), 2_000).unref();
  }
  if (process.env.RELAY_SKIP_MAP_BACKFILL !== "1") {
    // Runs that finished before maps grew on their own still teach the map.
    setTimeout(
      () =>
        void growAppMapsFromPastRuns()
          .then(({ runs, changes }) => {
            if (changes) console.log(`App Maps grew from ${runs} past runs (${changes} changes)`);
          })
          .catch(() => undefined),
      5_000,
    ).unref();
  }
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
