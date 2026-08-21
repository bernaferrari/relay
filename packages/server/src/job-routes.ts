import http from "node:http";
import type {
  AppMapCapturePolicy,
  AppMapCombine,
  AppMapCombineCellRuntimeProfile,
} from "@relay/protocol";
import {
  AppMapCompileError,
  activeReviewedDocumentOriginsForAppMap,
  appMapTestExecutionSourceFromJob,
  appMapTestExecutionSourceFromRun,
  captureSnapshot,
  cancelActiveJob,
  cancelJob,
  currentOperationContext,
  enqueueJob,
  exportLocaleRunPackFromBatchId,
  freezeRecipeExecution,
  getActiveJob,
  getActiveJobs,
  getJob,
  humanInterventionNeedsReproof,
  listJobs,
  inferLocaleOptionsFromTeach,
  recordedLocalePreludeFromMap,
  pauseJob,
  prepareRunMatrix,
  readAppMap,
  readProjectVariables,
  referencedRuntimeInputs,
  referencedVariableIds,
  redactRunMatrix,
  resumeJob,
  retryJob,
  replayPersistedRun,
  readPersistedRun,
  recordHumanInterventionReproof,
  createCombineCampaign,
  AppMapCombineCellContractError,
  combineCampaignCaseFromPreparedCell,
  enqueuePreparedAppMapCombineCells,
  listDevices,
  prepareAppMapCombineCells,
  resolveJobDevicePlatform,
  stabilizeOptionIds,
  summarizeJob,
  sensitiveInputNames,
  type LocaleRunScope,
  type TestJob,
} from "@relay/core";
import { assertJobAccess, assertTargetControl } from "./access-control.js";
import {
  assertPreparedCombineCells,
  combineCellContractHttpError,
  requireSingleTestUseAppMapTestRun,
} from "./app-map-combine-runtime-contract.js";
import { queuedAppMapTestTargetProfile } from "./app-map-run-routes.js";
import {
  appMapTestExecutionReviewHttpError,
  requireScopedAppMapTestExecution,
} from "./app-map-test-execution-guard.js";
import { enqueueCompatibilityBatch } from "./compatibility-jobs.js";
import { HttpError, json, matchPath, parseJsonBody, parseLimit } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";
import { handleCombineCampaignRoute } from "./combine-campaign-routes.js";
import { handleLocaleMatrixRoute } from "./locale-matrix-routes.js";

