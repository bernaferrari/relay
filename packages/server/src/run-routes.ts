import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  applyRunRetention,
  buildCompatibilityReport,
  buildSoakReport,
  compareEvidenceMetrics,
  buildRunEvidence,
  extractEvidenceMetrics,
  listJobs,
  listPersistedRuns,
  listRunSummaries,
  readFrameFile,
  readVisualBaselineFrame,
  readPersistedRun,
  rebuildRunCatalog,
  runArtifactFile,
  runsRoot,
  runStorageHealth,
  setRunPinned,
  compareVisualBaseline,
  getVisualBaseline,
  getVisualComparisonPolicy,
  reviewVisualComparison,
  reviewPersistedRun,
  RunReviewError,
  updateVisualComparisonPolicy,
  VISUAL_REVIEW_ACTIONS,
  VisualVerificationError,
  visualTargetKey,
} from "@relay/core";
import { recordAudit, resolveCommandActor, type RequestContext } from "./security.js";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody, parseLimit } from "./http.js";

export type RunRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function assertRunAccess(
  scope: RequestContext,
  run: Awaited<ReturnType<typeof readPersistedRun>>,
): asserts run is NonNullable<Awaited<ReturnType<typeof readPersistedRun>>> {
  if (!run) throw new HttpError(404, "Run not found");
  if (scope.localTrusted) return;
  if (run.projectId !== scope.projectId || run.ownerId !== scope.subject) {
    recordAudit(scope, { action: "run.access", resource: run.id, result: "deny" });
    throw new HttpError(404, "Run not found");
  }
}

function runVisibleToScope(
  scope: RequestContext,
  run: { projectId?: string; ownerId?: string },
): boolean {
  return scope.localTrusted || (run.projectId === scope.projectId && run.ownerId === scope.subject);
}

function assertLocalMaintenance(scope: RequestContext): void {
  if (!scope.localTrusted) {
    throw new HttpError(403, "Run storage maintenance is available only on the local Relay host");
  }
}

function visualVerificationHttpError(error: VisualVerificationError): HttpError {
  const status = error.code === "VISUAL_COMPARISON_NOT_FOUND" ? 404 : 409;
  return new HttpError(status, error.message, {
    code: error.code,
    recovery: error.recovery,
  });
}

function reviewActor(context: RunRouteContext): {
  id: string;
  kind: "human" | "agent" | "system";
} {
  const actor = resolveCommandActor(context.request.headers, context.scope);
  return { id: actor.actorId, kind: actor.actorKind };
}

