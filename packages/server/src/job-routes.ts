import http from "node:http";
import type { AppMapCapturePolicy } from "@relay/protocol";
import {
  AppMapCompileError,
  cancelActiveJob,
  cancelJob,
  compileAppMapFlow,
  currentOperationContext,
  defaultGrokLocaleScope,
  enqueueJob,
  exportLocaleRunPackFromBatchId,
  freezeRecipeExecution,
  getActiveJob,
  getActiveJobs,
  getJob,
  listJobs,
  localeRunScopeFromLanguageProfile,
  localeRunScopeFromTeach,
  inferLocaleOptionsFromTeach,
  completeTaughtLocaleScope,
  recordedLocalePreludeFromMap,
  applyRecordedLocalePrelude,
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
  startLocaleRecipeRun,
  startOptionRecipeRun,
  compileAppMapTest,
  compileAppMapCombine,
  resolveJobDevicePlatform,
  stabilizeOptionIds,
  summarizeJob,
  sensitiveInputNames,
  type LocaleRunScope,
  type OptionRunSet,
  type Recipe,
} from "@relay/core";
import { assertJobAccess, assertTargetControl } from "./access-control.js";
import { enqueueCompatibilityBatch } from "./compatibility-jobs.js";
import { HttpError, json, matchPath, parseJsonBody, parseLimit } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

