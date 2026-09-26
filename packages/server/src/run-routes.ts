import { createHash } from "node:crypto";
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  buildRunStory,
  applyRunRetention,
  buildCampaignRepairTarget,
  appMapTestExecutionSourceFromRun,
  campaignRepairPlanIdentity,
  buildCompatibilityReport,
  buildSoakReport,
  compareEvidenceMetrics,
  campaignCheckRepairInput,
  campaignRepairProposal,
  loadRunEvidence,
  createRunShare,
  currentOperationContext,
  enqueueJob,
  extractEvidenceMetrics,
  listJobs,
  listPersistedRuns,
  listPersistedRunSummariesPage,
  listCampaignRepairTargets,
  listRunSummariesPage,
  listRunShares,
  readFrameFile,
  readTarget,
  readAppMap,
  readVisualBaselineFrame,
  readPersistedRun,
  findDurableWorkflowsByResources,
  buildPlayerManifest,
  replayPersistedRunOffline,
  analyzeTracePack,
  exportTracePack,
  exportWalkthroughPack,
  reconcileCampaignCheckRepair,
  runArtifactFile,
  runsRoot,
  runStorageHealth,
  setRunPinned,
  summarizeCampaignRepairTarget,
  submitAppMapProposal,
  compareVisualBaseline,
  getVisualBaseline,
  getVisualComparisonPolicy,
  reviewVisualComparison,
  reviewPersistedRun,
  reviewPersistedCapture,
  rebuildRunCatalog,
  CaptureReviewError,
  revokeRunShare,
  RunReviewError,
  updateVisualComparisonPolicy,
  VISUAL_REVIEW_ACTIONS,
  type PersistedRun,
  visualTargetKey,
} from "@relay/core";
import type {
  CampaignRepairTarget,
  CaptureReviewAction,
  OperationInput,
  VisualRegion,
} from "@relay/protocol";
import { CAPTURE_REVIEW_ACTIONS } from "@relay/protocol";
import { assertTargetControl } from "./access-control.js";
import { requireScopedAppMapTestExecution } from "./app-map-test-execution-guard.js";
import { applyRebasableAppMapMutation } from "./app-map-route-mutations.js";
import { assertEnqueueExecutionTargetRouteControl } from "./execution-target-route-control.js";
import { assertCurrentBrowserExecutionProfile } from "./browser-execution-profile-admission.js";
import {
  browserJobTargetId,
  rejectBlockedClaimedBrowserJob,
} from "./claimed-browser-job-admission.js";
import { sendHumanInterventionReproofEvidence } from "./human-intervention-reproof-evidence.js";
import { recordAudit, resolveCommandActor, type RequestContext } from "./security.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, parseLimit } from "./http.js";
import { scopedCampaignRepairInput } from "./run-repair-input.js";
import { guardVisualVerification } from "./run-visual-verification.js";

export type RunRouteRuntime = {
  assertTargetControl: typeof assertTargetControl;
  enqueueJob: typeof enqueueJob;
  readTarget: typeof readTarget;
};

const defaultRunRouteRuntime: RunRouteRuntime = { assertTargetControl, enqueueJob, readTarget };

async function attachDurableWorkflowIds<T extends { runs: readonly { id: string }[] }>(
  page: T,
  scope: RequestContext,
): Promise<T & { runs: Array<T["runs"][number] & { workflowId?: string }> }> {
  const workflows = await findDurableWorkflowsByResources({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    workflowKind: "run-test",
    resourceKind: "job",
    resourceIds: page.runs.map((run) => run.id),
  });
  const runs = page.runs.map((run) => {
    const workflow = workflows.get(run.id);
    return workflow ? { ...run, workflowId: workflow.record.workflowId } : { ...run };
  });
  return { ...page, runs };
}

export type RunRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime?: Partial<RunRouteRuntime>;
};

function assertRunAccess(
  scope: RequestContext,
  run: Awaited<ReturnType<typeof readPersistedRun>>,
): asserts run is NonNullable<Awaited<ReturnType<typeof readPersistedRun>>> {
  if (!run) throw new HttpError(404, "Run not found");
  if (scope.localTrusted) return;
  if (run.projectId !== scope.projectId || run.ownerId !== scope.subject) {
    recordAudit(scope, { action: "run.access", resource: run.id, result: "deny" });
    throw new HttpError(404, "Run not found");
  }
}

