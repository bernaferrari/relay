/** Reference screenshots: compare, ignore areas, and the reference/diff images. */
import type http from "node:http";
import {
  applyCaptureReferences,
  captureDiffImageForItem,
  captureReferenceImageForItem,
  captureReviewQueueForRun,
  listReviewInbox,
  readFrameFile,
  runsRoot,
  updateCaptureReferenceIgnoreRegions,
  type PersistedRun,
} from "@relay/core";
import { isCaptureReferenceRegion, type CaptureReviewItem } from "@relay/protocol";
import { CORS_HEADERS, HttpError, json, matchPath, parseJsonBody } from "./http.js";
import { loadScopedRun } from "./run-routes.js";
import { recordAudit, type RequestContext } from "./security.js";

type CaptureReferenceRouteContext = {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function captureItem(run: PersistedRun, captureId: unknown): CaptureReviewItem {
  if (typeof captureId !== "string" || !captureId.trim()) {
    throw new HttpError(400, "captureId is required", {
      code: "CAPTURE_REFERENCE_ID_REQUIRED",
      recovery: "Pass the captureId shown in the Run's screenshot review.",
    });
  }
  const item = captureReviewQueueForRun(run).items.find(
    (candidate) => candidate.captureId === captureId.trim(),
  );
  if (!item) throw new HttpError(404, "That screenshot is not part of this Run");
  return item;
}

function png(response: http.ServerResponse, buffer: Buffer): void {
  response.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": buffer.byteLength,
    "Cache-Control": "private, no-cache",
    ...CORS_HEADERS,
  });
  response.end(buffer);
}

export async function handleCaptureReferenceRoute(
  context: CaptureReferenceRouteContext,
): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = context;

  if (method === "GET" && pathname === "/review/inbox") {
    const sinceDays = Number(url.searchParams.get("sinceDays") ?? "14");
    const appMapId = url.searchParams.get("appMapId")?.trim();
    json(
      response,
      200,
      await listReviewInbox(runsRoot(), {
        sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? Math.min(sinceDays, 365) : 14,
        ...(appMapId ? { appMapId } : {}),
        visible: (run) =>
          scope.localTrusted ||
          (run.projectId === scope.projectId && run.ownerId === scope.subject),
      }),
    );
    return true;
  }

  const thumbnail = matchPath(pathname, "/runs/:id/thumbnail");
  if (method === "GET" && thumbnail) {
    const run = await loadScopedRun(thumbnail.id!, scope);
    const captures = captureReviewQueueForRun(run).items.filter((item) => item.framePath);
    const path = captures.at(-1)?.framePath ?? run.frames?.at(-1)?.path;
    const bytes = path ? await readFrameFile(run.dir, path) : null;
    if (!bytes) throw new HttpError(404, "This run has no screenshot");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": bytes.byteLength,
      "Cache-Control": "private, max-age=86400, immutable",
      ...CORS_HEADERS,
    });
    response.end(bytes);
    return true;
  }

  const compare = matchPath(pathname, "/runs/:id/capture-reference/compare");
  if (method === "POST" && compare) {
    const run = await loadScopedRun(compare.id!, scope);
    const next = await applyCaptureReferences(runsRoot(), run);
    json(response, 200, { queue: captureReviewQueueForRun(next) });
    return true;
  }

  const ignore = matchPath(pathname, "/runs/:id/capture-reference/ignore-regions");
  if (method === "PUT" && ignore) {
    const run = await loadScopedRun(ignore.id!, scope);
    const body = (await parseJsonBody(request)) as { captureId?: unknown; regions?: unknown };
    const item = captureItem(run, body.captureId);
    if (
      !Array.isArray(body.regions) ||
      body.regions.length > 50 ||
      !body.regions.every(isCaptureReferenceRegion)
    ) {
      throw new HttpError(400, "Ignore areas must be up to 50 rectangles inside the screenshot", {
        code: "CAPTURE_REFERENCE_REGIONS_INVALID",
        recovery: "Draw the areas again on the screenshot.",
      });
    }
    const updated = await updateCaptureReferenceIgnoreRegions(runsRoot(), run, item, body.regions);
    if (!updated) {
      throw new HttpError(409, "This screenshot has no reference yet", {
        code: "CAPTURE_REFERENCE_MISSING",
        recovery: "Mark a screenshot of this screen Looks correct first; then ignore areas on it.",
      });
    }
    recordAudit(scope, {
      action: "run.capture.reference.ignore-regions.update",
      resource: run.id,
      result: "allow",
    });
    const next = await applyCaptureReferences(runsRoot(), run);
    json(response, 200, { queue: captureReviewQueueForRun(next) });
    return true;
  }

  const image = matchPath(pathname, "/runs/:id/capture-reference/image");
  if (method === "GET" && image) {
    const run = await loadScopedRun(image.id!, scope);
    const found = await captureReferenceImageForItem(
      runsRoot(),
      run,
      captureItem(run, url.searchParams.get("captureId")),
    );
    if (!found) throw new HttpError(404, "This screenshot has no reference yet");
    png(response, found.bytes);
    return true;
  }

  const diff = matchPath(pathname, "/runs/:id/capture-reference/diff");
  if (method === "GET" && diff) {
    const run = await loadScopedRun(diff.id!, scope);
    const buffer = await captureDiffImageForItem(
      runsRoot(),
      run,
      captureItem(run, url.searchParams.get("captureId")),
    );
    if (!buffer) throw new HttpError(404, "No reference to compare this screenshot with");
    png(response, buffer);
    return true;
  }

  return false;
}
