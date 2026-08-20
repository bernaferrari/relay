import {
  cancelJob,
  compileAppMapCombine,
  currentOperationContext,
  getJob,
  projectCombineCampaign,
  readAppMap,
  readCombineCampaign,
  startOptionRecipeRun,
  summarizeJob,
  updateCombineCampaign,
  type OptionRunSet,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { requireAppMapCombineRuntimeProfileContract } from "./app-map-combine-runtime-contract.js";
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
    requireAppMapCombineRuntimeProfileContract({
      appMapId: existing.appMapId,
      combineId: existing.combineId,
    });
    await assertTargetControl(scope, existing.target.id);
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
    const pendingIndexes = projected.cases.filter((item) => !item.jobId).map((item) => item.index);
    if (!pendingIndexes.length) {
      json(response, 200, { campaign: projected, jobs: [] });
      return true;
    }
    const map = await readAppMap(scope.projectId, projected.appMapId);
    if (!map) throw new HttpError(409, "The campaign App Map no longer exists");
    const combine = map.combines?.[projected.combineId];
    if (!combine) throw new HttpError(409, "The campaign Combine no longer exists");
    const sets: OptionRunSet[] = combine.variableIds.map((id) => {
      const set = map.variables?.[id];
      if (!set) throw new HttpError(409, `Campaign Variable ${id} no longer exists`);
      return {
        id: set.id,
        name: set.name,
        kind: set.kind,
        apply: set.apply as OptionRunSet["apply"],
        options: set.options,
        restoreId: set.restoreId,
        screenshotEach: set.screenshotEach,
      };
    });
    const compiled = compileAppMapCombine(map, combine);
    const batch = await startOptionRecipeRun({
      recipeId: compiled.root.id,
      compiledBody: compiled.root,
      compiledGraph: compiled.graph,
      map,
      targetId: projected.target.id,
      platform: projected.target.platform === "browser" ? undefined : projected.target.platform,
      targetKind: projected.target.kind,
      browserTargetId: projected.target.kind === "browser" ? projected.target.id : undefined,
      request: {
        sets,
        combineId: combine.id,
        selected: projected.execution.selected,
        strategy: projected.execution.strategy,
        screenshotEach: false,
      },
      title: projected.execution.title,
      seed: projected.execution.seed,
      projectId: scope.projectId,
      ownerId: currentOperationContext()!.actorId,
      batchId: projected.id,
      caseIndexes: pendingIndexes,
      expectedCaseValues: Object.fromEntries(
        projected.cases
          .filter((item) => pendingIndexes.includes(item.index))
          .map((item) => [item.index, item.values]),
      ),
    });
    const jobByIndex = new Map(batch.jobs.map((job) => [job.caseIndex, job]));
    const at = Date.now();
    const updated = await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
      ...current,
      latestRevision: map.revision,
      updatedAt: at,
      status: "running",
      cases: current.cases.map((item) => {
        const job = jobByIndex.get(item.index);
        return job ? { ...item, status: "queued", jobId: job.id } : item;
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
    });
    return true;
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