function runVisibleToScope(
  scope: RequestContext,
  run: { projectId?: string; ownerId?: string },
): boolean {
  return scope.localTrusted || (run.projectId === scope.projectId && run.ownerId === scope.subject);
}

function assertLocalMaintenance(scope: RequestContext): void {
  if (!scope.localTrusted) {
    throw new HttpError(403, "Run storage maintenance is available only on the local Relay host");
  }
}

export async function loadScopedRun(id: string, scope: RequestContext): Promise<PersistedRun> {
  const run = await readPersistedRun(id);
  assertRunAccess(scope, run);
  return run;
}

function reviewActor(context: RunRouteContext): {
  id: string;
  kind: "human" | "agent" | "system";
} {
  const actor = resolveCommandActor(context.request.headers, context.scope);
  return { id: actor.actorId, kind: actor.actorKind };
}

async function currentCampaignRepairReconciliation(
  scope: RequestContext,
  run: NonNullable<Awaited<ReturnType<typeof readPersistedRun>>>,
  checkId: string,
) {
  const identity = campaignRepairPlanIdentity(run);
  if (!identity.appMapId || !identity.testId) return undefined;
  const map = await readAppMap(scope.projectId, identity.appMapId);
  const test = map?.tests[identity.testId];
  if (!map || !test) return undefined;
  return reconcileCampaignCheckRepair(run, checkId, map, test);
}