export type JobRouteRuntime = {
  getJob: typeof getJob;
  assertTargetControl: typeof assertTargetControl;
  listDevices: typeof listDevices;
  enqueueJob: typeof enqueueJob;
  captureSnapshot: typeof captureSnapshot;
  retryJob: typeof retryJob;
  replayPersistedRun: typeof replayPersistedRun;
  resumeJob: (id: string) => TestJob | Promise<TestJob>;
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

const defaultJobRouteRuntime: JobRouteRuntime = {
  getJob,
  assertTargetControl,
  listDevices,
  enqueueJob,
  captureSnapshot,
  retryJob,
  replayPersistedRun,
  resumeJob,
};

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
      // `active` remains a compatibility convenience; `activeJobs` is the
      // truthful capacity-aware view.
      active: activeJobs.length ? summarizeJob(activeJobs.at(-1)!) : null,
      activeJobs: activeJobs.map(summarizeJob),
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
    await runtime.assertTargetControl(scope, previous.browserTargetId ?? previous.serial);
    const job = runtime.retryJob(retryMatch.id!);
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
    await runtime.assertTargetControl(scope, run.serial);
    try {
      const job = runtime.replayPersistedRun(run);
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
    if (humanInterventionNeedsReproof(paused)) {
      const operation = currentOperationContext();
      if (!operation) throw new HttpError(400, "Actor-aware operation context is required");
      const targetId = paused.browserTargetId ?? paused.serial;
      if (!targetId || paused.targetContext.kind !== "device") {
        throw new HttpError(409, "The intervened target cannot be re-proven");
      }
      try {
        const snapshot = await runtime.captureSnapshot({ serial: targetId, includeVisual: true });
        recordHumanInterventionReproof(paused, operation, {
          capturedAt: snapshot.capturedAt,
          inspectable: snapshot.inspectable,
          source: snapshot.source,
          foregroundApp: snapshot.foregroundApp,
          bindingState: snapshot.bindingState,
          screenIdentity: snapshot.screenIdentity,
          visualFingerprint: snapshot.visualFingerprint,
          nodeCount: snapshot.nodes.length,
        });
      } catch (error) {
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
    if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
      recordAudit(scope, { action: "run.matrix", resource: "project", result: "deny" });
      throw new HttpError(403, "Project is outside the authenticated scope");
    }
    const definitions = await readProjectVariables(scope.projectId);
    const frozenRecipe = await freezeRecipeExecution(body.recipe);
    const matrix = await prepareRunMatrix({
      variables: definitions.value,
      dataIds: referencedVariableIds(frozenRecipe.recipeGraph, definitions.value),
      repetitions: body.repetitions,
      seed: body.seed,
    });
    const safeMatrix = redactRunMatrix(matrix, definitions.value);
    const jobs = matrix.cases.map((item) =>
      enqueueJob({
        recipe: frozenRecipe.recipeSnapshot.id,
        ...frozenRecipe,
        serial: body.serial,
        platform,
        targetKind: body.targetKind,
        browserTargetId: body.browserTargetId,
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

  if (method === "POST" && pathname === "/jobs/combine/infer") {
    const body = (await parseJsonBody(req)) as {
      nodes?: unknown;
      examples?: Array<{
        id?: string;
        locale?: string;
        identifier?: string;
        label?: string;
        text?: string;
      }>;
      kind?: string;
      name?: string;
      app?: string;
      appMapId?: string;
      inConnectionId?: string;
      outConnectionId?: string;
      listScreenId?: string;
      entryPath?: LocaleRunScope["entryPath"];
      pickerPath?: LocaleRunScope["languagePath"];
      languagePath?: LocaleRunScope["languagePath"];
    };
    if (!Array.isArray(body.nodes)) throw new HttpError(400, "nodes must be an accessibility tree");
    if (!Array.isArray(body.examples) || body.examples.length === 0) {
      throw new HttpError(400, "teach at least one option example");
    }
    const examples = body.examples
      .map((example) => ({
        locale:
          typeof example.id === "string"
            ? example.id
            : typeof example.locale === "string"
              ? example.locale
              : "",
        ...(typeof example.identifier === "string" ? { identifier: example.identifier } : {}),
        ...(typeof example.label === "string" ? { label: example.label } : {}),
        ...(typeof example.text === "string" ? { text: example.text } : {}),
      }))
      .filter((example) => example.locale.trim());
    if (!examples.length) throw new HttpError(400, "teach at least one option example");
    let entryPath = body.entryPath;
    let pickerPath = body.pickerPath ?? body.languagePath;
    if (!entryPath?.length && !pickerPath?.length && body.appMapId?.trim()) {
      const map = await readAppMap(scope.projectId, body.appMapId.trim());
      if (map) {
        const prelude = recordedLocalePreludeFromMap(map, {});
        if (prelude) {
          entryPath = prelude.entryPath;
          pickerPath = prelude.languagePath;
        }
      }
    }
    const inferred = inferLocaleOptionsFromTeach({
      nodes: body.nodes as never,
      examples,
    });
    const kind =
      body.kind === "location" ||
      body.kind === "account" ||
      body.kind === "theme" ||
      body.kind === "workspace" ||
      body.kind === "build" ||
      body.kind === "toggle" ||
      body.kind === "custom"
        ? body.kind
        : "language";
    const options = stabilizeOptionIds(
      inferred.options.map((option) => ({
        id: option.locale,
        ...(option.identifier ? { identifier: option.identifier } : {}),
        ...(option.label ? { label: option.label } : {}),
        ...(option.text ? { text: option.text } : {}),
      })),
    );
    const variable = {
      id: kind === "language" ? "languages" : kind === "location" ? "locations" : kind,
      name:
        body.name?.trim() ||
        (kind === "language" ? "Language" : kind[0]!.toUpperCase() + kind.slice(1)),
      kind,
      apply: {
        kind: kind === "toggle" ? ("toggle" as const) : ("list" as const),
        ...(body.inConnectionId?.trim() ? { inConnectionId: body.inConnectionId.trim() } : {}),
        ...(body.outConnectionId?.trim() ? { outConnectionId: body.outConnectionId.trim() } : {}),
        ...(body.listScreenId?.trim() ? { listScreenId: body.listScreenId.trim() } : {}),
        ...(entryPath?.length ? { entryPath } : {}),
        ...(pickerPath?.length ? { pickerPath } : {}),
      },
      options,
    };
    json(res, 200, { inferred, variable });
    return true;
  }

  if (method === "POST" && pathname === "/jobs/combine") {
    const body = (await parseJsonBody(req)) as {
      appMapId?: string;
      testId?: string;
      combineId?: string;
      variableIds?: string[];
      selected?: Record<string, string[]>;
      selectedCellIds?: string[];
      cellRuntimeProfiles?: AppMapCombineCellRuntimeProfile[];
      strategy?: "zip" | "cartesian" | "pairwise";
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      title?: string;
      seed?: number;
      projectId?: string;
      capture?: AppMapCapturePolicy;
      executionMode?: "all" | "pilot";
      pilotCaseIndex?: number;
    };
    if (!body.appMapId?.trim()) {
      throw new HttpError(400, "appMapId is required");
    }
    if (!body.testId?.trim() && !body.combineId?.trim()) {
      throw new HttpError(400, "combineId or testId is required");
    }
    if (!scope.localTrusted) {
      throw new HttpError(403, "Option matrix jobs require a project-owned store");
    }
    const targetId = body.browserTargetId ?? body.serial;
    if (!targetId) throw new HttpError(400, "serial or browserTargetId is required");
    const map = await readAppMap(scope.projectId, body.appMapId.trim());
    if (!map) throw new HttpError(404, `App Map ${body.appMapId} not found`);
    const combine = body.combineId?.trim() ? map.combines?.[body.combineId.trim()] : undefined;
    if (body.combineId?.trim() && !combine) {
      throw new HttpError(404, `Combination ${body.combineId} not found`);
    }
    const runTestOnce = Boolean(body.testId?.trim()) && !combine && !body.variableIds?.length;
    if (runTestOnce) {
      requireSingleTestUseAppMapTestRun(body.appMapId.trim(), body.testId!.trim());
    }
    const targetKind = body.targetKind ?? (body.browserTargetId ? "browser" : "device");
    const requestedPlatform = body.browserTargetId ? ("browser" as const) : body.platform;
    if (targetKind === "device" && !requestedPlatform) {
      throw new HttpError(
        400,
        "platform is required so Relay can bind each cell before discovery.",
      );
    }
    const scopedCombine = combine
      ? combine
      : ephemeralCombineFromTest({
          mapId: map.id,
          organizationId: map.organizationId,
          projectId: map.projectId,
          testId: body.testId!.trim(),
          variableIds: body.variableIds ?? [],
          selected: body.selected,
          strategy: body.strategy,
          capture: body.capture,
          cellRuntimeProfiles: body.cellRuntimeProfiles,
        });
    if (body.executionMode === "pilot" && !combine) {
      throw new HttpError(400, "Pilot mode requires a saved Combine");
    }
    try {
      const reviewedDocumentOrigins = await activeReviewedDocumentOriginsForAppMap(map);
      const prepared = assertPreparedCombineCells(
        await prepareAppMapCombineCells({
          map,
          combine: scopedCombine,
          selected: body.selected ?? scopedCombine.selected,
          strategy: body.strategy ?? scopedCombine.strategy,
          cellRuntimeProfiles: body.cellRuntimeProfiles ?? scopedCombine.cellRuntimeProfiles,
          selectedCellIds: body.selectedCellIds,
          target: {
            targetId,
            platform: requestedPlatform ?? "browser",
          },
          compileOptions: { reviewedDocumentOrigins },
        }),
      );
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
      const selectedToQueue =
        body.executionMode === "pilot"
          ? prepared.selectedCells.slice(0, 1)
          : prepared.selectedCells;
      if (!selectedToQueue.length) {
        throw new HttpError(400, "No selected Combine cells to queue");
      }
      const queued = enqueuePreparedAppMapCombineCells({
        cells: selectedToQueue,
        title: body.title ?? scopedCombine.name,
        targetId,
        platform: requestedPlatform,
        targetKind,
        browserTargetId: body.browserTargetId,
        queuedTargetProfile: (cell) =>
          queuedAppMapTestTargetProfile({
            runtimeTargetProfile: cell.selectedRuntimeTargetProfile,
            observedTargetProfile: undefined,
            target: {
              kind: targetKind,
              targetId,
              platform: requestedPlatform ?? "browser",
            },
          }),
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
      let campaign;
      if (body.executionMode === "pilot" && combine) {
        const jobByCell = new Map(
          queued.jobs.map((job, index) => [selectedToQueue[index]?.cellId, job]),
        );
        const cases = prepared.cells.map((cell, index) => {
          const job = jobByCell.get(cell.cellId);
          const isPilot = cell.cellId === selectedToQueue[0]?.cellId;
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
          id: queued.batchId,
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
          appMapId: map.id,
          combineId: combine.id,
          sourceRevision: map.revision,
          latestRevision: map.revision,
          target: body.browserTargetId
            ? { kind: "browser" as const, id: targetId, platform: "browser" as const }
            : { kind: "device" as const, id: targetId, platform: requestedPlatform! },
          status: "pilot-running" as const,
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
            selectedCellIds: prepared.selectedCellIds,
            strategy: body.strategy ?? combine.strategy,
            seed: prepared.matrix.seed,
            title: body.title?.trim() || combine.name,
          },
        };
        await createCombineCampaign(campaign);
      }
      json(res, 202, {
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
        ...(campaign ? { campaign } : {}),
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof AppMapCombineCellContractError)
        throw combineCellContractHttpError(error);
      if (error instanceof AppMapCompileError) throw new HttpError(409, error.message);
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (await handleCombineCampaignRoute(context)) return true;

  const optionExportMatch = matchPath(pathname, "/jobs/combine/:batchId/export");
  if (method === "GET" && optionExportMatch) {
    try {
      const exported = await exportLocaleRunPackFromBatchId(optionExportMatch.batchId!);
      json(res, 200, {
        rootDir: exported.rootDir,
        manifest: exported.manifest,
        jobIds: exported.jobs.map((job) => job.id),
      });
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (await handleLocaleMatrixRoute(context)) return true;
  if (method === "POST" && pathname === "/jobs/compatibility-matrix") {
    json(
      res,
      202,
      await enqueueCompatibilityBatch(scope, await parseJsonBody(req), {
        kind: "compatibility",
        maxRepetitions: 20,
        maxJobs: 200,
      }),
    );
    return true;
  }

  if (method === "POST" && pathname === "/jobs/soak") {
    json(
      res,
      202,
      await enqueueCompatibilityBatch(scope, await parseJsonBody(req), {
        kind: "soak",
        maxRepetitions: 100,
        maxJobs: 500,
      }),
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
      await runtime.assertTargetControl(scope, previous.browserTargetId ?? previous.serial);
      try {
        const job = runtime.retryJob(body.retryOf);
        json(res, 202, { job });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpError(400, message);
      }
    }
    await runtime.assertTargetControl(scope, body.browserTargetId ?? body.serial);
    const platform =
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(body.serial));
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
      job = enqueueJob({
        recipe: body.recipe!,
        ...frozenRecipe,
        serial: body.serial,
        platform,
        targetKind: body.targetKind,
        browserTargetId: body.browserTargetId,
        prodAccountMatch: body.prodAccountMatch,
        variables,
        sensitiveInputNames: definitions
          ? sensitiveInputNames(definitions.value, variables ?? {})
          : [],
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
    } catch (err) {
      // Invalid or missing compiled recipes are client errors, not server faults.
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(400, message);
    }
    json(res, 202, { job });
    return true;
  }

  return false;
}
