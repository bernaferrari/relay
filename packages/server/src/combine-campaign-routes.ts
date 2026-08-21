import {
  AppMapCombineCellContractError,
  cancelJob,
  activeReviewedDocumentOriginsForAppMap,
  currentOperationContext,
  digestAppMapTestExecutionValue,
  enqueuePreparedAppMapCombineCells,
  getJob,
  pendingSelectedCombineCampaignCells,
  prepareAppMapCombineCells,
  projectCombineCampaign,
  readAppMap,
  readCombineCampaign,
  summarizeJob,
  updateCombineCampaign,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { combineCellContractHttpError } from "./app-map-combine-runtime-contract.js";
import { queuedAppMapTestTargetProfile } from "./app-map-run-routes.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { JobRouteContext } from "./job-routes.js";

export async function handleCombineCampaignRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;
  const getMatch = matchPath(pathname, "/jobs/combine/:batchId/campaign");
  if (method === "GET" && getMatch) {
    const campaign = await readCombineCampaign(scope.projectId, getMatch.batchId!);
    if (!campaign || (!scope.localTrusted && campaign.ownerId !== scope.subject)) {
      throw new HttpError(404, "Combine campaign not found");
    }
    json(response, 200, { campaign: await projectCombineCampaign(campaign) });
    return true;
  }

  const resumeMatch = matchPath(pathname, "/jobs/combine/:batchId/resume");
  if (method === "POST" && resumeMatch) {
    const body = (await parseJsonBody(request)) as { reviewed?: boolean };
    const campaignId = resumeMatch.batchId!;
    const existing = await readCombineCampaign(scope.projectId, campaignId);
    if (!existing || (!scope.localTrusted && existing.ownerId !== scope.subject)) {
      throw new HttpError(404, "Combine campaign not found");
    }
    const projected = await projectCombineCampaign(existing);
    if (projected.status === "pilot-running" || projected.status === "running") {
      throw new HttpError(409, "Combine campaign is still running");
    }
    if (projected.status === "needs-review" && body.reviewed !== true) {
      throw new HttpError(
        409,
        "Pilot needs review. Repair or accept the observed difference, then resume with reviewed=true.",
      );
    }
    if (projected.status === "cancelled") {
      throw new HttpError(409, "Combine campaign is cancelled");
    }
    const map = await readAppMap(scope.projectId, projected.appMapId);
    if (!map) throw new HttpError(409, "The campaign App Map no longer exists");
    const combine = map.combines?.[projected.combineId];
    if (!combine) throw new HttpError(409, "The campaign Combine no longer exists");
    const runtime = { ...context.runtime };
    try {
      const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
      const prepared = await prepareAppMapCombineCells({
        map,
        combine,
        selected: projected.execution.selected ?? combine.selected,
        strategy: projected.execution.strategy ?? combine.strategy,
        cellRuntimeProfiles: combine.cellRuntimeProfiles,
        selectedCellIds: projected.execution.selectedCellIds,
        target: {
          targetId: projected.target.id,
          platform: projected.target.platform,
        },
        compileOptions: { reviewedDocumentOrigins },
      });
      const preparedById = new Map(prepared.cells.map((cell) => [cell.cellId, cell]));
      for (const item of projected.cases) {
        const preparedCell = preparedById.get(item.cellId);
        if (!preparedCell) {
          throw new HttpError(409, `Campaign cell ${item.cellId} is no longer on this Combine.`, {
            code: "APP_MAP_COMBINE_CELL_CONTRACT",
            cellId: item.cellId,
            testId: item.testId,
          });
        }
        if (preparedCell.outerIntent.digest !== item.outerIntentDigest) {
          throw new HttpError(
            409,
            `Campaign cell ${item.cellId} identity changed since the pilot.`,
            {
              code: "APP_MAP_COMBINE_CELL_CONTRACT",
              cellId: item.cellId,
              testId: item.testId,
              recovery:
                "Start a new Combine campaign. Resume will not accept a tampered selector or profile.",
            },
          );
        }
        if (digestAppMapTestExecutionValue(preparedCell.staticInputs) !== item.staticInputDigest) {
          throw new HttpError(
            409,
            `Campaign cell ${item.cellId} static inputs changed since the pilot.`,
            {
              code: "APP_MAP_COMBINE_CELL_CONTRACT",
              cellId: item.cellId,
              testId: item.testId,
            },
          );
        }
      }
      const pending = pendingSelectedCombineCampaignCells(projected);
      if (!pending.length) {
        json(response, 200, { campaign: projected, jobs: [], cells: prepared.cellStates });
        return true;
      }
      await (runtime.assertTargetControl ?? assertTargetControl)(scope, existing.target.id);
      const toQueue = pending.map((item) => preparedById.get(item.cellId)!);
      const batch = enqueuePreparedAppMapCombineCells({
        cells: toQueue,
        batchId: projected.id,
        title: projected.execution.title,
        targetId: projected.target.id,
        platform: projected.target.platform === "browser" ? undefined : projected.target.platform,
        targetKind: projected.target.kind,
        browserTargetId: projected.target.kind === "browser" ? projected.target.id : undefined,
        queuedTargetProfile: (cell) =>
          queuedAppMapTestTargetProfile({
            runtimeTargetProfile: cell.selectedRuntimeTargetProfile,
            observedTargetProfile: undefined,
            target: {
              kind: projected.target.kind,
              targetId: projected.target.id,
              platform: projected.target.platform,
            },
          }),
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
      const jobByCell = new Map(batch.jobs.map((job, index) => [toQueue[index]?.cellId, job]));
      const at = Date.now();
      const updated = await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
        ...current,
        latestRevision: map.revision,
        updatedAt: at,
        status: "running",
        cases: current.cases.map((item) => {
          const job = jobByCell.get(item.cellId);
          return job ? { ...item, status: "queued" as const, jobId: job.id } : item;
        }),
        lineage: [
          ...current.lineage,
          {
            kind: "resumed",
            at,
            appMapRevision: map.revision,
            actorId: currentOperationContext()!.actorId,
          },
        ],
      }));
      json(response, 202, {
        campaign: await projectCombineCampaign(updated),
        jobs: batch.jobs.map((job) => summarizeJob(job)),
        cells: prepared.cellStates,
      });
      return true;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof AppMapCombineCellContractError)
        throw combineCellContractHttpError(error);
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
  }

  const cancelMatch = matchPath(pathname, "/jobs/combine/:batchId/cancel");
  if (method === "POST" && cancelMatch) {
    const campaignId = cancelMatch.batchId!;
    const existing = await readCombineCampaign(scope.projectId, campaignId);
    if (!existing || (!scope.localTrusted && existing.ownerId !== scope.subject)) {
      throw new HttpError(404, "Combine campaign not found");
    }
    for (const item of existing.cases) {
      if (!item.jobId) continue;
      const job = getJob(item.jobId);
      if (job && (job.status === "queued" || job.status === "running" || job.status === "paused")) {
        cancelJob(job.id);
      }
    }
    const at = Date.now();
    const updated = await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
      ...current,
      status: "cancelled",
      updatedAt: at,
      cases: current.cases.map((item) =>
        item.jobId ? item : { ...item, status: "cancelled" as const },
      ),
      lineage: [
        ...current.lineage,
        {
          kind: "cancelled",
          at,
          appMapRevision: current.latestRevision,
          actorId: currentOperationContext()!.actorId,
        },
      ],
    }));
    json(response, 200, { campaign: await projectCombineCampaign(updated) });
    return true;
  }
  return false;
}