export async function handleRunRoute(context: RunRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = context;
  const runtime = { ...defaultRunRouteRuntime, ...context.runtime };
  const matrixReportMatch = matchPath(pathname, "/reports/matrix/:batchId");
  if (method === "GET" && matrixReportMatch) {
    const persisted = await listPersistedRuns(500);
    const live = listJobs(500);
    const byId = new Map(
      [...persisted, ...live]
        .filter((run) => runVisibleToScope(scope, run))
        .map((run) => [run.id, run]),
    );
    const report = buildCompatibilityReport([...byId.values()], matrixReportMatch.batchId!);
    if (!report) throw new HttpError(404, "Compatibility matrix report not found");
    json(response, 200, { report });
    return true;
  }

  const soakReportMatch = matchPath(pathname, "/reports/soak/:batchId");
  if (method === "GET" && soakReportMatch) {
    const persisted = await listPersistedRuns(1_000);
    const live = listJobs(1_000);
    const byId = new Map(
      [...persisted, ...live]
        .filter((run) => runVisibleToScope(scope, run))
        .map((run) => [run.id, run]),
    );
    const report = buildSoakReport([...byId.values()], soakReportMatch.batchId!);
    if (!report) throw new HttpError(404, "Soak report not found");
    json(response, 200, { report });
    return true;
  }

  if (method === "GET" && pathname === "/runs") {
    const limit = parseLimit(url.searchParams.get("limit"), 40);
    const appMapId = url.searchParams.get("appMapId")?.trim() || undefined;
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;
    if (scope.localTrusted) {
      try {
        const page = await listRunSummariesPage({
          limit,
          appMapId,
          cursor,
          projectId: scope.projectId,
        });
        json(response, 200, { ...(await attachDurableWorkflowIds(page, scope)), root: runsRoot() });
      } catch (error) {
        if (error instanceof Error && error.name === "RunListCursorError") {
          throw new HttpError(400, error.message);
        }
        throw error;
      }
      return true;
    }
    try {
      const page = await listPersistedRunSummariesPage({
        limit,
        appMapId,
        cursor,
        projectId: scope.projectId,
        ownerId: scope.subject,
      });
      json(response, 200, await attachDurableWorkflowIds(page, scope));
    } catch (error) {
      if (error instanceof Error && error.name === "RunListCursorError") {
        throw new HttpError(400, error.message);
      }
      throw error;
    }
    return true;
  }

  if (method === "GET" && pathname === "/runs/repairs") {
    const limit = Math.min(500, parseLimit(url.searchParams.get("limit"), 100));
    const runs = (await listPersistedRuns(500)).filter((run) => runVisibleToScope(scope, run));
    json(response, 200, {
      repairs: listCampaignRepairTargets(runs).slice(0, limit).map(summarizeCampaignRepairTarget),
    });
    return true;
  }

  const repairGetMatch = matchPath(pathname, "/runs/:id/checks/:checkId/repair");
  if (method === "GET" && repairGetMatch) {
    const run = await loadScopedRun(repairGetMatch.id!, scope);
    const runs = (await listPersistedRuns(500)).filter((candidate) =>
      runVisibleToScope(scope, candidate),
    );
    const frozenRepair = listCampaignRepairTargets(runs).find(
      (candidate) =>
        candidate.source.runId === run.id && candidate.source.checkId === repairGetMatch.checkId,
    );
    const reconciliation = await currentCampaignRepairReconciliation(
      scope,
      run,
      repairGetMatch.checkId!,
    ).catch(() => undefined);
    const repair = buildCampaignRepairTarget(
      run,
      repairGetMatch.checkId!,
      frozenRepair?.lineage.priorAttempts ?? [],
      reconciliation,
    );
    if (!repair) throw new HttpError(404, `Failed check ${repairGetMatch.checkId} not found`);
    json(response, 200, { repair });
    return true;
  }

  const repairRetryMatch = matchPath(pathname, "/runs/:id/checks/:checkId/retry");
  if (method === "POST" && repairRetryMatch) {
    const run = await loadScopedRun(repairRetryMatch.id!, scope);
    await parseJsonBody(request);
    const sourceIntent = await requireScopedAppMapTestExecution(
      appMapTestExecutionSourceFromRun(run),
    );
    try {
      const reconciliation = await currentCampaignRepairReconciliation(
        scope,
        run,
        repairRetryMatch.checkId!,
      );
      const repair = buildCampaignRepairTarget(run, repairRetryMatch.checkId!, [], reconciliation);
      if (!repair) throw new HttpError(404, `Failed check ${repairRetryMatch.checkId} not found`);
      const repairInput = await scopedCampaignRepairInput({
        sourceIntent,
        repairInput: campaignCheckRepairInput(run, repairRetryMatch.checkId!, reconciliation),
        ...(reconciliation ? { reconciliation } : {}),
      });
      await assertCurrentBrowserExecutionProfile({ execution: repairInput, runtime });
      await assertEnqueueExecutionTargetRouteControl({
        scope,
        enqueue: repairInput,
        assertLocalTargetControl: runtime.assertTargetControl,
      });
      const authenticationHealth = await rejectBlockedClaimedBrowserJob({
        projectId: run.projectId ?? scope.projectId,
        targetId: browserJobTargetId(run),
        browserCaseProfile: repairInput.browserCaseProfile ?? run.browserCaseProfile,
        targetProfile: repairInput.targetProfile ?? run.targetProfile,
        parentAuthenticationHealth: run.authenticationHealth,
      });
      const job = runtime.enqueueJob({
        ...repairInput,
        ...(authenticationHealth ? { authenticationHealth } : {}),
      });
      recordAudit(scope, {
        action: "run.repair.retry",
        resource: repair.id,
        result: "allow",
      });
      json(response, 202, { repair, job });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, error instanceof Error ? error.message : String(error), {
        code: "CAMPAIGN_CHECK_REPAIR_UNAVAILABLE",
        recovery: "Inspect the repair target and propose a Test repair, or continue and report.",
      });
    }
    return true;
  }

  const repairProposalMatch = matchPath(pathname, "/runs/:id/checks/:checkId/proposals");
  if (method === "POST" && repairProposalMatch) {
    const body = (await parseJsonBody(request)) as Omit<
      OperationInput<"run.repair.propose">,
      "runId" | "checkId"
    >;
    const requestedTargets = [
      { runId: repairProposalMatch.id!, checkId: repairProposalMatch.checkId! },
      ...(body.equivalentTargets ?? []),
    ];
    const targets: CampaignRepairTarget[] = [];
    for (const key of new Set(
      requestedTargets.map((target) => `${target.runId}\u0000${target.checkId}`),
    )) {
      const [runId, checkId] = key.split("\u0000") as [string, string];
      const sourceRun = await loadScopedRun(runId, scope);
      const repair = buildCampaignRepairTarget(sourceRun, checkId);
      if (!repair) throw new HttpError(404, `Failed check ${checkId} not found in run ${runId}`);
      targets.push(repair);
    }
    const primary = targets[0]!;
    if (!primary.source.appMapId) {
      throw new HttpError(409, "The failed check does not identify an App Map");
    }
    const operation = currentOperationContext();
    if (!operation) throw new HttpError(500, "Operation context is unavailable");
    const proposalId = `repair:${operation.requestId}`;
    try {
      const appMap = await applyRebasableAppMapMutation(
        scope,
        primary.source.appMapId,
        undefined,
        (map, context) =>
          submitAppMapProposal(
            map,
            campaignRepairProposal({
              map,
              targets,
              request: {
                ...body,
                runId: repairProposalMatch.id!,
                checkId: repairProposalMatch.checkId!,
              },
              proposalId,
              actorId: operation.actorId,
              at: context.at,
            }),
            context,
            { allowServerRepair: true },
          ),
      );
      recordAudit(scope, { action: "run.repair.propose", resource: proposalId, result: "allow" });
      json(response, 200, { repair: primary, appMap, proposalId });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(409, error instanceof Error ? error.message : String(error), {
        code: "CAMPAIGN_REPAIR_PROPOSAL_UNAVAILABLE",
        recovery: "Reload the exact repair target and review its current document revision.",
      });
    }
    return true;
  }

  if (method === "POST" && pathname === "/runs/catalog/rebuild") {
    assertLocalMaintenance(scope);
    json(response, 200, await rebuildRunCatalog(runsRoot()));
    return true;
  }

  if (method === "GET" && pathname === "/runs/storage") {
    assertLocalMaintenance(scope);
    json(response, 200, { policy: "disabled", health: await runStorageHealth(runsRoot()) });
    return true;
  }

  if (method === "POST" && pathname === "/runs/retention") {
    assertLocalMaintenance(scope);
    const body = (await parseJsonBody(request)) as {
      maxAgeDays?: number;
      maxBytes?: number;
      dryRun?: boolean;
    };
    json(response, 200, await applyRunRetention(runsRoot(), body));
    return true;
  }

  const shareRevokeMatch = matchPath(pathname, "/runs/:id/shares/:shareId/revoke");
  if (method === "POST" && shareRevokeMatch) {
    const run = await loadScopedRun(shareRevokeMatch.id!, scope);
    const actor = reviewActor(context);
    const share = await revokeRunShare({
      root: runsRoot(),
      id: shareRevokeMatch.shareId!,
      scope: {
        projectId: run.projectId ?? "local",
        ...(run.ownerId ? { ownerId: run.ownerId } : {}),
        localTrusted: scope.localTrusted,
      },
      actorId: actor.id,
    });
    if (!share) throw new HttpError(404, "Run share not found");
    recordAudit(scope, {
      action: "run.share.revoke",
      resource: `${run.id}:${share.id}`,
      result: "allow",
    });
    json(response, 200, { share });
    return true;
  }

  const sharesMatch = matchPath(pathname, "/runs/:id/shares");
  if (sharesMatch) {
    const run = await loadScopedRun(sharesMatch.id!, scope);
    const shareScope = {
      projectId: run.projectId ?? "local",
      ...(run.ownerId ? { ownerId: run.ownerId } : {}),
      localTrusted: scope.localTrusted,
    };
    if (method === "GET") {
      json(response, 200, {
        shares: await listRunShares(runsRoot(), { ...shareScope, runId: run.id }),
      });
      return true;
    }
    if (method === "POST") {
      const body = (await parseJsonBody(request)) as {
        expiresInHours?: unknown;
        includeBatch?: unknown;
      };
      const expiresInHours = Number(body.expiresInHours);
      if (!Number.isFinite(expiresInHours)) {
        throw new HttpError(400, "expiresInHours is required");
      }
      let created;
      try {
        created = await createRunShare({
          root: runsRoot(),
          run,
          relatedRuns: await listPersistedRuns(1_000),
          actorId: reviewActor(context).id,
          expiresAt: Date.now() + expiresInHours * 60 * 60 * 1_000,
          includeBatch: body.includeBatch === true,
        });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      recordAudit(scope, {
        action: "run.share.create",
        resource: `${run.id}:${created.share.id}`,
        result: "allow",
      });
      json(response, 201, created);
      return true;
    }
  }

  const signalsMatch = matchPath(pathname, "/runs/:id/signals");
  const humanReproofEvidenceMatch = matchPath(
    pathname,
    "/runs/:id/human-intervention-reproof/evidence/:sha256",
  );
  if (method === "GET" && humanReproofEvidenceMatch) {
    const run = await loadScopedRun(humanReproofEvidenceMatch.id!, scope);
    await sendHumanInterventionReproofEvidence({
      response,
      artifacts: run.artifacts,
      sha256: humanReproofEvidenceMatch.sha256!,
    });
    recordAudit(scope, {
      action: "run.human-intervention-reproof.evidence.read",
      resource: `${run.id}:${humanReproofEvidenceMatch.sha256}`,
      result: "allow",
    });
    return true;
  }
  const evidenceMatch = matchPath(pathname, "/runs/:id/evidence");
  if (method === "GET" && evidenceMatch) {
    const run = await loadScopedRun(evidenceMatch.id!, scope);
    const rawLimit = Number(url.searchParams.get("limit") ?? 500);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(2_000, Math.floor(rawLimit)))
      : 500;
    const includeBodies = url.searchParams.get("includeBodies") === "true";
    const testStepId = url.searchParams.get("testStepId")?.trim() || undefined;
    json(response, 200, {
      evidence: await loadRunEvidence(run, {
        limit,
        includeBodies,
        ...(testStepId ? { testStepId } : {}),
      }),
    });
    return true;
  }

  if (method === "GET" && signalsMatch) {
    const run = await loadScopedRun(signalsMatch.id!, scope);
    if (!run.evidence) {
      json(response, 200, { metrics: [], signals: [], reason: "evidence manifest unavailable" });
      return true;
    }
    const metrics = extractEvidenceMetrics(run.evidence, {
      targetProfileId: run.targetProfile?.id,
      appVersion: run.appVersion,
    });
    const history = (await listPersistedRuns(100))
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          candidate.action === run.action &&
          runVisibleToScope(scope, candidate),
      )
      .flatMap((candidate) =>
        candidate.evidence
          ? [
              extractEvidenceMetrics(candidate.evidence, {
                targetProfileId: candidate.targetProfile?.id,
                appVersion: candidate.appVersion,
              }),
            ]
          : [],
      );
    json(response, 200, { metrics, signals: compareEvidenceMetrics(metrics, history) });
    return true;
  }

  const visualPolicyMatch = matchPath(pathname, "/runs/:id/visual-policy");
  if (visualPolicyMatch) {
    const run = await loadScopedRun(visualPolicyMatch.id!, scope);
    if (method === "GET") {
      json(response, 200, { policy: await getVisualComparisonPolicy(runsRoot(), run) });
      return true;
    }
    if (method === "PUT") {
      const body = (await parseJsonBody(request)) as {
        expectedRevision?: unknown;
        changeThreshold?: unknown;
        pixelThreshold?: unknown;
        regions?: unknown;
      };
      return guardVisualVerification(async () => {
        const policy = await updateVisualComparisonPolicy(runsRoot(), run, {
          expectedRevision: body.expectedRevision as number,
          changeThreshold: body.changeThreshold as number,
          pixelThreshold: body.pixelThreshold as number,
          regions: body.regions as VisualRegion[],
          actor: reviewActor(context),
        });
        const comparison = await compareVisualBaseline(runsRoot(), run);
        json(response, 200, { policy, comparison });
      });
    }
  }

  const visualBaselineFrameMatch = matchPath(pathname, "/runs/:id/visual-baseline-frame/:index");
  if (method === "GET" && visualBaselineFrameMatch) {
    const run = await loadScopedRun(visualBaselineFrameMatch.id!, scope);
    const baseline = await getVisualBaseline(
      runsRoot(),
      run.action,
      visualTargetKey(run),
      run.projectId ?? "local",
    );
    const frameIndex = Number(visualBaselineFrameMatch.index);
    const buffer = baseline
      ? await readVisualBaselineFrame(runsRoot(), baseline.id, frameIndex)
      : null;
    if (!buffer) throw new HttpError(404, "Approved baseline frame not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.byteLength,
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
    });
    response.end(buffer);
    return true;
  }

  const visualMatch = matchPath(pathname, "/runs/:id/visual-baseline");
  if (visualMatch) {
    const run = await loadScopedRun(visualMatch.id!, scope);
    if (method === "GET") {
      return guardVisualVerification(async () =>
        json(response, 200, { comparison: await compareVisualBaseline(runsRoot(), run) }),
      );
    }
    if (method === "POST") {
      const body = (await parseJsonBody(request)) as { action?: unknown; note?: unknown };
      if (body.action !== "approve-new-baseline") {
        throw new HttpError(
          400,
          "Visual baseline approval must be an explicit approve-new-baseline review action",
          {
            code: "VISUAL_REVIEW_ACTION_REQUIRED",
            recovery:
              "Send action=approve-new-baseline, or use the visual-review operation for another decision.",
          },
        );
      }
      return guardVisualVerification(async () => {
        const comparison = await compareVisualBaseline(runsRoot(), run);
        const reviewed = await reviewVisualComparison(runsRoot(), run, {
          comparisonId: comparison.id,
          action: "approve-new-baseline",
          actor: reviewActor(context),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        });
        json(response, 200, { comparison, ...reviewed });
      });
    }
  }

  const visualComparisonMatch = matchPath(pathname, "/runs/:id/visual-comparison");
  if (method === "POST" && visualComparisonMatch) {
    const run = await loadScopedRun(visualComparisonMatch.id!, scope);
    await parseJsonBody(request);
    return guardVisualVerification(async () =>
      json(response, 200, { comparison: await compareVisualBaseline(runsRoot(), run) }),
    );
  }

  const visualReviewMatch = matchPath(pathname, "/runs/:id/visual-review");
  if (method === "POST" && visualReviewMatch) {
    const run = await loadScopedRun(visualReviewMatch.id!, scope);
    const body = (await parseJsonBody(request)) as {
      comparisonId?: unknown;
      action?: unknown;
      note?: unknown;
    };
    if (typeof body.comparisonId !== "string" || !body.comparisonId.trim()) {
      throw new HttpError(400, "comparisonId is required", {
        code: "VISUAL_COMPARISON_ID_REQUIRED",
        recovery: "Run visual comparison first and pass its comparison ID.",
      });
    }
    if (!VISUAL_REVIEW_ACTIONS.includes(body.action as (typeof VISUAL_REVIEW_ACTIONS)[number])) {
      throw new HttpError(400, "Unknown visual review action", {
        code: "VISUAL_REVIEW_ACTION_INVALID",
        recovery: `Choose one of: ${VISUAL_REVIEW_ACTIONS.join(", ")}.`,
      });
    }
    return guardVisualVerification(async () =>
      json(
        response,
        200,
        await reviewVisualComparison(runsRoot(), run, {
          comparisonId: body.comparisonId as string,
          action: body.action as (typeof VISUAL_REVIEW_ACTIONS)[number],
          actor: reviewActor(context),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        }),
      ),
    );
  }

  const runReviewMatch = matchPath(pathname, "/runs/:id/review");
  if (method === "POST" && runReviewMatch) {
    const run = await loadScopedRun(runReviewMatch.id!, scope);
    const body = (await parseJsonBody(request)) as {
      action?: unknown;
      note?: unknown;
    };
    if (body.action !== "approve" && body.action !== "reject" && body.action !== "defer") {
      throw new HttpError(400, "Unknown run review action", {
        code: "RUN_REVIEW_ACTION_INVALID",
        recovery:
          "Choose action=approve to mark the check correct, action=reject to reject it, or action=defer to request another review without deciding it.",
      });
    }
    try {
      const reviewed = await reviewPersistedRun(runsRoot(), run, {
        action: body.action,
        actor: reviewActor(context),
        ...(typeof body.note === "string" ? { note: body.note } : {}),
      });
      recordAudit(scope, {
        action: `run.review.${body.action}`,
        resource: run.id,
        result: "allow",
      });
      json(response, 200, reviewed);
    } catch (error) {
      if (error instanceof RunReviewError) {
        const status =
          error.code === "RUN_REVIEW_NOT_FOUND"
            ? 404
            : error.code === "RUN_REVIEW_ACTOR_REQUIRED"
              ? 403
              : 409;
        throw new HttpError(status, error.message, { code: error.code, recovery: error.recovery });
      }
      throw error;
    }
    return true;
  }

  const captureReviewMatch = matchPath(pathname, "/runs/:id/capture-review");
  if (method === "POST" && captureReviewMatch) {
    const run = await loadScopedRun(captureReviewMatch.id!, scope);
    const body = (await parseJsonBody(request)) as {
      captureId?: unknown;
      action?: unknown;
      imageSha256?: unknown;
      note?: unknown;
      expectedReviewVersion?: unknown;
    };
    if (typeof body.captureId !== "string" || !body.captureId.trim()) {
      throw new HttpError(400, "captureId is required", {
        code: "CAPTURE_REVIEW_ID_REQUIRED",
        recovery: "Pass the captureId from the Run captures panel.",
      });
    }
    if (!CAPTURE_REVIEW_ACTIONS.includes(body.action as CaptureReviewAction)) {
      throw new HttpError(400, "Unknown capture review action", {
        code: "CAPTURE_REVIEW_ACTION_INVALID",
        recovery: `Choose one of: ${CAPTURE_REVIEW_ACTIONS.join(", ")}. Looks correct makes that screenshot the reference for later runs.`,
      });
    }
    try {
      const reviewed = await reviewPersistedCapture(runsRoot(), run, {
        captureId: body.captureId.trim(),
        action: body.action as CaptureReviewAction,
        actor: reviewActor(context),
        ...(typeof body.imageSha256 === "string" ? { imageSha256: body.imageSha256 } : {}),
        ...(typeof body.note === "string" ? { note: body.note } : {}),
        ...(typeof body.expectedReviewVersion === "number"
          ? { expectedReviewVersion: body.expectedReviewVersion }
          : {}),
      });
      recordAudit(scope, {
        action: `run.capture.review.${body.action}`,
        resource: run.id,
        result: "allow",
      });
      json(response, 200, reviewed);
    } catch (error) {
      if (error instanceof CaptureReviewError) {
        const status =
          error.code === "CAPTURE_REVIEW_NOT_FOUND"
            ? 404
            : error.code === "CAPTURE_REVIEW_ACTOR_REQUIRED"
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

  const pinMatch = matchPath(pathname, "/runs/:id/pin");
  if (method === "POST" && pinMatch) {
    await loadScopedRun(pinMatch.id!, scope);
    const body = (await parseJsonBody(request)) as { pinned?: boolean };
    if (!(await setRunPinned(runsRoot(), pinMatch.id!, body.pinned !== false))) {
      throw new HttpError(404, "Run not found");
    }
    json(response, 200, { ok: true, pinned: body.pinned !== false });
    return true;
  }

  const storyMatch = matchPath(pathname, "/runs/:id/story");
  if (method === "GET" && storyMatch) {
    const run = await loadScopedRun(storyMatch.id!, scope);
    json(response, 200, { story: buildRunStory(run) });
    return true;
  }

  const playerManifestMatch = matchPath(pathname, "/runs/:id/player-manifest");
  if (method === "GET" && playerManifestMatch) {
    const run = await loadScopedRun(playerManifestMatch.id!, scope);
    const appMapId = resolvePlayerAppMapId(run, url);
    const runs: PersistedRun[] = [run];
    for (const extraId of joinedRunIds(url, run.id)) {
      const extra = await loadScopedRun(extraId, scope);
      assertJoinedRunSharesAppMap(extra, appMapId);
      runs.push(extra);
    }
    const map = await readAppMap(scope.projectId, appMapId);
    if (!map) throw new HttpError(404, `App Map ${appMapId} not found`);
    json(response, 200, { manifest: buildPlayerManifest({ map, runs, now: Date.now() }) });
    return true;
  }

  const walkthroughPackMatch = matchPath(pathname, "/runs/:id/walkthrough-pack");
  if (method === "GET" && walkthroughPackMatch) {
    const run = await loadScopedRun(walkthroughPackMatch.id!, scope);
    const appMapId = resolvePlayerAppMapId(run, url);
    const runs: PersistedRun[] = [run];
    for (const extraId of joinedRunIds(url, run.id)) {
      const extra = await loadScopedRun(extraId, scope);
      assertJoinedRunSharesAppMap(extra, appMapId);
      runs.push(extra);
    }
    const map = await readAppMap(scope.projectId, appMapId);
    if (!map) throw new HttpError(404, `App Map ${appMapId} not found`);
    json(response, 200, {
      pack: await exportWalkthroughPack({ map, runs, now: Date.now() }),
    });
    return true;
  }

  const offlineReplayMatch = matchPath(pathname, "/runs/:id/replay-offline");
  if (method === "GET" && offlineReplayMatch) {
    const run = await loadScopedRun(offlineReplayMatch.id!, scope);
    json(response, 200, { report: replayPersistedRunOffline(run) });
    return true;
  }

  const tracePackMatch = matchPath(pathname, "/runs/:id/trace-pack");
  if (method === "GET" && tracePackMatch) {
    const run = await loadScopedRun(tracePackMatch.id!, scope);
    const tracePack = await exportTracePack(run);
    json(response, 200, { tracePack, analysis: analyzeTracePack(tracePack) });
    return true;
  }

  const persistedMatch = matchPath(pathname, "/runs/:id");
  if (method === "GET" && persistedMatch) {
    const run = await loadScopedRun(persistedMatch.id!, scope);
    json(response, 200, { run });
    return true;
  }

  const frameMatch = matchPath(pathname, "/runs/:id/frames/:file");
  if (method === "GET" && frameMatch) {
    const run = await loadScopedRun(frameMatch.id!, scope);
    const buffer = await readFrameFile(run.dir, frameMatch.file!);
    if (!buffer) throw new HttpError(404, "Frame not found");
    const actual = createHash("sha256").update(buffer).digest("hex");
    const expected = recordedFrameDigests(run, frameMatch.file!);
    if (expected.length > 0 && expected.some((digest) => digest !== actual)) {
      throw new HttpError(409, `Frame ${frameMatch.file} bytes do not match the recorded digest`);
    }
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.byteLength,
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
    });
    response.end(buffer);
    return true;
  }

  const videoMatch = matchPath(pathname, "/runs/:id/video/:file");
  if (method === "GET" && videoMatch) {
    const run = await loadScopedRun(videoMatch.id!, scope);
    const file = runArtifactFile(run.dir, "video", videoMatch.file!);
    if (!file) throw new HttpError(404, "Video not found");
    await streamVideo(request, response, file);
    return true;
  }

  return false;
}

