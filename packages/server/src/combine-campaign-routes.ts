import {
  AppMapCombineCellContractError,
  KeyedSerialQueue,
  buildTargetProfiles,
  cancelJob,
  activeReviewedDocumentOriginsForAppMap,
  currentOperationContext,
  digestAppMapTestExecutionValue,
  stagePreparedAppMapCombineCells,
  getJob,
  findActiveRepeatCampaigns,
  listDeviceLeases,
  listDevices,
  listTargetWorkers,
  listTargets,
  localExecutionTargetRef,
  prepareSelectedCombineCampaignResume,
  prepareAppMapCombineCells,
  preparedCellsFixtureStartBlocker,
  projectCombineCampaign,
  reconcileCausalCombineRerun,
  readAppMap,
  snapshotPlayerMap,
  readCombineCampaign,
  readPersistedRun,
  accountReloginFindingsReport,
  buildRepeatFailureClusters,
  repeatFailureClusterCellIds,
  releaseDeviceLease,
  summarizeJob,
  updateCombineCampaign,
  updateCombineCampaignTriage,
  CombineCampaignTriageError,
} from "@relay/core";
import {
  COMBINE_TRIAGE_STATUSES,
  executionTargetRefKey,
  repeatFailureKindSchema,
  type AppMapCombineCellTargetBinding,
  type CombineCampaign,
} from "@relay/protocol";
import { admitTargetControl, assertTargetControl } from "./access-control.js";
import { combineCellContractHttpError } from "./app-map-combine-runtime-contract.js";
import { queuedAppMapTestTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { JobRouteContext } from "./job-routes.js";
import { assertRepeatWorkflowMutation } from "./repeat-workflow-receipt.js";
import {
  admitAndStageLocalCombineCampaign,
  localCampaignAdmissionRequestForActiveWorkItems,
  localCampaignAdmissionWorkItemsForCombine,
  type LocalCombineCampaignAdmission,
} from "./local-combine-campaign-admission.js";

function repeatRerunCellIds(
  body: {
    cellIds?: string[];
    executionCaseIds?: string[];
    clusterIds?: string[];
  },
  report: ReturnType<typeof buildRepeatFailureClusters>,
): string[] | undefined {
  if (
    body.cellIds === undefined &&
    body.executionCaseIds === undefined &&
    body.clusterIds === undefined
  )
    return undefined;
  const requested = new Set(
    [...(body.cellIds ?? []), ...(body.executionCaseIds ?? [])]
      .map((id) => id.trim())
      .filter(Boolean),
  );
  if (body.cellIds && requested.size !== body.cellIds.length) {
    throw new HttpError(400, "cellIds must contain unique non-empty ids", {
      code: "REPEAT_RERUN_SCOPE_INVALID",
    });
  }
  if (body.clusterIds !== undefined) {
    const clusterIds = body.clusterIds.map((id) => id.trim()).filter(Boolean);
    if (!clusterIds.length || new Set(clusterIds).size !== clusterIds.length) {
      throw new HttpError(400, "clusterIds must contain unique non-empty ids", {
        code: "REPEAT_RERUN_SCOPE_INVALID",
      });
    }
    const known = new Set(report.clusters.map((cluster) => cluster.id));
    const unknown = clusterIds.find((id) => !known.has(id));
    if (unknown) {
      throw new HttpError(409, `Repeat failure cluster ${unknown} is not present`, {
        code: "REPEAT_FAILURE_CLUSTER_NOT_FOUND",
        recovery: "Inspect the current immutable Repeat failure clusters before rerunning.",
      });
    }
    for (const id of repeatFailureClusterCellIds(report, clusterIds)) requested.add(id);
  }
  if (!requested.size) {
    throw new HttpError(400, "The Repeat rerun scope cannot be empty", {
      code: "REPEAT_RERUN_SCOPE_INVALID",
    });
  }
  return [...requested].sort();
}

const campaignDecisionLocks = new KeyedSerialQueue();

function targetBindingsForCampaign(campaign: CombineCampaign): AppMapCombineCellTargetBinding[] {
  const legacyTarget = campaign.target
    ? localExecutionTargetRef({ targetId: campaign.target.id, platform: campaign.target.platform })
    : undefined;
  return campaign.cases.map((item) => {
    const target = item.target ?? legacyTarget;
    if (!target) {
      throw new HttpError(409, `Campaign cell ${item.cellId} has no frozen execution target.`, {
        code: "COMBINE_CAMPAIGN_TARGET_BINDING_MISSING",
        cellId: item.cellId,
        recovery:
          "Start a new Combine campaign with explicit per-cell target bindings. Relay will not infer a target during resume.",
      });
    }
    return {
      testId: item.testId,
      values: structuredClone(item.values),
      target: structuredClone(target),
    };
  });
}

function queuedProfileTarget(
  cell: Awaited<ReturnType<typeof prepareAppMapCombineCells>>["cells"][number],
) {
  const target = cell.executionTarget;
  return {
    kind: target.kind === "local-browser" ? ("browser" as const) : ("device" as const),
    targetId: target.targetId,
    platform: target.platform,
  };
}

export async function handleCombineCampaignRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, request, response, scope } = context;
  const clusterMatch = matchPath(pathname, "/jobs/combine/:batchId/repeat/clusters");
  if (method === "GET" && clusterMatch) {
    const campaign = await readCombineCampaign(scope.projectId, clusterMatch.batchId!);
    if (!campaign || (!scope.localTrusted && campaign.ownerId !== scope.subject)) {
      throw new HttpError(404, "Combine campaign not found");
    }
    const projected = await projectCombineCampaign(campaign);
    const search = new URL(request.url ?? pathname, "http://relay.local").searchParams;
    const rawFailureKind = search.get("failureKind");
    const parsedFailureKind = rawFailureKind
      ? repeatFailureKindSchema.safeParse(rawFailureKind)
      : undefined;
    if (rawFailureKind && !parsedFailureKind?.success) {
      throw new HttpError(400, "failureKind is unsupported", {
        code: "REPEAT_FAILURE_FILTER_INVALID",
      });
    }
    const failureKind = parsedFailureKind?.success ? parsedFailureKind.data : undefined;
    const cohort = search.get("cohort")?.trim() || undefined;
    const runs = (
      await Promise.all(
        projected.cases.filter((item) => item.runId).map((item) => readPersistedRun(item.runId!)),
      )
    ).filter((run): run is NonNullable<typeof run> => Boolean(run));
    const report = buildRepeatFailureClusters(projected, runs, {
      ...(failureKind ? { failureKind } : {}),
      ...(cohort ? { cohort } : {}),
    });
    json(response, 200, report);
    return true;
  }
  if (method === "GET" && pathname === "/jobs/combine/repeat/active") {
    const search = new URL(request.url ?? pathname, "http://relay.local").searchParams;
    const appMapId = search.get("appMapId")?.trim() ?? "";
    const testId = search.get("testId")?.trim() ?? "";
    if (!appMapId || !testId) throw new HttpError(400, "appMapId and testId are required");
    const visible = (await findActiveRepeatCampaigns(scope.projectId, appMapId, testId)).filter(
      (campaign) => scope.localTrusted || campaign.ownerId === scope.subject,
    );
    if (visible.length > 1) {
      throw new HttpError(409, "More than one unfinished Repeat matches this Test", {
        code: "AMBIGUOUS_ACTIVE_REPEAT",
        recovery: "Open Runs and choose the Repeat to inspect or stop.",
      });
    }
    json(response, 200, {
      campaign: visible[0] ? await projectCombineCampaign(visible[0]) : null,
    });
    return true;
  }
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
    const body = (await parseJsonBody(request)) as {
      reviewed?: boolean;
      expectedAppMapRevision?: number;
      cellIds?: string[];
      executionCaseIds?: string[];
      clusterIds?: string[];
      workflowMutation?: NonNullable<
        NonNullable<CombineCampaign["execution"]>["repeat"]
      >["workflowMutation"];
    };
    const campaignId = resumeMatch.batchId!;
    return campaignDecisionLocks.run(`${scope.projectId}:${campaignId}`, async () => {
      const existing = await readCombineCampaign(scope.projectId, campaignId);
      if (!existing || (!scope.localTrusted && existing.ownerId !== scope.subject)) {
        throw new HttpError(404, "Combine campaign not found");
      }
      if (body.workflowMutation) {
        await assertRepeatWorkflowMutation({
          scope,
          mutation: body.workflowMutation,
          campaignId,
        });
      }
      const projected = await projectCombineCampaign(existing);
      const hasExplicitRerunScope =
        body.cellIds !== undefined ||
        body.executionCaseIds !== undefined ||
        body.clusterIds !== undefined;
      let explicitRerunCellIds: string[] | undefined;
      if (hasExplicitRerunScope) {
        const runs = (
          await Promise.all(
            projected.cases
              .filter((item) => item.runId)
              .map((item) => readPersistedRun(item.runId!)),
          )
        ).filter((run): run is NonNullable<typeof run> => Boolean(run));
        const report = buildRepeatFailureClusters(projected, runs);
        explicitRerunCellIds = repeatRerunCellIds(body, report);
        if (body.reviewed !== true) {
          throw new HttpError(409, "Selective Repeat reruns require explicit evidence review.", {
            code: "REPEAT_TERMINAL_REVIEW_REQUIRED",
            cellIds: body.executionCaseIds ? undefined : explicitRerunCellIds,
            executionCaseIds: body.executionCaseIds,
            recovery:
              "Inspect the immutable representative and member Runs, then resume with reviewed=true.",
          });
        }
      }
      if (projected.status === "pilot-running" || projected.status === "running") {
        throw new HttpError(409, "Combine campaign is still running");
      }
      if (projected.status === "needs-review" && body.reviewed !== true) {
        const repeatResume = projected.execution.repeat?.resolved.resume;
        throw new HttpError(
          409,
          "Pilot needs review. Repair or accept the observed difference, then resume with reviewed=true.",
          repeatResume === "failed" || repeatResume === "all"
            ? {
                code: "REPEAT_TERMINAL_REVIEW_REQUIRED",
                recovery:
                  "Inspect the immutable Runs, then resume with reviewed=true to retry only eligible non-passing results.",
              }
            : undefined,
        );
      }
      if (projected.status === "cancelled") {
        throw new HttpError(409, "Combine campaign is cancelled");
      }
      const map = await readAppMap(scope.projectId, projected.appMapId);
      if (!map) throw new HttpError(409, "The campaign App Map no longer exists");
      if (
        body.expectedAppMapRevision !== undefined &&
        map.revision !== body.expectedAppMapRevision
      ) {
        throw new HttpError(
          409,
          `Expected App Map revision ${body.expectedAppMapRevision}, current revision is ${map.revision}`,
          {
            code: "revision-conflict",
            currentRevision: map.revision,
            recovery:
              "Inspect the changed Test and start a new Repeat. Relay will not continue a frozen Repeat against different App Map content.",
          },
        );
      }
      const combine = map.combines?.[projected.combineId];
      if (!combine) throw new HttpError(409, "The campaign Combine no longer exists");
      const runtime = { ...context.runtime };
      let staged: ReturnType<typeof stagePreparedAppMapCombineCells> | undefined;
      let admission: LocalCombineCampaignAdmission | undefined;
      let resumePersisted = false;
      let resumedCellIds = new Set<string>();
      try {
        const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
        const prepared = await prepareAppMapCombineCells({
          map,
          combine,
          selected: projected.execution.selected ?? combine.selected,
          strategy: projected.execution.strategy ?? combine.strategy,
          cellRuntimeProfiles: projected.cases.map((item) => ({
            testId: item.testId,
            values: { ...item.values },
            targetProfileId: item.targetProfileId,
          })),
          selectedCellIds: projected.execution.selectedCellIds,
          cellTargetBindings: targetBindingsForCampaign(projected),
          compileOptions: { reviewedDocumentOrigins },
          ...(projected.execution.laneId ? { laneId: projected.execution.laneId } : {}),
        });
        const preparedById = new Map(
          prepared.cells.map((cell) => [
            cell.executionCaseId ??
              projected.cases.find(
                (item) =>
                  item.cellId === cell.cellId && item.targetProfileId === cell.targetProfileId,
              )?.executionCaseId ??
              cell.cellId,
            cell,
          ]),
        );
        const causalRerun = reconcileCausalCombineRerun(
          projected,
          map,
          prepared.cells.map((cell) => ({
            cellId: cell.cellId,
            testId: cell.testId,
            plannedCaptures: structuredClone(cell.childIntent.plan.plannedSlots ?? []),
            childIntentDigest: digestAppMapTestExecutionValue(cell.childIntent),
            outerIntentDigest: cell.outerIntent.digest,
            wrapperGraphDigest: cell.outerIntent.wrapper.recipeGraphDigest,
            staticInputDigest: digestAppMapTestExecutionValue(cell.staticInputs),
          })),
          explicitRerunCellIds ? { onlyCellIds: explicitRerunCellIds } : {},
        );
        const resumePlan = prepareSelectedCombineCampaignResume(
          causalRerun.campaign,
          body.executionCaseIds
            ? { executionCaseIds: body.executionCaseIds }
            : explicitRerunCellIds
              ? { cellIds: explicitRerunCellIds }
              : {},
        );
        if (resumePlan.retriedTerminalCellIds.length && body.reviewed !== true) {
          throw new HttpError(
            409,
            "Retrying completed Repeat results requires explicit evidence review.",
            {
              code: "REPEAT_TERMINAL_REVIEW_REQUIRED",
              cellIds: resumePlan.retriedTerminalCellIds,
              recovery:
                "Inspect the immutable Runs, then resume with reviewed=true to retry only eligible non-passing results.",
            },
          );
        }
        const resumeCampaign = resumePlan.campaign;
        for (const item of resumeCampaign.cases) {
          const preparedCell =
            preparedById.get(item.executionCaseId ?? item.cellId) ?? preparedById.get(item.cellId);
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
          if (
            digestAppMapTestExecutionValue(preparedCell.staticInputs) !== item.staticInputDigest
          ) {
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
        const pendingIds = new Set(resumePlan.selectedExecutionCaseIds);
        const pending = resumeCampaign.cases.filter(
          (item) =>
            item.status === "pending" && pendingIds.has(item.executionCaseId ?? item.cellId),
        );
        if (!pending.length) {
          const noOp = body.workflowMutation
            ? await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
                ...current,
                updatedAt: Date.now(),
                execution: {
                  ...current.execution,
                  repeat: current.execution.repeat
                    ? { ...current.execution.repeat, workflowMutation: body.workflowMutation }
                    : undefined,
                },
              }))
            : projected;
          json(response, 200, {
            campaign: await projectCombineCampaign(noOp),
            jobs: [],
            cells: prepared.cellStates,
          });
          return true;
        }
        const toQueue = pending.map(
          (item) =>
            preparedById.get(item.executionCaseId ?? item.cellId) ?? preparedById.get(item.cellId)!,
        );
        const resumeAccountBlocker = await preparedCellsFixtureStartBlocker({
          projectId: scope.projectId,
          cells: toQueue,
        });
        if (resumeAccountBlocker) {
          throw new HttpError(409, resumeAccountBlocker, {
            code: "ACCOUNT_NEEDS_RELOGIN",
            recovery: "Open Sign-ins, complete OAuth, then Refresh.",
            findings: accountReloginFindingsReport({ detail: resumeAccountBlocker }),
          });
        }
        resumedCellIds = new Set(pending.map((item) => item.executionCaseId ?? item.cellId));
        const observedTargetProfiles = buildTargetProfiles({
          devices: await (runtime.listDevices ?? listDevices)().catch(() => []),
          targets: await listTargets(),
        });
        const localAdmission = resumeCampaign.execution.localAdmission;
        const stageCells = (acceptedAdmission?: LocalCombineCampaignAdmission) =>
          stagePreparedAppMapCombineCells({
            cells: toQueue,
            playerMapSnapshot: snapshotPlayerMap(map),
            combineId: projected.combineId,
            batchId: projected.id,
            title: projected.execution.title,
            targetForCell: (cell) => cell.executionTarget,
            operationContextForCell: acceptedAdmission?.operationContextForCell,
            queuedTargetProfile: (cell) =>
              queuedAppMapTestTargetProfile({
                runtimeTargetProfile: cell.selectedRuntimeTargetProfile,
                observedTargetProfile: observedTargetProfiles.find(
                  (profile) =>
                    profile.targetId === cell.executionTarget.targetId &&
                    profile.source ===
                      (cell.executionTarget.kind === "local-browser" ? "browser" : "device"),
                ),
                target: queuedProfileTarget(cell),
              }),
            projectId: scope.projectId,
            ownerId: currentOperationContext()!.actorId,
            ...(projected.execution.laneId ? { laneId: projected.execution.laneId } : {}),
            ...(projected.execution.unsignedLaneId
              ? { unsignedLaneId: projected.execution.unsignedLaneId }
              : {}),
          });
        if (localAdmission) {
          const admissionRequest = localCampaignAdmissionRequestForActiveWorkItems({
            request: localAdmission.request,
            activeWorkItems: localCampaignAdmissionWorkItemsForCombine(toQueue),
            knownWorkItems: localCampaignAdmissionWorkItemsForCombine(prepared.selectedCells),
          });
          const admitted = await admitAndStageLocalCombineCampaign({
            scope,
            cells: toQueue,
            request: admissionRequest,
            runtime: {
              listDevices: runtime.listDevices ?? listDevices,
              listDeviceLeases: runtime.listDeviceLeases ?? listDeviceLeases,
              listTargetWorkers: runtime.listTargetWorkers ?? listTargetWorkers,
              assertTargetControl: runtime.assertTargetControl ?? assertTargetControl,
              admitTargetControl: runtime.admitTargetControl ?? admitTargetControl,
              releaseDeviceLease: runtime.releaseDeviceLease ?? releaseDeviceLease,
              ...(runtime.verifyCampaignDurationCohortEvidence
                ? {
                    verifyCampaignDurationCohortEvidence:
                      runtime.verifyCampaignDurationCohortEvidence,
                  }
                : {}),
            },
            stage: stageCells,
          });
          admission = admitted.admission;
          staged = admitted.staged;
        } else {
          const targets = new Map(
            toQueue.map((cell) => [
              executionTargetRefKey(cell.executionTarget),
              cell.executionTarget,
            ]),
          );
          if (targets.size !== 1) {
            throw new HttpError(
              409,
              "This multi-target campaign has no frozen local admission plan.",
              {
                code: "LOCAL_COMBINE_ADMISSION_REQUIRED",
                recovery:
                  "Start a new Combine campaign with explicit per-cell target bindings and localAdmission. Relay will not resume multi-target work on assumed capacity.",
              },
            );
          }
          const target = targets.values().next().value;
          if (!target) throw new Error("Combine campaign target resolution failed");
          await (runtime.assertTargetControl ?? assertTargetControl)(scope, target.targetId);
          staged = stageCells();
        }
        const jobByCell = new Map(
          staged.jobs.map((job, index) => [
            toQueue[index]?.executionCaseId ?? toQueue[index]?.cellId,
            job,
          ]),
        );
        const at = Date.now();
        const updated = await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
          ...current,
          latestRevision: map.revision,
          updatedAt: at,
          status: "running",
          cases: resumeCampaign.cases.map((item) => {
            const job = jobByCell.get(item.executionCaseId ?? item.cellId);
            return job ? { ...item, status: "queued" as const, jobId: job.id } : item;
          }),
          lineage: [
            ...current.lineage,
            {
              kind: "resumed",
              at,
              appMapRevision: map.revision,
              actorId: currentOperationContext()!.actorId,
              ...(causalRerun.proposalIds.length
                ? {
                    causalRepairProposalIds: causalRerun.proposalIds,
                    affectedCheckIds: causalRerun.affectedCheckIds,
                    affectedCellIds: causalRerun.affectedCellIds,
                  }
                : {}),
            },
          ],
          execution: {
            ...current.execution,
            repeat:
              current.execution.repeat && body.workflowMutation
                ? { ...current.execution.repeat, workflowMutation: body.workflowMutation }
                : current.execution.repeat,
          },
        }));
        resumePersisted = true;
        const acceptedAdmission = admission;
        await acceptedAdmission?.commit();
        staged.activate();
        await acceptedAdmission?.finalize();
        admission = undefined;
        const batch = { batchId: staged.batchId, jobs: staged.dispatch() };
        staged = undefined;
        resumePersisted = false;
        json(response, 202, {
          campaign: await projectCombineCampaign(updated),
          jobs: batch.jobs.map((job) => summarizeJob(job)),
          cells: prepared.cellStates,
          ...(acceptedAdmission
            ? {
                admission: {
                  preflight: acceptedAdmission.preflight,
                  targetPreflights: acceptedAdmission.targetPreflights,
                },
              }
            : {}),
        });
        return true;
      } catch (error) {
        const cleanupErrors: string[] = [];
        try {
          staged?.rollback();
        } catch (cleanupError) {
          cleanupErrors.push(
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          );
        }
        try {
          await admission?.rollback();
        } catch (cleanupError) {
          cleanupErrors.push(
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          );
        }
        if (resumePersisted) {
          try {
            const priorById = new Map(
              projected.cases.map((item) => [item.executionCaseId ?? item.cellId, item]),
            );
            await updateCombineCampaign(scope.projectId, campaignId, (current) => ({
              ...current,
              status: projected.status,
              updatedAt: Date.now(),
              cases: current.cases.map((item) => {
                const executionId = item.executionCaseId ?? item.cellId;
                if (!resumedCellIds.has(executionId)) return item;
                return priorById.get(executionId) ?? item;
              }),
            }));
          } catch (cleanupError) {
            cleanupErrors.push(
              cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            );
          }
        }
        if (cleanupErrors.length) {
          throw new HttpError(
            500,
            `Combine resume failed and Relay could not fully compensate staged work: ${cleanupErrors.join("; ")}`,
          );
        }
        if (error instanceof HttpError) throw error;
        if (error instanceof AppMapCombineCellContractError)
          throw combineCellContractHttpError(error);
        throw new HttpError(409, error instanceof Error ? error.message : String(error));
      }
    });
  }

  const cancelMatch = matchPath(pathname, "/jobs/combine/:batchId/cancel");
  if (method === "POST" && cancelMatch) {
    const campaignId = cancelMatch.batchId!;
    const body = (await parseJsonBody(request)) as {
      workflowMutation?: NonNullable<
        NonNullable<CombineCampaign["execution"]>["repeat"]
      >["workflowMutation"];
    };
    return campaignDecisionLocks.run(`${scope.projectId}:${campaignId}`, async () => {
      const existing = await readCombineCampaign(scope.projectId, campaignId);
      if (!existing || (!scope.localTrusted && existing.ownerId !== scope.subject)) {
        throw new HttpError(404, "Combine campaign not found");
      }
      if (body.workflowMutation) {
        await assertRepeatWorkflowMutation({ scope, mutation: body.workflowMutation, campaignId });
      }
      const projected = await projectCombineCampaign(existing);
      for (const item of projected.cases) {
        if (!item.jobId) continue;
        const job = getJob(item.jobId);
        if (
          job &&
          (job.status === "queued" || job.status === "running" || job.status === "paused")
        ) {
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
        execution: {
          ...current.execution,
          repeat:
            current.execution.repeat && body.workflowMutation
              ? { ...current.execution.repeat, workflowMutation: body.workflowMutation }
              : current.execution.repeat,
        },
      }));
      json(response, 200, { campaign: await projectCombineCampaign(updated) });
      return true;
    });
  }

  const triageMatch = matchPath(pathname, "/jobs/combine/:batchId/triage");
  if (method === "POST" && triageMatch) {
    const campaignId = triageMatch.batchId!;
    const body = (await parseJsonBody(request)) as {
      caseIds?: unknown;
      triageStatus?: unknown;
      assignee?: unknown;
    };
    return campaignDecisionLocks.run(`${scope.projectId}:${campaignId}`, async () => {
      const existing = await readCombineCampaign(scope.projectId, campaignId);
      if (!existing || (!scope.localTrusted && existing.ownerId !== scope.subject)) {
        throw new HttpError(404, "Combine campaign not found");
      }
      const caseIds = Array.isArray(body.caseIds)
        ? body.caseIds.filter((id): id is string => typeof id === "string")
        : [];
      const triageStatus = COMBINE_TRIAGE_STATUSES.find((status) => status === body.triageStatus);
      if (typeof body.triageStatus === "string" && triageStatus === undefined) {
        throw new HttpError(400, "triageStatus is unsupported", {
          code: "COMBINE_TRIAGE_INVALID_STATUS",
        });
      }
      try {
        const updated = await updateCombineCampaignTriage(scope.projectId, campaignId, {
          caseIds,
          ...(triageStatus ? { triageStatus } : {}),
          ...(typeof body.assignee === "string" ? { assignee: body.assignee } : {}),
          actorId: currentOperationContext()!.actorId,
        });
        json(response, 200, { campaign: await projectCombineCampaign(updated) });
      } catch (error) {
        if (error instanceof CombineCampaignTriageError) {
          throw new HttpError(
            error.code === "COMBINE_TRIAGE_UNKNOWN_CASE" ? 404 : 400,
            error.message,
            { code: error.code },
          );
        }
        throw error;
      }
      return true;
    });
  }
  return false;
}
