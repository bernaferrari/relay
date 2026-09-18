import http from "node:http";
import { sendCombineExport } from "./combine-export-download.js";
import {
  appMapTestExecutionSourceFromJob,
  appMapTestExecutionSourceFromRun,
  analyzeCombineEvidenceBatch,
  triageEvidenceReport,
  captureReviewQueueForPersistedPlan,
  CaptureReviewError,
  reviewPersistedPlanCaptures,
  runsRoot,
  captureHumanInterventionReproof,
  captureScreenshot,
  captureSnapshot,
  cancelActiveJob,
  cancelJob,
  currentOperationContext,
  cleanupScreenshot,
  enqueueJob,
  freezeRecipeExecution,
  getActiveJob,
  getActiveJobs,
  getJob,
  HumanInterventionReproofUnavailableError,
  humanInterventionNeedsReproof,
  listJobs,
  pauseJob,
  prepareJobBatch,
  prepareCasePlan,
  readProjectVariables,
  readTarget,
  referencedRuntimeInputs,
  referencedVariableIds,
  redactCasePlan,
  resumeJob,
  retryJob,
  replayPersistedRun,
  readPersistedRun,
  readBuild,
  prepareSameConfigurationReplay,
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  releaseDeviceLease,
  resolveJobDevicePlatform,
  summarizeJob,
  sensitiveInputNames,
  type TestJob,
} from "@relay/core";
import { admitTargetControl, assertJobAccess, assertTargetControl } from "./access-control.js";
import {
  appMapTestExecutionReviewHttpError,
  requireScopedAppMapTestExecution,
} from "./app-map-test-execution-guard.js";
import {
  browserCaseProfileForAdmission,
  browserJobTargetId,
  httpErrorFromAccountNeedsRelogin,
  rejectBlockedClaimedBrowserJob,
} from "./claimed-browser-job-admission.js";
import { enqueueCompatibilityBatch } from "./compatibility-jobs.js";
import {
  assertExecutionTargetRouteControl,
  assertJobExecutionTargetRouteControl,
  assertPersistedRunExecutionTargetRouteControl,
} from "./execution-target-route-control.js";
import { preflightLocalCampaignAdmission } from "./local-combine-campaign-admission.js";
import { handleCombineStartRoute } from "./combine-start-route.js";
import { HttpError, json, matchPath, parseJsonBody, parseLimit } from "./http.js";
import { recordAudit, resolveCommandActor, type RequestContext } from "./security.js";
import { handleCombineCampaignRoute } from "./combine-campaign-routes.js";
import { assertCurrentBrowserExecutionProfile } from "./browser-execution-profile-admission.js";
import { sendHumanInterventionReproofEvidence } from "./human-intervention-reproof-evidence.js";
import type { verifyCampaignDurationCohortEvidence } from "./campaign-duration-cohort-evidence.js";
import {
  assertExecutionTargetRef,
  CAPTURE_REVIEW_ACTIONS,
  parsePlanCaptureReviewFilter,
  type CaptureReviewAction,
  type ExecutionTargetRef,
  type LocalCampaignAdmissionPreflightRequest,
} from "@relay/protocol";

export type JobRouteRuntime = {
  getJob: typeof getJob;
  readTarget: typeof readTarget;
  assertTargetControl: typeof assertTargetControl;
  admitTargetControl: typeof admitTargetControl;
  listDevices: typeof listDevices;
  listDeviceLeases: typeof listDeviceLeases;
  listTargetWorkers: typeof listTargetWorkers;
  releaseDeviceLease: typeof releaseDeviceLease;
  /** Optional test seam. Normal local admission re-derives cohort evidence
   * from persisted project runs when this is not supplied. */
  verifyCampaignDurationCohortEvidence?: typeof verifyCampaignDurationCohortEvidence;
  enqueueJob: typeof enqueueJob;
  captureScreenshot: typeof captureScreenshot;
  captureSnapshot: typeof captureSnapshot;
  cleanupScreenshot: typeof cleanupScreenshot;
  retryJob: typeof retryJob;
  replayPersistedRun: typeof replayPersistedRun;
  resumeJob: (id: string) => TestJob | Promise<TestJob>;
  prepareJobBatch: typeof prepareJobBatch;
};

export const defaultJobRouteRuntime: JobRouteRuntime = {
  getJob,
  readTarget,
  assertTargetControl,
  admitTargetControl,
  listDevices,
  listDeviceLeases,
  listTargetWorkers,
  releaseDeviceLease,
  enqueueJob,
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  retryJob,
  replayPersistedRun,
  resumeJob,
  prepareJobBatch,
};

