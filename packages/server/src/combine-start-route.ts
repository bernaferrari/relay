import http from "node:http";
import type { SourceRevision } from "@relay/protocol";
import type {
  AppMapCapturePolicy,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
  AppMapCombineCellTargetBinding,
  AppMapCompiledTest,
  CombineCampaign,
} from "@relay/protocol";
import { executionTargetRefKey } from "@relay/protocol";
import {
  AppMapCombineCellContractError,
  AppMapCombineWorldError,
  AppMapCompileError,
  activeReviewedDocumentOriginsForAppMap,
  applyFullSurfaceDestinationBindings,
  combineCampaignCaseFromPreparedCell,
  createCombineCampaign,
  currentOperationContext,
  prepareAppMapCombineCells,
  readAppMap,
  resolveCombineCellSelector,
  stagePreparedAppMapCombineCells,
  summarizeJob,
  updateCombineCampaign,
} from "@relay/core";
import {
  assertPreparedCombineCells,
  combineCellContractHttpError,
  requireSingleTestUseAppMapTestRun,
} from "./app-map-combine-runtime-contract.js";
import { queuedAppMapTestTargetProfile } from "./app-map-test-target-profile.js";
import { HttpError, json, parseJsonBody } from "./http.js";
import type { JobRouteRuntime } from "./job-routes.js";
import {
  admitAndStageLocalCombineCampaign,
  localCampaignAdmissionRequestForActiveWorkItems,
  localCampaignAdmissionWorkItemsForCombine,
  type LocalCombineCampaignAdmission,
  type LocalCombineCampaignAdmissionRequest,
} from "./local-combine-campaign-admission.js";
import type { RequestContext } from "./security.js";

type CombineStartRequest = {
  appMapId?: string;
  testId?: string;
  combineId?: string;
  variableIds?: string[];
  selected?: Record<string, string[]>;
  selectedCellIds?: string[];
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
  /** Explicit local execution target for every selected Test × world cell. */
  cellTargetBindings?: AppMapCombineCellTargetBinding[];
  /** Required whenever a Combine uses explicit per-cell target bindings. */
  localAdmission?: LocalCombineCampaignAdmissionRequest;
  strategy?: "zip" | "cartesian" | "pairwise";
  serial?: string;
  platform?: "android" | "ios";
  targetKind?: "device" | "browser";
  browserTargetId?: string;
  title?: string;
  seed?: number;
  projectId?: string;
  capture?: AppMapCapturePolicy;
  surfaceCapture?: { forceRecaptureScreenIds: string[] };
  executionMode?: "all" | "pilot";
  pilotCaseIndex?: number;
  cell?: string;
  defaultTargetProfileId?: string;
  sourceRevision?: SourceRevision;
};

export type CombineStartResult = {
  batch: {
    id: string;
    recipeId: string;
    composedRecipeId: string;
    title: string;
    worlds: string[];
    createdAt: number;
  };
  matrix: unknown;
  cells: unknown;
  jobs: ReturnType<typeof summarizeJob>[];
  selectedCellIds: string[];
  plan: AppMapCompiledTest;
  admission?: {
    preflight: LocalCombineCampaignAdmission["preflight"];
    targetPreflights: LocalCombineCampaignAdmission["targetPreflights"];
  };
  campaign?: CombineCampaign;
};

export type CombineStartRouteContext = {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
  runtime: JobRouteRuntime;
};