export async function handleRunRoute(context: RunRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = context;
  const matrixReportMatch = matchPath(pathname, "/reports/matrix/:batchId");
  if (method === "GET" && matrixReportMatch) {
    const persisted = await listPersistedRuns(500);
    const live = listJobs(500);
    const byId = new Map(
      [...persisted, ...live]
        .filter((run) => runVisibleToScope(scope, run))
        .map((run) => [run.id, run]),
    );
    const report = buildCompatibilityReport([...byId.values()], matrixReportMatch.batchId!);
    if (!report) throw new HttpError(404, "Compatibility matrix report not found");
    json(response, 200, { report });
    return true;
  }

  const soakReportMatch = matchPath(pathname, "/reports/soak/:batchId");
  if (method === "GET" && soakReportMatch) {
    const persisted = await listPersistedRuns(1_000);
    const live = listJobs(1_000);
    const byId = new Map(
      [...persisted, ...live]
        .filter((run) => runVisibleToScope(scope, run))
        .map((run) => [run.id, run]),
    );
    const report = buildSoakReport([...byId.values()], soakReportMatch.batchId!);
    if (!report) throw new HttpError(404, "Soak report not found");
    json(response, 200, { report });
    return true;
  }

  if (method === "GET" && pathname === "/runs") {
    const limit = parseLimit(url.searchParams.get("limit"), 40);
    const appMapId = url.searchParams.get("appMapId")?.trim() || undefined;
    const actionPrefix = appMapId ? `app-map:${appMapId}:` : undefined;
    const runs = scope.localTrusted
      ? await listRunSummaries(limit, appMapId)
      : (await listPersistedRuns(limit, actionPrefix))
          .filter((run) => run.projectId === scope.projectId && run.ownerId === scope.subject)
          .slice(0, limit)
          .map((run) => ({
            id: run.id,
            action: run.action,
            title: run.title,
            status: run.status,
            queuedAt: run.queuedAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            durationMs: run.durationMs,
            platform: run.platform,
            serial: run.serial,
            outcome: run.outcome,
            review: run.review,
            batchId: run.batchId,
            frameCount: run.frameCount ?? run.frames.length,
            evidenceComplete: Boolean(run.evidence?.finishedAt),
            writtenAt: run.writtenAt,
            artifactCount: run.artifacts.length,
            artifactBytes: run.frames.reduce((sum, frame) => sum + (frame.bytes ?? 0), 0),
            pinned: false,
            retentionClass: "standard" as const,
          }));
    json(response, 200, scope.localTrusted ? { runs, root: runsRoot() } : { runs });
    return true;
  }

  if (method === "POST" && pathname === "/runs/catalog/rebuild") {
    assertLocalMaintenance(scope);
    json(response, 200, await rebuildRunCatalog(runsRoot()));
    return true;
  }

  if (method === "GET" && pathname === "/runs/storage") {
    assertLocalMaintenance(scope);
    json(response, 200, { policy: "disabled", health: await runStorageHealth(runsRoot()) });
    return true;
  }

  if (method === "POST" && pathname === "/runs/retention") {
    assertLocalMaintenance(scope);
    const body = (await parseJsonBody(request)) as {
      maxAgeDays?: number;
      maxBytes?: number;
      dryRun?: boolean;
    };
    json(response, 200, await applyRunRetention(runsRoot(), body));
    return true;
  }

  const signalsMatch = matchPath(pathname, "/runs/:id/signals");
  const evidenceMatch = matchPath(pathname, "/runs/:id/evidence");
  if (method === "GET" && evidenceMatch) {
    const run = await readPersistedRun(evidenceMatch.id!);
    assertRunAccess(scope, run);
    const rawLimit = Number(url.searchParams.get("limit") ?? 500);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(2_000, Math.floor(rawLimit)))
      : 500;
    const includeBodies = url.searchParams.get("includeBodies") === "true";
    json(response, 200, {
      evidence: buildRunEvidence(run, { limit, includeBodies }),
    });
    return true;
  }

  if (method === "GET" && signalsMatch) {
    const run = await readPersistedRun(signalsMatch.id!);
    assertRunAccess(scope, run);
    if (!run.evidence) {
      json(response, 200, { metrics: [], signals: [], reason: "evidence manifest unavailable" });
      return true;
    }
    const metrics = extractEvidenceMetrics(run.evidence, {
      targetProfileId: run.targetProfile?.id,
      appVersion: run.appVersion,
    });
    const history = (await listPersistedRuns(100))
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          candidate.action === run.action &&
          runVisibleToScope(scope, candidate),
      )
      .flatMap((candidate) =>
        candidate.evidence
          ? [
              extractEvidenceMetrics(candidate.evidence, {
                targetProfileId: candidate.targetProfile?.id,
                appVersion: candidate.appVersion,
              }),
            ]
          : [],
      );
    json(response, 200, { metrics, signals: compareEvidenceMetrics(metrics, history) });
    return true;
  }

  const visualPolicyMatch = matchPath(pathname, "/runs/:id/visual-policy");
  if (visualPolicyMatch) {
    const run = await readPersistedRun(visualPolicyMatch.id!);
    assertRunAccess(scope, run);
    if (method === "GET") {
      json(response, 200, { policy: await getVisualComparisonPolicy(runsRoot(), run) });
      return true;
    }
    if (method === "PUT") {
      const body = (await parseJsonBody(request)) as {
        expectedRevision?: unknown;
        changeThreshold?: unknown;
        pixelThreshold?: unknown;
        regions?: unknown;
      };
      try {
        const policy = await updateVisualComparisonPolicy(runsRoot(), run, {
          expectedRevision: body.expectedRevision as number,
          changeThreshold: body.changeThreshold as number,
          pixelThreshold: body.pixelThreshold as number,
          regions: body.regions as import("@relay/protocol").VisualRegion[],
          actor: reviewActor(context),
        });
        const comparison = await compareVisualBaseline(runsRoot(), run);
        json(response, 200, { policy, comparison });
      } catch (error) {
        if (error instanceof VisualVerificationError) {
          throw visualVerificationHttpError(error);
        }
        throw error;
      }
      return true;
    }
  }

  const visualBaselineFrameMatch = matchPath(pathname, "/runs/:id/visual-baseline-frame/:index");
  if (method === "GET" && visualBaselineFrameMatch) {
    const run = await readPersistedRun(visualBaselineFrameMatch.id!);
    assertRunAccess(scope, run);
    const baseline = await getVisualBaseline(
      runsRoot(),
      run.action,
      visualTargetKey(run),
      run.projectId ?? "local",
    );
    const frameIndex = Number(visualBaselineFrameMatch.index);
    const buffer = baseline
      ? await readVisualBaselineFrame(runsRoot(), baseline.id, frameIndex)
      : null;
    if (!buffer) throw new HttpError(404, "Approved baseline frame not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.byteLength,
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
    });
    response.end(buffer);
    return true;
  }

  const visualMatch = matchPath(pathname, "/runs/:id/visual-baseline");
  if (visualMatch) {
    const run = await readPersistedRun(visualMatch.id!);
    assertRunAccess(scope, run);
    if (method === "POST") {
      const body = (await parseJsonBody(request)) as { action?: unknown; note?: unknown };
      if (body.action !== "approve-new-baseline") {
        throw new HttpError(
          400,
          "Visual baseline approval must be an explicit approve-new-baseline review action",
          {
            code: "VISUAL_REVIEW_ACTION_REQUIRED",
            recovery:
              "Send action=approve-new-baseline, or use the visual-review operation for another decision.",
          },
        );
      }
      try {
        const comparison = await compareVisualBaseline(runsRoot(), run);
        const reviewed = await reviewVisualComparison(runsRoot(), run, {
          comparisonId: comparison.id,
          action: "approve-new-baseline",
          actor: reviewActor(context),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        });
        json(response, 200, { comparison, ...reviewed });
      } catch (error) {
        if (error instanceof VisualVerificationError) {
          throw visualVerificationHttpError(error);
        }
        throw error;
      }
      return true;
    }
  }

  const visualComparisonMatch = matchPath(pathname, "/runs/:id/visual-comparison");
  if (method === "POST" && visualComparisonMatch) {
    const run = await readPersistedRun(visualComparisonMatch.id!);
    assertRunAccess(scope, run);
    await parseJsonBody(request);
    try {
      json(response, 200, { comparison: await compareVisualBaseline(runsRoot(), run) });
    } catch (error) {
      if (error instanceof VisualVerificationError) {
        throw visualVerificationHttpError(error);
      }
      throw error;
    }
    return true;
  }

  const visualReviewMatch = matchPath(pathname, "/runs/:id/visual-review");
  if (method === "POST" && visualReviewMatch) {
    const run = await readPersistedRun(visualReviewMatch.id!);
    assertRunAccess(scope, run);
    const body = (await parseJsonBody(request)) as {
      comparisonId?: unknown;
      action?: unknown;
      note?: unknown;
    };
    if (typeof body.comparisonId !== "string" || !body.comparisonId.trim()) {
      throw new HttpError(400, "comparisonId is required", {
        code: "VISUAL_COMPARISON_ID_REQUIRED",
        recovery: "Run visual comparison first and pass its comparison ID.",
      });
    }
    if (!VISUAL_REVIEW_ACTIONS.includes(body.action as (typeof VISUAL_REVIEW_ACTIONS)[number])) {
      throw new HttpError(400, "Unknown visual review action", {
        code: "VISUAL_REVIEW_ACTION_INVALID",
        recovery: `Choose one of: ${VISUAL_REVIEW_ACTIONS.join(", ")}.`,
      });
    }
    try {
      json(
        response,
        200,
        await reviewVisualComparison(runsRoot(), run, {
          comparisonId: body.comparisonId,
          action: body.action as (typeof VISUAL_REVIEW_ACTIONS)[number],
          actor: reviewActor(context),
          ...(typeof body.note === "string" ? { note: body.note } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof VisualVerificationError) {
        throw visualVerificationHttpError(error);
      }
      throw error;
    }
    return true;
  }

  const runReviewMatch = matchPath(pathname, "/runs/:id/review");
  if (method === "POST" && runReviewMatch) {
    const run = await readPersistedRun(runReviewMatch.id!);
    assertRunAccess(scope, run);
    const body = (await parseJsonBody(request)) as {
      action?: unknown;
      note?: unknown;
    };
    if (body.action !== "approve" && body.action !== "reject") {
      throw new HttpError(400, "Unknown run review action", {
        code: "RUN_REVIEW_ACTION_INVALID",
        recovery:
          "Choose action=approve to mark the check correct or action=reject to keep it unresolved.",
      });
    }
    try {
      const reviewed = await reviewPersistedRun(runsRoot(), run, {
        action: body.action,
        actor: reviewActor(context),
        ...(typeof body.note === "string" ? { note: body.note } : {}),
      });
      recordAudit(scope, {
        action: `run.review.${body.action}`,
        resource: run.id,
        result: "allow",
      });
      json(response, 200, reviewed);
    } catch (error) {
      if (error instanceof RunReviewError) {
        const status =
          error.code === "RUN_REVIEW_NOT_FOUND"
            ? 404
            : error.code === "RUN_REVIEW_ACTOR_REQUIRED"
              ? 403
              : 409;
        throw new HttpError(status, error.message, { code: error.code, recovery: error.recovery });
      }
      throw error;
    }
    return true;
  }

  const pinMatch = matchPath(pathname, "/runs/:id/pin");
  if (method === "POST" && pinMatch) {
    const run = await readPersistedRun(pinMatch.id!);
    assertRunAccess(scope, run);
    const body = (await parseJsonBody(request)) as { pinned?: boolean };
    if (!(await setRunPinned(runsRoot(), pinMatch.id!, body.pinned !== false))) {
      throw new HttpError(404, "Run not found");
    }
    json(response, 200, { ok: true, pinned: body.pinned !== false });
    return true;
  }

  const persistedMatch = matchPath(pathname, "/runs/:id");
  if (method === "GET" && persistedMatch) {
    const run = await readPersistedRun(persistedMatch.id!);
    assertRunAccess(scope, run);
    json(response, 200, { run });
    return true;
  }

  const frameMatch = matchPath(pathname, "/runs/:id/frames/:file");
  if (method === "GET" && frameMatch) {
    const run = await readPersistedRun(frameMatch.id!);
    assertRunAccess(scope, run);
    const buffer = await readFrameFile(run.dir, frameMatch.file!);
    if (!buffer) throw new HttpError(404, "Frame not found");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": buffer.byteLength,
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
    });
    response.end(buffer);
    return true;
  }

  const videoMatch = matchPath(pathname, "/runs/:id/video/:file");
  if (method === "GET" && videoMatch) {
    const run = await readPersistedRun(videoMatch.id!);
    assertRunAccess(scope, run);
    const file = runArtifactFile(run.dir, "video", videoMatch.file!);
    if (!file) throw new HttpError(404, "Video not found");
    await streamVideo(request, response, file);
    return true;
  }

  return false;
}

async function streamVideo(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  file: string,
): Promise<void> {
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, "Video not found");
  }
  const total = info.size;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const requestedStart = range?.[1] ? Number(range[1]) : 0;
  const requestedEnd = range?.[2] ? Number(range[2]) : total - 1;
  const start = Math.max(0, Math.min(requestedStart, total - 1));
  const end = Math.max(start, Math.min(requestedEnd, total - 1));
  const partial = Boolean(range);

  response.writeHead(partial ? 206 : 200, {
    "Content-Type": file.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
    "Cache-Control": "private, max-age=3600",
    ...CORS_HEADERS,
  });
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file, { start, end });
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(response);
  });
}
