import http from "node:http";
import {
  cancelActiveJob,
  cancelJob,
  enqueueJob,
  getActiveJob,
  getJob,
  listJobs,
  pauseJob,
  prepareRunMatrix,
  readProjectVariables,
  resumeJob,
  retryJob,
  summarizeJob,
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
    json(res, 200, {
      jobs: (scope.localTrusted
        ? listJobs(limit)
        : listJobs(limit).filter(
            (job) => job.projectId === scope.projectId && job.ownerId === scope.subject,
          )
      ).map((job) => (full ? job : summarizeJob(job))),
      active:
        scope.localTrusted ||
        (getActiveJob()?.projectId === scope.projectId && getActiveJob()?.ownerId === scope.subject)
          ? getActiveJob()
          : null,
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
    assertJobAccess(scope, getActiveJob() ?? undefined);
    const job = cancelActiveJob();
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
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
    if (body.projectId?.trim() && body.projectId.trim() !== scope.projectId) {
      recordAudit(scope, { action: "run.matrix", resource: "project", result: "deny" });
      throw new HttpError(403, "Project is outside the authenticated scope");
    }
    const definitions = await readProjectVariables(scope.projectId);
    const matrix = await prepareRunMatrix({
      variables: definitions.value,
      repetitions: body.repetitions,
      seed: body.seed,
    });
    const jobs = matrix.cases.map((item) =>
      enqueueJob({
        recipe: body.recipe,
        serial: body.serial,
        platform: body.platform,
        targetKind: body.targetKind,
        browserTargetId: body.browserTargetId,
        prodAccountMatch: body.prodAccountMatch,
        variables: item.values,
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
              values: item.values,
              provenance: item.provenance,
            },
          },
        ],
        projectId: scope.projectId,
        ownerId: scope.subject,
      }),
    );
    json(res, 202, { matrix, jobs });
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
    await assertTargetControl(scope, body.browserTargetId ?? body.serial);
    let job;
    try {
      if (body.retryOf) {
        const previous = getJob(body.retryOf);
        assertJobAccess(scope, previous);
        await assertTargetControl(scope, previous?.browserTargetId ?? previous?.serial);
      }
      job = body.retryOf
        ? retryJob(body.retryOf)
        : enqueueJob({
            action: body.action,
            recipe: body.recipe,
            serial: body.serial,
            platform: body.platform,
            targetKind: body.targetKind,
            browserTargetId: body.browserTargetId,
            prodAccountMatch: body.prodAccountMatch,
            variables: body.variables,
            projectId: scope.projectId,
            ownerId: scope.subject,
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