function recordedFrameDigests(
  run: { artifacts?: { kind: string; data: unknown }[] },
  file: string,
): string[] {
  const digests = new Set<string>();
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    if (!("framePath" in data) || !("imageSha256" in data)) continue;
    const framePath = data.framePath;
    const imageSha256 = data.imageSha256;
    if (typeof framePath !== "string" || typeof imageSha256 !== "string" || !imageSha256) continue;
    if (framePath === file || framePath.endsWith(`/${file}`)) digests.add(imageSha256);
  }
  return [...digests];
}

function runPlanAppMapId(run: PersistedRun): string | undefined {
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "app-map-test-plan") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const id = (data as { appMapId?: unknown }).appMapId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

/** The requested map must be the run's stored plan. A query may name the map
 * only when the run itself has no plan identity. */
function resolvePlayerAppMapId(run: PersistedRun, url: URL): string {
  const requested = url.searchParams.get("appMap")?.trim() || undefined;
  const stored = runPlanAppMapId(run);
  if (requested && stored && requested !== stored) {
    throw new HttpError(409, `Run ${run.id} belongs to App Map ${stored}, not ${requested}`);
  }
  const appMapId = requested || stored;
  if (!appMapId) {
    throw new HttpError(422, "Run has no App Map plan identity; pass ?appMap=<id> explicitly");
  }
  return appMapId;
}

function assertJoinedRunSharesAppMap(run: PersistedRun, appMapId: string): void {
  const stored = runPlanAppMapId(run);
  if (stored !== appMapId) {
    throw new HttpError(
      409,
      stored
        ? `Run ${run.id} belongs to App Map ${stored}, not ${appMapId}`
        : `Run ${run.id} has no App Map plan identity and cannot be joined`,
    );
  }
}

function joinedRunIds(url: URL, primaryId: string): string[] {
  const ids: string[] = [];
  const seen = new Set([primaryId]);
  for (const value of url.searchParams.getAll("with")) {
    for (const part of value.split(",")) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

async function streamVideo(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  file: string,
): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, "Video not found");
  }
  const total = info.size;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const requestedStart = range?.[1] ? Number(range[1]) : 0;
  const requestedEnd = range?.[2] ? Number(range[2]) : total - 1;
  const start = Math.max(0, Math.min(requestedStart, total - 1));
  const end = Math.max(start, Math.min(requestedEnd, total - 1));
  const partial = Boolean(range);

  response.writeHead(partial ? 206 : 200, {
    "Content-Type": file.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    "Cache-Control": "private, max-age=3600",
    ...CORS_HEADERS,
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { start, end });
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(response);
  });
}
