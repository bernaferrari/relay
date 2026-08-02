import http from "node:http";
import {
  cancelActiveJob,
  cancelJob,
  currentOperationContext,
  enqueueJob,
  compileJourneyGraph,
  freezeRecipeExecution,
  freezeRecipeGraph,
  getActiveJob,
  getActiveJobs,
  getJob,
  listJobs,
  pauseJob,
  prepareRunMatrix,
  readProjectVariables,
  readJourney,
  readRecipe,
  referencedRuntimeInputs,
  referencedVariableIds,
  redactRunMatrix,
  resumeJob,
  retryJob,
  summarizeJob,
  sensitiveInputNames,
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
    const full = url.searchParams.get("full") !== "0";
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
      ).map((job) => (full ? job : summarizeJob(job))),
      // `active` remains a compatibility convenience; `activeJobs` is the
      // truthful capacity-aware view.
      active: activeJobs.at(-1) ?? null,
      activeJobs,
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

  if (method === "POST" && pathname === "/jobs/graph-path") {
    const body = (await parseJsonBody(req)) as {
      recipe?: string;
      flowName?: string;
      transitionPath?: string[];
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
    };
    if (!body.recipe?.trim()) throw new HttpError(400, "recipe is required");
    if (!body.flowName?.trim()) throw new HttpError(400, "flowName is required");
    if (body.transitionPath && !body.transitionPath.every((id) => typeof id === "string")) {
      throw new HttpError(400, "transitionPath must contain transition ids");
    }
    if (!scope.localTrusted) {
      throw new HttpError(403, "Graph jobs require a project-owned journey store");
    }
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
    const recipe = await readRecipe(body.recipe);
    if (!recipe) throw new HttpError(404, "Journey recipe not found");
    const journey = await readJourney(scope.projectId, recipe.id);
    if (!journey.value.graph) throw new HttpError(409, "Journey has no canonical graph");
    let compiled;
    try {
      compiled = compileJourneyGraph({
        graph: journey.value.graph,
        flowName: body.flowName,
        recipeSteps: recipe.steps,
        ...(body.transitionPath ? { transitionPath: body.transitionPath } : {}),
      });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    }
    const recipeSnapshot = { ...structuredClone(recipe), steps: structuredClone(compiled.steps) };
    const recipeGraph = await freezeRecipeGraph(recipeSnapshot);
    const job = enqueueJob({
      recipe: recipe.id,
      title: `${recipe.title} · ${compiled.flow.name}`,
      recipeSnapshot,
      recipeGraph,
      serial: body.serial,
      platform: body.platform,
      targetKind: body.targetKind,
      browserTargetId: body.browserTargetId,
      artifacts: [
        {
          kind: "journey-graph-plan",
          capturedAt: Date.now(),
          data: compiled,
        },
      ],
      projectId: scope.projectId,
      ownerId: currentOperationContext()!.actorId,
    });
    json(res, 202, { job, compiled });
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
    if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
      recordAudit(scope, { action: "run.matrix", resource: "project", result: "deny" });
      throw new HttpError(403, "Project is outside the authenticated scope");
    }
    const definitions = await readProjectVariables(scope.projectId);
    const frozenRecipe = await freezeRecipeExecution(body.recipe);
    const matrix = await prepareRunMatrix({
      variables: definitions.value,
      variableIds: referencedVariableIds(frozenRecipe.recipeGraph, definitions.value),
      repetitions: body.repetitions,
      seed: body.seed,
    });
    const safeMatrix = redactRunMatrix(matrix, definitions.value);
    const jobs = matrix.cases.map((item) =>
      enqueueJob({
        recipe: body.recipe,
        ...frozenRecipe,
        serial: body.serial,
        platform: body.platform,
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
      action?: string;
      recipe?: string;
      serial?: string;
      platform?: "android" | "ios";
      targetKind?: "device" | "browser";
      browserTargetId?: string;
      prodAccountMatch?: string;
      retryOf?: string;
      variables?: Record<string, string>;
    };
    if (!body.action && !body.recipe && !body.retryOf) {
      throw new HttpError(400, "action or recipe is required");
    }
    if (body.recipe && !scope.localTrusted) {
      throw new HttpError(403, "Recipe jobs require a project-owned recipe store");
    }
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
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
            action: body.action,
            recipe: body.recipe,
            ...frozenRecipe,
            serial: body.serial,
            platform: body.platform,
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
      // enqueueJob throws "Unknown action: <id>" for bad action ids — surface as 400, not 500.
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(400, message);
    }
    json(res, 202, { job });
    return true;
  }

  return false;
}