export type JobRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleJobRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, url, request: req, response: res, scope } = context;
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
    const previous = getJob(retryMatch.id!);
    assertJobAccess(scope, previous);
    await assertTargetControl(scope, previous?.browserTargetId ?? previous?.serial);
    const job = retryJob(retryMatch.id!);
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
    await assertTargetControl(scope, run.serial);
    try {
      const job = replayPersistedRun(run);
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
    assertJobAccess(scope, getJob(resumeMatch.id!));
    const job = resumeJob(resumeMatch.id!);
    json(res, 200, { job });
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
      flowId?: string;
      testId?: string;
      combineId?: string;
      variableIds?: string[];
      selected?: Record<string, string[]>;
      strategy?: "zip" | "cartesian" | "pairwise";
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      title?: string;
      seed?: number;
      projectId?: string;
      sets?: OptionRunSet[];
      capture?: AppMapCapturePolicy;
    };
    if (!body.appMapId?.trim()) {
      throw new HttpError(400, "appMapId is required");
    }
    if (!body.flowId?.trim() && !body.testId?.trim() && !body.combineId?.trim()) {
      throw new HttpError(400, "combineId, testId, or flowId is required");
    }
    if (!scope.localTrusted) {
      throw new HttpError(403, "Option matrix jobs require a project-owned store");
    }
    const targetId = body.browserTargetId ?? body.serial;
    if (!targetId) throw new HttpError(400, "serial or browserTargetId is required");
    await assertTargetControl(scope, targetId);
    const platform =
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(targetId));
    if (!body.browserTargetId && !platform) {
      throw new HttpError(
        400,
        `Cannot tell if ${targetId} is iOS or Android. Connect the device, or pass platform.`,
      );
    }
    const map = await readAppMap(scope.projectId, body.appMapId.trim());
    if (!map) throw new HttpError(404, `App Map ${body.appMapId} not found`);
    const combine = body.combineId?.trim() ? map.combines?.[body.combineId.trim()] : undefined;
    if (body.combineId?.trim() && !combine) {
      throw new HttpError(404, `Combination ${body.combineId} not found`);
    }
    const runTestOnce = Boolean(body.testId?.trim()) && !combine && !body.variableIds?.length;
    const ids = body.variableIds?.length
      ? body.variableIds
      : combine?.variableIds.length
        ? combine.variableIds
        : runTestOnce || body.sets?.length
          ? []
          : Object.keys(map.variables ?? {});
    if (!ids.length && !body.sets?.length && !body.testId?.trim()) {
      throw new HttpError(400, "variableIds, inline sets, or testId is required");
    }
    const sets: OptionRunSet[] = body.sets?.length
      ? body.sets
      : ids.map((id) => {
          const set = map.variables?.[id];
          if (!set) throw new HttpError(404, `Variable ${id} not found`);
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
    try {
      let compiledBody: Recipe | undefined;
      let compiledGraph: Record<string, Recipe> = {};
      if (combine) {
        const compiled = compileAppMapCombine(map, combine);
        compiledBody = compiled.root;
        compiledGraph = compiled.graph;
      } else if (body.testId?.trim()) {
        const work = map.tests?.[body.testId.trim()];
        if (!work) throw new HttpError(404, `Test ${body.testId} not found`);
        const compiled = compileAppMapTest(map, {
          ...work,
          ...(body.capture ? { capture: body.capture } : {}),
        });
        compiledBody = compiled.root;
        compiledGraph = compiled.graph;
      } else {
        const plan = compileAppMapFlow(map, body.flowId!.trim());
        compiledGraph = Object.fromEntries(
          Object.values(plan.recipes).map((compiled) => [
            compiled.id,
            {
              id: compiled.id,
              title: compiled.title,
              ...(compiled.description ? { description: compiled.description } : {}),
              source: "custom" as const,
              steps: compiled.steps,
              createdAt: map.createdAt,
              updatedAt: map.updatedAt,
            },
          ]),
        );
        compiledBody = compiledGraph[plan.rootRecipeId];
      }
      if (!sets.length) {
        if (!compiledBody) throw new HttpError(400, "compiled test is required");
        const job = enqueueJob({
          recipe: compiledBody.id,
          title: body.title?.trim() || compiledBody.title,
          serial: body.browserTargetId ? undefined : targetId,
          platform,
          targetKind: body.targetKind ?? (body.browserTargetId ? "browser" : "device"),
          browserTargetId: body.browserTargetId,
          recipeSnapshot: compiledBody,
          recipeGraph: compiledGraph,
          projectId: scope.projectId,
          ownerId: currentOperationContext()!.actorId,
        });
        json(res, 202, {
          job: summarizeJob(job),
          batch: {
            id: job.id,
            recipeId: compiledBody.id,
            composedRecipeId: compiledBody.id,
            title: job.title ?? compiledBody.title,
            worlds: ["once"],
            createdAt: job.queuedAt,
          },
          jobs: [summarizeJob(job)],
        });
        return true;
      }
      const batch = await startOptionRecipeRun({
        recipeId: compiledBody?.id ?? "combine",
        compiledBody,
        compiledGraph,
        map,
        targetId,
        platform,
        targetKind: body.targetKind ?? (body.browserTargetId ? "browser" : "device"),
        browserTargetId: body.browserTargetId,
        request: {
          sets,
          ...(combine ? { combineId: combine.id } : {}),
          selected: body.selected ?? combine?.selected,
          strategy: body.strategy ?? combine?.strategy,
          // Tests and saved matrices own their evidence policy. The generic
          // before/after wrapper remains only for legacy raw-flow runs.
          screenshotEach: !(combine || body.testId?.trim()),
        },
        title: body.title,
        seed: body.seed,
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
      json(res, 202, {
        batch: {
          id: batch.id,
          recipeId: batch.bodyRecipeId,
          composedRecipeId: batch.composedRecipeId,
          title: batch.title,
          worlds: batch.worlds,
          createdAt: batch.createdAt,
          ...(batch.expectedScreenshotsPerWorld !== undefined
            ? { expectedScreenshotsPerWorld: batch.expectedScreenshotsPerWorld }
            : {}),
          ...(batch.expectedScreenshots !== undefined
            ? { expectedScreenshots: batch.expectedScreenshots }
            : {}),
        },
        matrix: batch.matrix,
        jobs: batch.jobs.map((job) => summarizeJob(job)),
      });
    } catch (error) {
      if (error instanceof AppMapCompileError) throw new HttpError(409, error.message);
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

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

  if (method === "POST" && pathname === "/jobs/locale-matrix/infer") {
    const body = (await parseJsonBody(req)) as {
      nodes?: unknown;
      examples?: Array<{ locale?: string; identifier?: string; label?: string; text?: string }>;
      locales?: string[];
      app?: string;
      appMapId?: string;
      flowId?: string;
      bodyFlowId?: string;
      selectedConnectionId?: string;
      liveScreenId?: string;
      entryPath?: LocaleRunScope["entryPath"];
      languagePath?: LocaleRunScope["languagePath"];
      screenshotEachLocale?: boolean;
      restoreLocale?: string;
    };
    if (!Array.isArray(body.nodes)) throw new HttpError(400, "nodes must be an accessibility tree");
    if (!Array.isArray(body.examples) || body.examples.length === 0) {
      throw new HttpError(400, "teach at least one locale example");
    }
    const examples = body.examples
      .map((example) => ({
        locale: typeof example.locale === "string" ? example.locale : "",
        ...(typeof example.identifier === "string" ? { identifier: example.identifier } : {}),
        ...(typeof example.label === "string" ? { label: example.label } : {}),
        ...(typeof example.text === "string" ? { text: example.text } : {}),
      }))
      .filter((example) => example.locale.trim());
    if (!examples.length) throw new HttpError(400, "teach at least one locale example");
    let entryPath = body.entryPath;
    let languagePath = body.languagePath;
    if (!entryPath?.length && !languagePath?.length && body.appMapId?.trim()) {
      const map = await readAppMap(scope.projectId, body.appMapId.trim());
      if (map) {
        const prelude = recordedLocalePreludeFromMap(map, {
          bodyFlowId: body.bodyFlowId?.trim() || body.flowId?.trim(),
          selectedConnectionId: body.selectedConnectionId,
          liveScreenId: body.liveScreenId,
        });
        if (prelude) {
          entryPath = prelude.entryPath;
          languagePath = prelude.languagePath;
        }
      }
    }
    const inferred = inferLocaleOptionsFromTeach({
      nodes: body.nodes as never,
      examples,
    });
    const taughtScope = localeRunScopeFromTeach({
      nodes: body.nodes as never,
      examples,
      locales: body.locales,
      app: body.app,
      entryPath,
      languagePath,
      screenshotEachLocale: body.screenshotEachLocale,
      restoreLocale: body.restoreLocale,
    });
    json(res, 200, { inferred, scope: taughtScope });
    return true;
  }

  if (method === "POST" && pathname === "/jobs/locale-matrix") {
    const body = (await parseJsonBody(req)) as {
      recipe?: string;
      appMapId?: string;
      flowId?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      scope?: LocaleRunScope;
      locales?: string[];
      /** Switcher/language profile id (e.g. grok-ios). Preferred over preset. */
      profileId?: string;
      title?: string;
      seed?: number;
      projectId?: string;
      preset?: "grok";
    };
    if (!body.recipe && !(body.appMapId?.trim() && body.flowId?.trim())) {
      throw new HttpError(400, "recipe or appMapId+flowId is required");
    }
    if (!scope.localTrusted) {
      throw new HttpError(403, "Locale matrix jobs require a project-owned recipe store");
    }
    const targetId = body.browserTargetId ?? body.serial;
    if (!targetId) throw new HttpError(400, "serial or browserTargetId is required");
    await assertTargetControl(scope, targetId);
    const platform =
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(targetId));
    if (!body.browserTargetId && !platform) {
      throw new HttpError(
        400,
        `Cannot tell if ${targetId} is iOS or Android. Connect the device, or pass platform.`,
      );
    }
    if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
      recordAudit(scope, { action: "run.locale-matrix", resource: "project", result: "deny" });
      throw new HttpError(403, "Project is outside the authenticated scope");
    }

    let runScope = body.scope;
    if (!runScope) {
      const locales = body.locales?.length ? body.locales : ["en"];
      const profileId = body.profileId?.trim() || (body.preset === "grok" ? "grok-ios" : "");
      if (profileId) {
        try {
          const profileScope = await localeRunScopeFromLanguageProfile(profileId, locales);
          runScope = {
            locales: profileScope.locales,
            ...(profileScope.app ? { app: profileScope.app } : {}),
            ...(profileScope.relaunch !== undefined ? { relaunch: profileScope.relaunch } : {}),
            ...(profileScope.entryPath
              ? { entryPath: profileScope.entryPath as LocaleRunScope["entryPath"] }
              : {}),
            ...(profileScope.languagePath
              ? { languagePath: profileScope.languagePath as LocaleRunScope["languagePath"] }
              : {}),
            ...(profileScope.languageOptions
              ? { languageOptions: profileScope.languageOptions }
              : {}),
            ...(profileScope.restoreLocale ? { restoreLocale: profileScope.restoreLocale } : {}),
            ...(profileScope.restoreAtEnd !== undefined
              ? { restoreAtEnd: profileScope.restoreAtEnd }
              : {}),
            ...(profileScope.screenshotEachLocale !== undefined
              ? { screenshotEachLocale: profileScope.screenshotEachLocale }
              : {}),
          };
        } catch (error) {
          if (profileId === "grok-ios" || body.preset === "grok") {
            runScope = defaultGrokLocaleScope(locales);
          } else {
            throw new HttpError(400, error instanceof Error ? error.message : String(error));
          }
        }
      } else {
        runScope = { locales, screenshotEachLocale: true };
      }
    }
    if (!runScope) throw new HttpError(400, "locale scope is required");

    try {
      let recipeId = body.recipe?.trim() ?? "";
      let compiledBody: Recipe | undefined;
      let compiledGraph: Record<string, Recipe> | undefined;
      if (body.appMapId?.trim() && body.flowId?.trim()) {
        const map = await readAppMap(scope.projectId, body.appMapId.trim());
        if (!map) throw new HttpError(404, `App Map ${body.appMapId} not found`);
        const prelude = recordedLocalePreludeFromMap(map, { bodyFlowId: body.flowId.trim() });
        const explicitNav = Boolean(
          body.scope?.entryPath?.length || body.scope?.languagePath?.length,
        );
        runScope = applyRecordedLocalePrelude(runScope, prelude, explicitNav ? "fill" : "replace");
        let plan;
        try {
          plan = compileAppMapFlow(map, body.flowId.trim());
        } catch (error) {
          if (error instanceof AppMapCompileError) {
            throw new HttpError(409, error.message);
          }
          throw error;
        }
        compiledGraph = Object.fromEntries(
          Object.values(plan.recipes).map((compiled) => [
            compiled.id,
            {
              id: compiled.id,
              title: compiled.title,
              ...(compiled.description ? { description: compiled.description } : {}),
              source: "custom" as const,
              steps: compiled.steps,
              createdAt: map.createdAt,
              updatedAt: map.updatedAt,
            },
          ]),
        );
        compiledBody = compiledGraph[plan.rootRecipeId];
        recipeId = plan.rootRecipeId;
      }
      runScope = completeTaughtLocaleScope(runScope, {
        profileId: body.profileId,
        preset: body.preset,
      });
      const batch = await startLocaleRecipeRun({
        recipeId,
        ...(compiledBody ? { compiledBody, compiledGraph } : {}),
        targetId,
        platform,
        targetKind: body.targetKind ?? (body.browserTargetId ? "browser" : "device"),
        browserTargetId: body.browserTargetId,
        scope: runScope,
        title: body.title,
        seed: body.seed,
        projectId: scope.projectId,
        ownerId: currentOperationContext()!.actorId,
      });
      json(res, 202, {
        batch: {
          id: batch.id,
          recipeId: batch.bodyRecipeId,
          composedRecipeId: batch.composedRecipeId,
          title: batch.title,
          locales: batch.locales,
          createdAt: batch.createdAt,
        },
        matrix: batch.matrix,
        jobs: batch.jobs.map((job) => summarizeJob(job)),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  const localeExportMatch = matchPath(pathname, "/jobs/locale-matrix/:batchId/export");
  if (method === "GET" && localeExportMatch) {
    try {
      const exported = await exportLocaleRunPackFromBatchId(localeExportMatch.batchId!);
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
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
    const platform =
      body.platform ??
      (body.browserTargetId ? undefined : await resolveJobDevicePlatform(body.serial));
    let job;
    try {
      if (body.retryOf) {
        const previous = getJob(body.retryOf);
        assertJobAccess(scope, previous);
        await assertTargetControl(scope, previous?.browserTargetId ?? previous?.serial);
      }
      const frozenRecipe = body.recipe ? await freezeRecipeExecution(body.recipe) : undefined;
      const definitions = body.variables ? await readProjectVariables(scope.projectId) : undefined;
      const variables = frozenRecipe
        ? referencedRuntimeInputs(
            frozenRecipe.recipeGraph,
            definitions?.value ?? [],
            body.variables,
          )
        : body.variables;
      job = body.retryOf
        ? retryJob(body.retryOf)
        : enqueueJob({
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
