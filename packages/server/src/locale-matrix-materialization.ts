/**
 * Target-free locale-matrix planning shared by the read-only materialization
 * endpoint and the eventual start route. Keeping it outside route control
 * means a person can bind every actual case (including restore) before any
 * device, worker, or lease is consulted.
 */
import {
  AppMapCompileError,
  activeReviewedDocumentOriginsForAppMap,
  applyRecordedLocalePrelude,
  completeTaughtLocaleScope,
  compileAppMapFlow,
  compileAppMapTest,
  defaultGrokLocaleScope,
  getLanguageProfile,
  localeMatrixScopeFromAppMapLanguageVariable,
  localeRunScopeFromLanguageProfile,
  readAppMap,
  readRecipe,
  recordedLocalePreludeFromMap,
  type LocaleRunScope,
  type Recipe,
} from "@relay/core";
import {
  materializeLocaleMatrixCases,
  normalizeLocaleMatrixLocales,
  type LocaleMatrixMaterialization,
  type LocaleMatrixMaterializationInput,
  type LocaleMatrixMaterializedScope,
} from "@relay/protocol";
import { HttpError } from "./http.js";
import { recordAudit, type RequestContext } from "./security.js";

/** The server parses the navigation-bearing input as core's narrow type, then
 * emits the transport-safe counterpart from the protocol. */
export type LocaleMatrixRouteInput = Omit<LocaleMatrixMaterializationInput, "scope"> & {
  scope?: LocaleRunScope;
  title?: string;
  seed?: number;
};

export type MaterializedLocaleMatrixExecution = {
  materialization: LocaleMatrixMaterialization;
  recipeId: string;
  compiledBody?: Recipe;
  compiledGraph?: Record<string, Recipe>;
  runScope: LocaleRunScope;
  durationCohort: LocaleMatrixMaterialization["durationCohort"];
  targetPlatform?: LocaleMatrixMaterialization["targetPlatform"];
};

function sourceKind(body: LocaleMatrixRouteInput): "recipe" | "app-map-flow" | "app-map-test" {
  const candidates = [
    body.recipe?.trim() ? "recipe" : undefined,
    body.appMapId?.trim() && body.flowId?.trim() ? "app-map-flow" : undefined,
    body.appMapId?.trim() && body.testId?.trim() && body.variableId?.trim()
      ? "app-map-test"
      : undefined,
  ].filter((item): item is "recipe" | "app-map-flow" | "app-map-test" => Boolean(item));
  if (candidates.length !== 1) {
    throw new HttpError(
      400,
      "Locale matrix needs exactly one recipe, App Map flow, or App Map Test plus language Variable",
    );
  }
  return candidates[0]!;
}

function assertProjectScope(scope: RequestContext, body: LocaleMatrixRouteInput): void {
  if (!scope.localTrusted) {
    throw new HttpError(403, "Locale matrix jobs require a project-owned recipe store");
  }
  if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
    recordAudit(scope, { action: "run.locale-matrix", resource: "project", result: "deny" });
    throw new HttpError(403, "Project is outside the authenticated scope");
  }
}

function assertExpectedAppMapRevision(body: LocaleMatrixRouteInput, revision: number): void {
  if (body.expectedAppMapRevision === undefined || body.expectedAppMapRevision === revision) return;
  throw new HttpError(
    409,
    `Expected App Map revision ${body.expectedAppMapRevision}, current revision is ${revision}`,
    {
      code: "revision-conflict",
      currentRevision: revision,
      recovery: "Refresh the Locale Matrix plan from the saved App Map before starting.",
    },
  );
}

async function resolveLocaleScope(body: LocaleMatrixRouteInput): Promise<LocaleRunScope> {
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
  return runScope;
}

/** A profile is part of the execution contract even when the caller supplies
 * a previously materialized scope. Otherwise a `grok-ios` plan could be
 * previewed on iOS and then replayed against Android by dropping profileId. */
async function targetPlatformForProfile(
  body: LocaleMatrixRouteInput,
): Promise<"ios" | "android" | undefined> {
  const profileId = body.profileId?.trim() || (body.preset === "grok" ? "grok-ios" : undefined);
  if (!profileId) return undefined;
  const profile = await getLanguageProfile(profileId);
  if (!profile) throw new HttpError(400, `unknown language profile: ${profileId}`);
  return profile.platform === "ios" || profile.platform === "android"
    ? profile.platform
    : undefined;
}

/**
 * Resolve exactly what a later start will execute without reading or mutating a
 * physical target. Callers must submit the returned scope alongside every
 * explicit case target binding, so a server-side restore never creates a
 * hidden, unadmitted job.
 */
