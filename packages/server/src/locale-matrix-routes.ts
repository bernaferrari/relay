import {
  AppMapCompileError,
  analyzeLocaleRunBatch,
  applyRecordedLocalePrelude,
  compileAppMapFlow,
  completeTaughtLocaleScope,
  currentOperationContext,
  defaultGrokLocaleScope,
  exportLocaleRunPackFromBatchId,
  inferLocaleOptionsFromTeach,
  localeRunScopeFromLanguageProfile,
  localeRunScopeFromTeach,
  readAppMap,
  recordedLocalePreludeFromMap,
  resolveJobDevicePlatform,
  startLocaleRecipeRun,
  summarizeJob,
  type LocaleRunScope,
  type Recipe,
} from "@relay/core";
import { assertTargetControl } from "./access-control.js";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { JobRouteContext } from "./job-routes.js";
import { recordAudit } from "./security.js";

/**
 * Routes for the locale-matrix workflow. Keeping them together makes
 * its teach, run, export, and analysis contract easier to evolve without
 * obscuring ordinary job lifecycle routes.
 */
export async function handleLocaleMatrixRoute(context: JobRouteContext): Promise<boolean> {
  const { method, pathname, request: req, response: res, scope } = context;

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

  const localeAnalysisMatch = matchPath(pathname, "/jobs/locale-matrix/:batchId/analysis");
  if (method === "GET" && localeAnalysisMatch) {
    try {
      json(res, 200, await analyzeLocaleRunBatch(localeAnalysisMatch.batchId!));
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  return false;
}