function ephemeralCombineFromTest(input: {
  mapId: string;
  organizationId: string;
  projectId: string;
  testId: string;
  variableIds: string[];
  selected?: Record<string, string[]>;
  strategy?: "zip" | "cartesian" | "pairwise";
  capture?: AppMapCapturePolicy;
  cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
}): AppMapCombine {
  const now = Date.now();
  return {
    id: "ad-hoc",
    organizationId: input.organizationId,
    projectId: input.projectId,
    appMapId: input.mapId,
    name: input.testId,
    variableIds: input.variableIds,
    testIds: [input.testId],
    ...(input.selected ? { selected: input.selected } : {}),
    ...(input.strategy ? { strategy: input.strategy } : {}),
    ...(input.capture ? { captures: { [input.testId]: input.capture } } : {}),
    ...(input.cellRuntimeProfiles ? { cellRuntimeProfiles: input.cellRuntimeProfiles } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Start one saved or ad-hoc Combine only after all cells, local capacity, and
 * leases are durable and compensable. It lives apart from generic job routes
 * because its campaign record is a transaction boundary, not a single job.
 */
export async function handleCombineStartRoute(context: CombineStartRouteContext): Promise<void> {
  const body = (await parseJsonBody(context.request)) as CombineStartRequest;
  json(context.response, 202, await executeCombineStart(context.scope, context.runtime, body));
}

export async function executeCombineStart(
  scope: RequestContext,
  runtime: JobRouteRuntime,
  body: CombineStartRequest,
): Promise<CombineStartResult> {
  if (!body.appMapId?.trim()) {
    throw new HttpError(400, "appMapId is required");
  }
  if (!body.testId?.trim() && !body.combineId?.trim()) {
    throw new HttpError(400, "combineId or testId is required");
  }
  if (!scope.localTrusted) {
    throw new HttpError(403, "Option matrix jobs require a project-owned store");
  }
  if (body.cellTargetBindings !== undefined && !Array.isArray(body.cellTargetBindings)) {
    throw new HttpError(400, "cellTargetBindings must be an array");
  }
  const hasExplicitCellTargets = body.cellTargetBindings !== undefined;
  const targetId = body.browserTargetId ?? body.serial;
  if (!targetId && !hasExplicitCellTargets) {
    throw new HttpError(400, "serial or browserTargetId is required");
  }
  const loaded = await readAppMap(scope.projectId, body.appMapId.trim());
  if (!loaded) throw new HttpError(404, `App Map ${body.appMapId} not found`);
  const combine = body.combineId?.trim() ? loaded.combines?.[body.combineId.trim()] : undefined;
  if (body.combineId?.trim() && !combine) {
    throw new HttpError(404, `Combination ${body.combineId} not found`);
  }
  const runTestOnce = Boolean(body.testId?.trim()) && !combine && !body.variableIds?.length;
  if (runTestOnce) {
    requireSingleTestUseAppMapTestRun(body.appMapId.trim(), body.testId!.trim());
  }
  const targetKind = body.targetKind ?? (body.browserTargetId ? "browser" : "device");
  const requestedPlatform = body.browserTargetId ? ("browser" as const) : body.platform;
  if (!hasExplicitCellTargets && targetKind === "device" && !requestedPlatform) {
    throw new HttpError(400, "platform is required so Relay can bind each cell before discovery.");
  }
  const scopedCombine = combine
    ? body.capture
      ? {
          ...combine,
          captures: Object.fromEntries(combine.testIds.map((id) => [id, body.capture!])),
        }
      : combine
    : ephemeralCombineFromTest({
        mapId: loaded.id,
        organizationId: loaded.organizationId,
        projectId: loaded.projectId,
        testId: body.testId!.trim(),
        variableIds: body.variableIds ?? [],
        selected: body.selected,
        strategy: body.strategy,
        capture: body.capture,
        cellRuntimeProfiles: body.cellRuntimeProfiles,
      });
  const forceRecaptureScreenIds = body.surfaceCapture?.forceRecaptureScreenIds ?? [];
  const map = applyFullSurfaceDestinationBindings(
    loaded,
    scopedCombine.testIds,
    forceRecaptureScreenIds,
  );
  let staged: ReturnType<typeof stagePreparedAppMapCombineCells> | undefined;
  let admission: LocalCombineCampaignAdmission | undefined;
  let persistedCampaignId: string | undefined;
  try {
    const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
    const prepared = assertPreparedCombineCells(
      await prepareAppMapCombineCells({
        map,
        combine: scopedCombine,
        selected: body.selected ?? scopedCombine.selected,
        strategy: body.strategy ?? scopedCombine.strategy,
        cellRuntimeProfiles: body.cellRuntimeProfiles ?? scopedCombine.cellRuntimeProfiles,
        cellTargetBindings: body.cellTargetBindings,
        selectedCellIds: body.selectedCellIds,
        defaultTargetProfileId: body.defaultTargetProfileId,
        ...(targetId
          ? {
              target: {
                targetId,
                platform: requestedPlatform ?? "browser",
              },
            }
          : {}),
        compileOptions: {
          reviewedDocumentOrigins,
          ...(forceRecaptureScreenIds.length
            ? { forceRecaptureSurfaceScreenIds: forceRecaptureScreenIds }
            : {}),
        },
      }),
    );
    let selectedCells = prepared.selectedCells;
    if (body.cell?.trim()) {
      try {
        const selected = new Set(resolveCombineCellSelector(prepared.cells, body.cell));
        selectedCells = prepared.cells.filter((cell) => selected.has(cell.cellId));
      } catch (error) {
        if (error instanceof AppMapCombineWorldError) {
          throw new HttpError(409, error.message, { code: error.code });
        }
        throw error;
      }
      if (!selectedCells.length) {
        throw new HttpError(409, `Unknown Combine cell ${body.cell.trim()}.`);
      }
    }
    const namedCells = Boolean(body.cell?.trim()) || Boolean(body.selectedCellIds?.length);
    const isPilotRun = body.executionMode !== "all" && !namedCells;
    const selectedToQueue = isPilotRun ? selectedCells.slice(0, 1) : selectedCells;
    if (!selectedToQueue.length) {
      throw new HttpError(400, "No selected Combine cells to queue");
    }
    if (hasExplicitCellTargets && !body.localAdmission) {
      throw new HttpError(
        409,
        "Per-cell Combine target bindings require a local deadline admission request.",
        {
          code: "LOCAL_COMBINE_ADMISSION_REQUIRED",
          recovery:
            "Provide localAdmission with a current observed p50 or p95 duration and deadline. Relay will not queue multi-target work on assumed capacity.",
        },
      );
    }
    const stageCells = (acceptedAdmission?: LocalCombineCampaignAdmission) =>
      stagePreparedAppMapCombineCells({
        cells: selectedToQueue,
        title: body.title ?? scopedCombine.name,
        ...(targetId
          ? {
              targetId,
              platform: requestedPlatform,
              targetKind,
              browserTargetId: body.browserTargetId,
            }
          : {}),
        targetForCell: (cell) => cell.executionTarget,
        operationContextForCell: acceptedAdmission?.operationContextForCell,
        queuedTargetProfile: (cell, executionTarget) =>
          queuedAppMapTestTargetProfile({
            runtimeTargetProfile: cell.selectedRuntimeTargetProfile,
            observedTargetProfile: undefined,
            target: {
              kind: executionTarget.kind === "local-browser" ? "browser" : "device",
              targetId: executionTarget.targetId,
              platform: executionTarget.platform,
            },
          }),
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
        sourceRevision: body.sourceRevision,
      });
    if (body.localAdmission) {
      const admissionRequest = isPilotRun
        ? localCampaignAdmissionRequestForActiveWorkItems({
            request: body.localAdmission,
            activeWorkItems: localCampaignAdmissionWorkItemsForCombine(selectedToQueue),
            knownWorkItems: localCampaignAdmissionWorkItemsForCombine(prepared.selectedCells),
          })
        : body.localAdmission;
      const admitted = await admitAndStageLocalCombineCampaign({
        scope,
        cells: selectedToQueue,
        request: admissionRequest,
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
        stage: stageCells,
      });
      admission = admitted.admission;
      staged = admitted.staged;
    } else {
      if (!targetId) throw new HttpError(400, "serial or browserTargetId is required");
      await runtime.assertTargetControl(scope, targetId);
      if (targetKind === "device") {
        try {
          await runtime.listDevices();
        } catch (error) {
          throw new HttpError(503, "Relay cannot verify the selected device", {
            code: "TARGET_DISCOVERY_UNAVAILABLE",
            targetId,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      staged = stageCells();
    }
    let campaign;
    if (combine) {
      const jobByCell = new Map(
        staged.jobs.map((job, index) => [selectedToQueue[index]?.cellId, job]),
      );
      const cases = prepared.cells.map((cell, index) => {
        const job = jobByCell.get(cell.cellId);
        const isPilot = isPilotRun && cell.cellId === selectedToQueue[0]?.cellId;
        return combineCampaignCaseFromPreparedCell(cell, {
          index,
          phase: isPilot ? "pilot" : "coverage",
          status: job ? "queued" : "pending",
          jobId: job?.id,
        });
      });
      const at = Date.now();
      campaign = {
        schemaVersion: 1 as const,
        id: staged.batchId,
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
        appMapId: map.id,
        combineId: combine.id,
        sourceRevision: map.revision,
        latestRevision: map.revision,
        ...(new Set(prepared.cells.map((cell) => executionTargetRefKey(cell.executionTarget)))
          .size === 1
          ? {
              target:
                prepared.cells[0]!.executionTarget.kind === "local-browser"
                  ? {
                      kind: "browser" as const,
                      id: prepared.cells[0]!.executionTarget.targetId,
                      platform: "browser" as const,
                    }
                  : {
                      kind: "device" as const,
                      id: prepared.cells[0]!.executionTarget.targetId,
                      platform: prepared.cells[0]!.executionTarget.platform,
                    },
            }
          : {}),
        status: isPilotRun ? ("pilot-running" as const) : ("running" as const),
        createdAt: at,
        updatedAt: at,
        cases,
        lineage: [
          {
            kind: "created" as const,
            at,
            appMapRevision: map.revision,
            actorId: currentOperationContext()!.actorId,
          },
        ],
        execution: {
          selected: body.selected ?? combine.selected,
          selectedCellIds: isPilotRun
            ? prepared.selectedCellIds
            : selectedToQueue.map((cell) => cell.cellId),
          strategy: body.strategy ?? combine.strategy,
          seed: prepared.matrix.seed,
          title: body.title?.trim() || combine.name,
          ...(admission
            ? {
                localAdmission: {
                  request: structuredClone(body.localAdmission!),
                  preflight: structuredClone(admission.preflight),
                  targetPreflights: structuredClone(admission.targetPreflights),
                  targets: structuredClone(admission.targets),
                },
              }
            : {}),
        },
      };
      await createCombineCampaign(campaign);
      persistedCampaignId = campaign.id;
    }
    const acceptedAdmission = admission;
    // A lease claim becomes durable only after every queued job is visible
    // and still held behind the scheduler stage. The following dispatch is
    // a no-throw transfer of that already validated batch.
    await acceptedAdmission?.commit();
    staged.activate();
    await acceptedAdmission?.finalize();
    admission = undefined;
    const queued = { batchId: staged.batchId, jobs: staged.dispatch() };
    staged = undefined;
    // From this point the campaign owns normal job cancellation/finalization
    // rather than this admission transaction's compensation path.
    persistedCampaignId = undefined;
    return {
      batch: {
        id: queued.batchId,
        recipeId: selectedToQueue[0]!.recipeSnapshot.id,
        composedRecipeId: selectedToQueue[0]!.recipeSnapshot.id,
        title: body.title ?? scopedCombine.name,
        worlds: prepared.cells.map((cell) => cell.worldLabel),
        createdAt: Date.now(),
      },
      matrix: prepared.matrix,
      cells: prepared.cellStates,
      jobs: queued.jobs.map((job) => summarizeJob(job)),
      selectedCellIds: selectedToQueue.map((cell) => cell.cellId),
      plan: selectedToQueue[0]!.plan,
      ...(acceptedAdmission
        ? {
            admission: {
              preflight: acceptedAdmission.preflight,
              targetPreflights: acceptedAdmission.targetPreflights,
            },
          }
        : {}),
      ...(campaign ? { campaign } : {}),
    };
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
    if (persistedCampaignId) {
      try {
        const at = Date.now();
        await updateCombineCampaign(scope.projectId, persistedCampaignId, (current) => ({
          ...current,
          status: "cancelled",
          updatedAt: at,
          cases: current.cases.map((item) =>
            item.jobId ? { ...item, status: "cancelled" as const } : item,
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
      } catch (cleanupError) {
        cleanupErrors.push(
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        );
      }
    }
    if (cleanupErrors.length) {
      throw new HttpError(
        500,
        `Combine admission failed and Relay could not fully compensate staged work: ${cleanupErrors.join("; ")}`,
      );
    }
    if (error instanceof HttpError) throw error;
    if (error instanceof AppMapCombineCellContractError)
      throw combineCellContractHttpError(error, {
        map,
        ...(targetId ? { target: { targetId, platform: requestedPlatform ?? "browser" } } : {}),
      });
    if (error instanceof AppMapCompileError) throw new HttpError(409, error.message);
    throw new HttpError(400, error instanceof Error ? error.message : String(error));
  }
}