export async function materializeLocaleMatrixExecution(input: {
  scope: RequestContext;
  body: LocaleMatrixRouteInput;
}): Promise<MaterializedLocaleMatrixExecution> {
  const requestedSourceKind = sourceKind(input.body);
  assertProjectScope(input.scope, input.body);

  let runScope = await resolveLocaleScope(input.body);
  const profileTargetPlatform = await targetPlatformForProfile(input.body);
  let targetPlatform = profileTargetPlatform;
  let recipeId = input.body.recipe?.trim() ?? "";
  let compiledBody: Recipe | undefined;
  let compiledGraph: Record<string, Recipe> | undefined;
  let source: LocaleMatrixMaterialization["source"];

  if (requestedSourceKind === "app-map-flow") {
    const appMapId = input.body.appMapId!.trim();
    const flowId = input.body.flowId!.trim();
    const map = await readAppMap(input.scope.projectId, appMapId);
    if (!map) throw new HttpError(404, `App Map ${appMapId} not found`);
    assertExpectedAppMapRevision(input.body, map.revision);
    const prelude = recordedLocalePreludeFromMap(map, { bodyFlowId: flowId });
    const explicitNav = Boolean(
      input.body.scope?.entryPath?.length || input.body.scope?.languagePath?.length,
    );
    runScope = applyRecordedLocalePrelude(runScope, prelude, explicitNav ? "fill" : "replace");
    let plan;
    try {
      plan = compileAppMapFlow(map, flowId);
    } catch (error) {
      if (error instanceof AppMapCompileError) throw new HttpError(409, error.message);
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
    if (!compiledBody) throw new HttpError(409, `Flow ${flowId} did not compile a root recipe`);
    recipeId = plan.rootRecipeId;
    source = { kind: "app-map-flow", appMapId, flowId, appMapRevision: map.revision, recipeId };
  } else if (requestedSourceKind === "app-map-test") {
    const appMapId = input.body.appMapId!.trim();
    const testId = input.body.testId!.trim();
    const variableId = input.body.variableId!.trim();
    const map = await readAppMap(input.scope.projectId, appMapId);
    if (!map) throw new HttpError(404, `App Map ${appMapId} not found`);
    assertExpectedAppMapRevision(input.body, map.revision);
    const test = map.tests[testId];
    if (!test) throw new HttpError(404, `Test ${testId} not found`);
    let compiled;
    try {
      compiled = compileAppMapTest(map, test, {
        reviewedDocumentOrigins: await activeReviewedDocumentOriginsForAppMap(map),
      });
    } catch (error) {
      if (error instanceof AppMapCompileError) throw new HttpError(409, error.message);
      throw error;
    }
    let variableScope;
    try {
      variableScope = localeMatrixScopeFromAppMapLanguageVariable({
        map,
        variableId,
        ...(input.body.locales?.length ? { locales: input.body.locales } : {}),
        ...(input.body.profileId?.trim() ? { profileId: input.body.profileId.trim() } : {}),
        ...(input.body.preset ? { preset: input.body.preset } : {}),
      });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    if (
      variableScope.targetPlatform !== undefined &&
      profileTargetPlatform !== undefined &&
      variableScope.targetPlatform !== profileTargetPlatform
    ) {
      throw new HttpError(
        409,
        `Language Variable ${variableId} requires ${variableScope.targetPlatform}, but the selected profile requires ${profileTargetPlatform}.`,
        {
          code: "LOCALE_PROFILE_TARGET_PLATFORM_MISMATCH",
          requiredPlatform: variableScope.targetPlatform,
          recovery:
            "Choose an Android-compatible profile or select a recorded list language Variable for this Test.",
        },
      );
    }
    targetPlatform = variableScope.targetPlatform ?? profileTargetPlatform;
    runScope = variableScope.scope;
    compiledBody = compiled.root;
    compiledGraph = structuredClone(compiled.graph);
    recipeId = compiled.root.id;
    source = {
      kind: "app-map-test",
      appMapId,
      testId,
      variableId,
      appMapRevision: map.revision,
      recipeId,
    };
  } else {
    const recipe = await readRecipe(recipeId);
    if (!recipe) throw new HttpError(404, `recipe not found: ${recipeId}`);
    source = { kind: "recipe", recipeId: recipe.id };
  }

  runScope = completeTaughtLocaleScope(runScope, {
    profileId: input.body.profileId,
    preset: input.body.preset,
  });
  if (
    !runScope.appLocale?.trim() &&
    !runScope.entryPath?.length &&
    !runScope.languagePath?.length
  ) {
    throw new HttpError(409, "Record how you open this list");
  }
  runScope = { ...runScope, locales: normalizeLocaleMatrixLocales(runScope.locales) };
  if (requestedSourceKind === "app-map-test" && input.body.scope) {
    const submitted = completeTaughtLocaleScope(structuredClone(input.body.scope), {
      profileId: input.body.profileId,
      preset: input.body.preset,
    });
    const normalizedSubmitted = {
      ...submitted,
      locales: normalizeLocaleMatrixLocales(submitted.locales),
    };
    if (JSON.stringify(normalizedSubmitted) !== JSON.stringify(runScope)) {
      throw new HttpError(
        409,
        "Locale Matrix scope no longer matches the saved App Map language Variable.",
        {
          code: "LOCALE_APP_MAP_SCOPE_MISMATCH",
          recovery:
            "Refresh the Locale Matrix plan; Relay will use the current saved Variable and Test.",
        },
      );
    }
  }
  const durationCohort =
    source.kind === "app-map-flow"
      ? {
          testId: `app-map:${source.appMapId}:flow:${source.flowId}`,
          action: `app-map:${source.appMapId}:flow:${source.flowId}`,
        }
      : source.kind === "app-map-test"
        ? {
            testId: `app-map:${source.appMapId}:test:${source.testId}:variable:${source.variableId}`,
            action: `app-map:${source.appMapId}:test:${source.testId}`,
          }
        : { testId: recipeId, action: recipeId };
  const cases = materializeLocaleMatrixCases({
    locales: runScope.locales,
    restoreLocale: runScope.restoreLocale,
    restoreAtEnd: runScope.restoreAtEnd,
  });
  const materialization: LocaleMatrixMaterialization = {
    schemaVersion: 1,
    materializedAt: Date.now(),
    source,
    scope: structuredClone(runScope) as LocaleMatrixMaterializedScope,
    cases,
    durationCohort,
    ...(targetPlatform ? { targetPlatform } : {}),
  };
  return {
    materialization,
    recipeId,
    compiledBody,
    compiledGraph,
    runScope,
    durationCohort,
    ...(targetPlatform ? { targetPlatform } : {}),
  };
}