function compatibilityRuntime(runtime: JobRouteRuntime) {
  return {
    listDevices: runtime.listDevices,
    listDeviceLeases: runtime.listDeviceLeases,
    admitTargetControl: runtime.admitTargetControl,
    releaseDeviceLease: runtime.releaseDeviceLease,
    prepareJobBatch: runtime.prepareJobBatch,
  };
}

export type JobRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<JobRouteRuntime>;
};

export async function handleJobRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, url, request: req, response: res, scope } = context;
  const runtime = { ...defaultJobRouteRuntime, ...context.runtime };
  if (method === "POST" && pathname === "/jobs/local-admission/preflight") {
    const body = (await parseJsonBody(req)) as LocalCampaignAdmissionPreflightRequest;
    const preflight = await preflightLocalCampaignAdmission({
      scope,
      workItems: body.workItems,
      request: body.request,
      runtime: {
        listDevices: runtime.listDevices,
        listDeviceLeases: runtime.listDeviceLeases,
        listTargetWorkers: runtime.listTargetWorkers,
        assertTargetControl: runtime.assertTargetControl,
        admitTargetControl: runtime.admitTargetControl,
        releaseDeviceLease: runtime.releaseDeviceLease,
        ...(runtime.verifyCampaignDurationCohortEvidence
          ? {
              verifyCampaignDurationCohortEvidence: runtime.verifyCampaignDurationCohortEvidence,
            }
          : {}),
      },
      actorId: currentOperationContext()?.actorId ?? scope.subject,
    });
    json(res, 200, preflight);
    return true;
  }
  if (method === "GET" && pathname === "/jobs") {
    const limit = parseLimit(url.searchParams.get("limit"), 50);
    const activeJobs = getActiveJobs().filter(
      (job) =>
        scope.localTrusted || (job.projectId === scope.projectId && job.ownerId === scope.subject),
    );
    json(res, 200, {
      jobs: (scope.localTrusted
        ? listJobs(limit)
        : listJobs(limit).filter(
            (job) => job.projectId === scope.projectId && job.ownerId === scope.subject,
          )
      ).map(summarizeJob),
      // `active` is compatibility-only; `activeJobs` is the truthful capacity-aware view.
      active: activeJobs.length ? summarizeJob(activeJobs.at(-1)!) : null,
      activeJobs: activeJobs.map(summarizeJob),
    });
    return true;
  }

  const humanReproofEvidenceMatch = matchPath(
    pathname,
    "/jobs/:id/human-intervention-reproof/evidence/:sha256",
  );
  if (method === "GET" && humanReproofEvidenceMatch) {
    const job = runtime.getJob(humanReproofEvidenceMatch.id!);
    assertJobAccess(scope, job);
    await sendHumanInterventionReproofEvidence({
      response: res,
      artifacts: job.artifacts,
      sha256: humanReproofEvidenceMatch.sha256!,
    });
    recordAudit(scope, {
      action: "job.human-intervention-reproof.evidence.read",
      resource: `${job.id}:${humanReproofEvidenceMatch.sha256}`,
      result: "allow",
    });
    return true;
  }

  const jobMatch = matchPath(pathname, "/jobs/:id");
  if (method === "GET" && jobMatch) {
    const job = getJob(jobMatch.id!);
    assertJobAccess(scope, job);
    json(res, 200, { job });
    return true;
  }

  const retryMatch = matchPath(pathname, "/jobs/:id/retry");
  if (method === "POST" && retryMatch) {
    const previous = runtime.getJob(retryMatch.id!);
    assertJobAccess(scope, previous);
    await requireScopedAppMapTestExecution(appMapTestExecutionSourceFromJob(previous));
    await assertCurrentBrowserExecutionProfile({ execution: previous, runtime });
    await assertJobExecutionTargetRouteControl({
      scope,
      job: previous,
      assertLocalTargetControl: runtime.assertTargetControl,
    });
    const authenticationHealth = await rejectBlockedClaimedBrowserJob({
      projectId: previous.projectId ?? scope.projectId,
      targetId: browserJobTargetId(previous),
      browserCaseProfile: previous.browserCaseProfile,
      targetProfile: previous.targetProfile,
      parentAuthenticationHealth: previous.authenticationHealth,
    });
    const job = runtime.retryJob(
      retryMatch.id!,
      authenticationHealth ? { authenticationHealth } : {},
    );
    json(res, 202, { job });
    return true;
  }

  const replayMatch = matchPath(pathname, "/runs/:id/replay");
  if (method === "POST" && replayMatch) {
    const run = await readPersistedRun(replayMatch.id!);
    if (!run) throw new HttpError(404, "Recorded run not found");
    if (
      !scope.localTrusted &&
      (run.projectId !== scope.projectId || run.ownerId !== scope.subject)
    ) {
      throw new HttpError(404, "Recorded run not found");
    }
    await requireScopedAppMapTestExecution(appMapTestExecutionSourceFromRun(run));
    await assertCurrentBrowserExecutionProfile({ execution: run, runtime });
    await assertPersistedRunExecutionTargetRouteControl({
      scope,
      run,
      assertLocalTargetControl: runtime.assertTargetControl,
    });
    const body = (await parseJsonBody(req)) as { mode?: unknown };
    const mode = body.mode === undefined ? "saved-steps" : body.mode;
    if (mode !== "saved-steps" && mode !== "same-configuration") {
      throw new HttpError(400, "Replay mode must be saved-steps or same-configuration");
    }
    const authenticationHealth = await rejectBlockedClaimedBrowserJob({
      projectId: run.projectId ?? scope.projectId,
      targetId: browserJobTargetId(run),
      browserCaseProfile: run.browserCaseProfile,
      targetProfile: run.targetProfile,
      parentAuthenticationHealth: run.authenticationHealth,
    });
    try {
      if (mode === "same-configuration") {
        const buildId = run.sourceRevision?.buildId;
        if (!buildId) {
          throw new HttpError(
            409,
            "Same-configuration replay requires a persisted immutable build identity",
          );
        }
        const build = await readBuild(scope.projectId, buildId);
        if (!build) throw new HttpError(409, `Recorded build ${buildId} is unavailable`);
        const target = run.executionTarget;
        if (target?.kind !== "local-device") {
          throw new HttpError(
            409,
            "Same-configuration replay requires a locally controllable device target",
          );
        }
        const device = (await runtime.listDevices()).find(
          (candidate) => candidate.serial === target.identity.value,
        );
        if (!device)
          throw new HttpError(409, `Recorded target ${target.identity.value} is unavailable`);
        const targetContext = {
          kind: "device" as const,
          platform: target.platform,
          serial: target.identity.value,
        };
        await prepareSameConfigurationReplay({
          run,
          build,
          target: targetContext,
          targetKind: device.kind,
        });
      }
      const job = runtime.replayPersistedRun(
        run,
        "saved-steps",
        authenticationHealth ? { authenticationHealth } : {},
      );
      json(res, 202, { job });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const cancelMatch = matchPath(pathname, "/jobs/:id/cancel");
  if (method === "POST" && cancelMatch) {
    assertJobAccess(scope, getJob(cancelMatch.id!));
    const job = cancelJob(cancelMatch.id!);
    json(res, 200, { job });
    return true;
  }

  const pauseMatch = matchPath(pathname, "/jobs/:id/pause");
  if (method === "POST" && pauseMatch) {
    assertJobAccess(scope, getJob(pauseMatch.id!));
    const job = pauseJob(pauseMatch.id!);
    json(res, 200, { job });
    return true;
  }

  const resumeMatch = matchPath(pathname, "/jobs/:id/resume");
  if (method === "POST" && resumeMatch) {
    const paused = runtime.getJob(resumeMatch.id!);
    assertJobAccess(scope, paused);
    await requireScopedAppMapTestExecution(appMapTestExecutionSourceFromJob(paused));
    await assertCurrentBrowserExecutionProfile({ execution: paused, runtime });
    await rejectBlockedClaimedBrowserJob({
      projectId: paused.projectId ?? scope.projectId,
      targetId: browserJobTargetId(paused),
      browserCaseProfile: paused.browserCaseProfile,
      targetProfile: paused.targetProfile,
      parentAuthenticationHealth: paused.authenticationHealth,
    });
    if (humanInterventionNeedsReproof(paused)) {
      const operation = currentOperationContext();
      if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
      if (paused.targetContext.kind !== "device") {
        throw new HttpError(409, "The intervened target cannot be re-proven");
      }
      const targetId = paused.targetContext.serial;
      try {
        await captureHumanInterventionReproof({
          job: paused,
          operation,
          targetId,
          capture: {
            captureSnapshot: () =>
              runtime.captureSnapshot({ serial: targetId, includeVisual: true }),
            ...(paused.targetContext.platform === "ios"
              ? {
                  captureScreenshot: () =>
                    runtime.captureScreenshot({
                      serial: targetId,
                      caption: "human intervention reproof",
                      ephemeral: true,
                      includeScreenMatch: false,
                    }),
                  cleanupScreenshot: runtime.cleanupScreenshot,
                }
              : {}),
          },
        });
      } catch (error) {
        if (error instanceof HumanInterventionReproofUnavailableError) {
          throw new HttpError(409, error.message, {
            code: error.code,
            jobId: paused.id,
            targetId,
            recovery:
              paused.targetContext.platform === "ios"
                ? "Keep the run paused. Capture coherent screenshots around a fresh current accessibility snapshot after the human repair, then resume."
                : "Keep the run paused. Capture a fresh current accessibility snapshot with named controls after the human repair, then resume.",
          });
        }
        throw new HttpError(
          409,
          error instanceof Error ? error.message : "The intervened target could not be re-proven",
          {
            code: "TARGET_INTERVENTION_REPROOF_FAILED",
            jobId: paused.id,
            targetId,
            recovery: "Observe the repaired target successfully before resuming this run.",
          },
        );
      }
    }
    try {
      const job = await runtime.resumeJob(resumeMatch.id!);
      json(res, 200, { job });
    } catch (error) {
      const reviewError = appMapTestExecutionReviewHttpError(error);
      if (reviewError) throw reviewError;
      const relogin = httpErrorFromAccountNeedsRelogin(error);
      if (relogin) throw relogin;
      throw error;
    }
    return true;
  }

  if (method === "POST" && pathname === "/jobs/active/cancel") {
    const body = (await parseJsonBody(req)) as { targetId?: unknown };
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : undefined;
    assertJobAccess(scope, getActiveJob(targetId) ?? undefined);
    const job = cancelActiveJob(targetId);
    if (!job) throw new HttpError(404, "No active job");
    json(res, 200, { job });
    return true;
  }

  if (method === "POST" && pathname === "/jobs/matrix") {
    const body = (await parseJsonBody(req)) as {
      recipe?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      prodAccountMatch?: string;
      repetitions?: number;
      seed?: number;
      projectId?: string;
    };
    if (!body.recipe) throw new HttpError(400, "recipe is required");
    if (!scope.localTrusted) {
      throw new HttpError(403, "Recipe jobs require a project-owned recipe store");
    }
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
    const platform =
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(body.serial));
    const browserCaseProfile = await browserCaseProfileForAdmission(
      body.browserTargetId ?? (body.targetKind === "browser" ? body.serial : undefined),
    );
    const authenticationHealth = await rejectBlockedClaimedBrowserJob({
      projectId: scope.projectId,
      targetId: body.browserTargetId ?? (body.targetKind === "browser" ? body.serial : undefined),
      browserCaseProfile,
    });
    if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
      recordAudit(scope, { action: "run.matrix", resource: "project", result: "deny" });
      throw new HttpError(403, "Project is outside the authenticated scope");
    }
    const definitions = await readProjectVariables(scope.projectId);
    const frozenRecipe = await freezeRecipeExecution(body.recipe);
    const matrix = await prepareCasePlan({
      variables: definitions.value,
      dataIds: referencedVariableIds(frozenRecipe.recipeGraph, definitions.value),
      repetitions: body.repetitions,
      seed: body.seed,
    });
    const safeMatrix = redactCasePlan(matrix, definitions.value);
    const jobs = matrix.cases.map((item) =>
      runtime.enqueueJob({
        recipe: frozenRecipe.recipeSnapshot.id,
        ...frozenRecipe,
        serial: body.serial,
        platform,
        targetKind: body.targetKind,
        browserTargetId: body.browserTargetId,
        browserCaseProfile,
        ...(authenticationHealth ? { authenticationHealth } : {}),
        prodAccountMatch: body.prodAccountMatch,
        variables: item.values,
        sensitiveInputNames: sensitiveInputNames(definitions.value, item.values),
        batchId: matrix.id,
        caseIndex: item.index,
        caseCount: matrix.cases.length,
        artifacts: [
          {
            kind: "frozen-inputs",
            capturedAt: matrix.createdAt,
            data: {
              matrixId: matrix.id,
              seed: matrix.seed,
              caseIndex: item.index,
              caseCount: matrix.cases.length,
              values: safeMatrix.cases[item.index]!.values,
              provenance: safeMatrix.cases[item.index]!.provenance,
            },
          },
        ],
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      }),
    );
    json(res, 202, { matrix: safeMatrix, jobs });
    return true;
  }

  if (method === "POST" && pathname === "/jobs/combine") {
    await handleCombineStartRoute({ request: req, response: res, scope, runtime });
    return true;
  }

  if (await handleCombineCampaignRoute({ ...context, runtime })) return true;

  const optionExportMatch = matchPath(pathname, "/jobs/combine/:batchId/export");
  if (method === "GET" && optionExportMatch) {
    await sendCombineExport({
      request: req,
      response: res,
      scope,
      batchId: optionExportMatch.batchId!,
      archive: url.searchParams.get("download") === "archive",
    });
    return true;
  }

  const combineAnalysisMatch = matchPath(pathname, "/jobs/combine/:batchId/analysis");
  if (method === "GET" && combineAnalysisMatch) {
    try {
      const report = await analyzeCombineEvidenceBatch(combineAnalysisMatch.batchId!);
      json(
        res,
        200,
        url.searchParams.get("triage") === "jev"
          ? { ...report, jevTriage: await triageEvidenceReport(report) }
          : report,
      );
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const combineCaptureReviewMatch = matchPath(pathname, "/jobs/combine/:batchId/capture-review");
  if (method === "GET" && combineCaptureReviewMatch) {
    json(res, 200, {
      queue: await captureReviewQueueForPersistedPlan(
        combineCaptureReviewMatch.batchId!,
        parsePlanCaptureReviewFilter({
          pending: url.searchParams.get("pending") ?? undefined,
          screen: url.searchParams.get("screen") ?? undefined,
          device: url.searchParams.get("device") ?? undefined,
          account: url.searchParams.get("account") ?? undefined,
        }),
        scope.projectId,
      ),
    });
    return true;
  }
  if (method === "POST" && combineCaptureReviewMatch) {
    const body = (await parseJsonBody(req)) as {
      action?: unknown;
      items?: unknown;
      pending?: unknown;
      screen?: unknown;
      device?: unknown;
      account?: unknown;
    };
    if (!CAPTURE_REVIEW_ACTIONS.includes(body.action as CaptureReviewAction)) {
      throw new HttpError(400, "Unknown capture review action", {
        code: "CAPTURE_REVIEW_ACTION_INVALID",
        recovery: `Choose one of: ${CAPTURE_REVIEW_ACTIONS.join(", ")}. Looks correct does not approve a visual baseline.`,
      });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, "items must list the exact screenshots to review", {
        code: "CAPTURE_REVIEW_ITEMS_REQUIRED",
        recovery:
          "Pass the selected runId, captureId, and imageSha256 list from the Plan captures panel.",
      });
    }
    const actor = resolveCommandActor(req.headers, scope);
    const filter = parsePlanCaptureReviewFilter(body);
    try {
      const reviewed = await reviewPersistedPlanCaptures(
        runsRoot(),
        combineCaptureReviewMatch.batchId!,
        {
          action: body.action as CaptureReviewAction,
          actor: { id: actor.actorId, kind: actor.actorKind },
          items: body.items as Array<{
            runId: string;
            captureId: string;
            imageSha256?: string;
            action?: CaptureReviewAction;
            expectedReviewVersion?: number;
          }>,
          ...(filter ? { filter } : {}),
        },
        scope.projectId,
      );
      recordAudit(scope, {
        action: `job.combine.capture.review.apply.${body.action}`,
        resource: combineCaptureReviewMatch.batchId!,
        result: "allow",
      });
      json(res, 200, reviewed);
    } catch (error) {
      if (error instanceof CaptureReviewError) {
        const status =
          error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED"
            ? 403
            : error.code === "CAPTURE_REVIEW_MISSING" || error.code === "CAPTURE_REVIEW_CONFLICT"
              ? 409
              : 400;
        throw new HttpError(status, error.message, { code: error.code, recovery: error.recovery });
      }
      throw error;
    }
    return true;
  }

  if (method === "POST" && pathname === "/jobs/compatibility-matrix") {
    json(
      res,
      202,
      await enqueueCompatibilityBatch(
        scope,
        await parseJsonBody(req),
        {
          kind: "compatibility",
          maxRepetitions: 20,
          maxJobs: 200,
        },
        compatibilityRuntime(runtime),
      ),
    );
    return true;
  }

  if (method === "POST" && pathname === "/jobs/soak") {
    json(
      res,
      202,
      await enqueueCompatibilityBatch(
        scope,
        await parseJsonBody(req),
        {
          kind: "soak",
          maxRepetitions: 100,
          maxJobs: 500,
        },
        compatibilityRuntime(runtime),
      ),
    );
    return true;
  }

  if (method === "POST" && pathname === "/jobs") {
    const body = (await parseJsonBody(req)) as {
      recipe?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      prodAccountMatch?: string;
      retryOf?: string;
      variables?: Record<string, string>;
      executionTarget?: unknown;
    };
    if (!body.recipe && !body.retryOf) {
      throw new HttpError(400, "recipe is required");
    }
    if (body.recipe && !scope.localTrusted) {
      throw new HttpError(403, "Recipe jobs require a project-owned recipe store");
    }
    if (body.retryOf) {
      const previous = runtime.getJob(body.retryOf);
      assertJobAccess(scope, previous);
      await requireScopedAppMapTestExecution(appMapTestExecutionSourceFromJob(previous));
      await assertCurrentBrowserExecutionProfile({ execution: previous, runtime });
      await assertJobExecutionTargetRouteControl({
        scope,
        job: previous,
        assertLocalTargetControl: runtime.assertTargetControl,
      });
      const authenticationHealth = await rejectBlockedClaimedBrowserJob({
        projectId: previous.projectId ?? scope.projectId,
        targetId: browserJobTargetId(previous),
        browserCaseProfile: previous.browserCaseProfile,
        targetProfile: previous.targetProfile,
        parentAuthenticationHealth: previous.authenticationHealth,
      });
      try {
        const job = runtime.retryJob(
          body.retryOf,
          authenticationHealth ? { authenticationHealth } : {},
        );
        json(res, 202, { job });
        return true;
      } catch (err) {
        const relogin = httpErrorFromAccountNeedsRelogin(err);
        if (relogin) throw relogin;
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
    }
    let executionTarget: ExecutionTargetRef | undefined;
    if (body.executionTarget !== undefined) {
      try {
        assertExecutionTargetRef(body.executionTarget);
        // Do not let a request object be mutated after admission but before
        // the core factory freezes its own canonical copy.
        executionTarget = structuredClone(body.executionTarget);
      } catch {
        throw new HttpError(400, "executionTarget must be a valid execution target reference");
      }
      await assertExecutionTargetRouteControl({
        scope,
        target: executionTarget,
        assertLocalTargetControl: runtime.assertTargetControl,
        source: "enqueue",
      });
    } else {
      await runtime.assertTargetControl(scope, body.browserTargetId ?? body.serial);
    }
    const platform =
      (executionTarget?.platform === "browser" ? undefined : executionTarget?.platform) ??
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(body.serial));
    const admittedBrowserTargetId =
      executionTarget?.kind === "local-browser"
        ? executionTarget.identity.value
        : (body.browserTargetId ?? (body.targetKind === "browser" ? body.serial : undefined));
    const browserCaseProfile = await browserCaseProfileForAdmission(admittedBrowserTargetId);
    const authenticationHealth = await rejectBlockedClaimedBrowserJob({
      projectId: scope.projectId,
      targetId: admittedBrowserTargetId,
      browserCaseProfile,
    });
    let job;
    try {
      const frozenRecipe = body.recipe ? await freezeRecipeExecution(body.recipe) : undefined;
      const definitions = body.variables ? await readProjectVariables(scope.projectId) : undefined;
      const variables = frozenRecipe
        ? referencedRuntimeInputs(
            frozenRecipe.recipeGraph,
            definitions?.value ?? [],
            body.variables,
          )
        : body.variables;
      job = runtime.enqueueJob({
        recipe: body.recipe!,
        ...frozenRecipe,
        executionTarget,
        serial: body.serial,
        platform,
        targetKind: body.targetKind,
        browserTargetId: body.browserTargetId,
        browserCaseProfile,
        ...(authenticationHealth ? { authenticationHealth } : {}),
        prodAccountMatch: body.prodAccountMatch,
        variables,
        sensitiveInputNames: definitions
          ? sensitiveInputNames(definitions.value, variables ?? {})
          : [],
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
    } catch (err) {
      const relogin = httpErrorFromAccountNeedsRelogin(err);
      if (relogin) throw relogin;
      // Invalid or missing compiled execution plans are client errors, not server faults.
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(400, message);
    }
    json(res, 202, { job });
    return true;
  }

  return false;
}
