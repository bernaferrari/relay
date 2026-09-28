import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import type { PersistedRun } from "@relay/core";
import { CORS_HEADERS, HttpError } from "./http.js";

export function recordedFrameDigests(
  run: { artifacts?: { kind: string; data: unknown }[] },
  file: string,
): string[] {
  const digests = new Set<string>();
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "capture-review") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    if (!("framePath" in data) || !("imageSha256" in data)) continue;
    const framePath = data.framePath;
    const imageSha256 = data.imageSha256;
    if (typeof framePath !== "string" || typeof imageSha256 !== "string" || !imageSha256) continue;
    if (framePath === file || framePath.endsWith(`/${file}`)) digests.add(imageSha256);
  }
  return [...digests];
}

function runPlanAppMapId(run: PersistedRun): string | undefined {
  for (const artifact of run.artifacts ?? []) {
    if (artifact.kind !== "app-map-test-plan") continue;
    const data = artifact.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const id = (data as { appMapId?: unknown }).appMapId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

/** The requested map must be the run's stored plan. A query may name the map
 * only when the run itself has no plan identity. */
export function resolvePlayerAppMapId(run: PersistedRun, url: URL): string {
  const requested = url.searchParams.get("appMap")?.trim() || undefined;
  const stored = runPlanAppMapId(run);
  if (requested && stored && requested !== stored) {
    throw new HttpError(409, `Run ${run.id} belongs to App Map ${stored}, not ${requested}`);
  }
  const appMapId = requested || stored;
  if (!appMapId) {
    throw new HttpError(422, "Run has no App Map plan identity; pass ?appMap=<id> explicitly");
  }
  return appMapId;
}

export function assertJoinedRunSharesAppMap(run: PersistedRun, appMapId: string): void {
  const stored = runPlanAppMapId(run);
  if (stored !== appMapId) {
    throw new HttpError(
      409,
      stored
        ? `Run ${run.id} belongs to App Map ${stored}, not ${appMapId}`
        : `Run ${run.id} has no App Map plan identity and cannot be joined`,
    );
  }
}

export function joinedRunIds(url: URL, primaryId: string): string[] {
  const ids: string[] = [];
  const seen = new Set([primaryId]);
  for (const value of url.searchParams.getAll("with")) {
    for (const part of value.split(",")) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export async function streamVideo(
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
