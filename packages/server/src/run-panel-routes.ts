import { createHash } from "node:crypto";
import { buildRunPanelManifest, readFrameFile, type PersistedRun } from "@relay/core";
import { CORS_HEADERS, HttpError, json, matchPath, parseLimit } from "./http.js";
import { recordedFrameDigests } from "./run-route-evidence.js";
import type { RunRouteContext } from "./run-routes.js";
import type { RequestContext } from "./security.js";

/** Existing retained artifact access; no device request or alternate store. */
export async function handleRunPanelRoute(
  context: RunRouteContext,
  loadRun: (id: string, scope: RequestContext) => Promise<PersistedRun>,
): Promise<boolean> {
  if (context.method !== "GET") return false;
  const manifest = matchPath(context.pathname, "/runs/:id/panel-manifest");
  if (manifest) {
    const run = await loadRun(manifest.id!, context.scope);
    json(context.response, 200, {
      manifest: buildRunPanelManifest(run, {
        offset: parseLimit(context.url.searchParams.get("offset"), 0, 999999),
        limit: parseLimit(context.url.searchParams.get("limit"), 40, 40),
      }),
    });
    return true;
  }
  const frame = matchPath(context.pathname, "/runs/:id/frames/:file");
  if (!frame) return false;
  const run = await loadRun(frame.id!, context.scope);
  const rawLimit = context.url.searchParams.get("maxBytes");
  const maxBytes = rawLimit === null ? undefined : Number(rawLimit);
  if (
    maxBytes !== undefined &&
    (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000)
  )
    throw new HttpError(400, "Frame display limit must be between 1 and 2000000 bytes");
  const buffer = await readFrameFile(run.dir, frame.file!);
  if (!buffer) throw new HttpError(404, "Frame not found");
  if (maxBytes !== undefined && buffer.length > maxBytes)
    throw new HttpError(413, "Frame exceeds requested display limit");
  const actual = createHash("sha256").update(buffer).digest("hex");
  const expected = recordedFrameDigests(run, frame.file!);
  if (expected.length > 0 && expected.some((digest) => digest !== actual))
    throw new HttpError(409, `Frame ${frame.file} bytes do not match the recorded digest`);
  context.response.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": buffer.byteLength,
    "Cache-Control": "private, max-age=3600",
    ...CORS_HEADERS,
  });
  context.response.end(buffer);
  return true;
}
