/** Frames of a Run while it is still running (before its report is saved). */
import type http from "node:http";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getJob } from "@relay/core";
import { assertJobAccess } from "./access-control.js";
import { CORS_HEADERS, HttpError, matchPath } from "./http.js";
import type { RequestContext } from "./security.js";

export async function handleLiveRunRoute(context: {
  method: string;
  pathname: string;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  const match = matchPath(context.pathname, "/jobs/:id/frames/:file");
  if (context.method !== "GET" || !match) return false;
  const job = getJob(match.id!);
  assertJobAccess(context.scope, job);
  const file = basename(match.file ?? "");
  if (!job?.runDir || !/^[\w.-]+\.(png|jpe?g|webp)$/iu.test(file)) {
    throw new HttpError(404, "Frame not found");
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(join(job.runDir, "frames", file));
  } catch {
    throw new HttpError(404, "Frame not found");
  }
  context.response.writeHead(200, {
    "Content-Type": file.endsWith(".png")
      ? "image/png"
      : file.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg",
    "Content-Length": bytes.byteLength,
    "Cache-Control": "private, max-age=3600",
    ...CORS_HEADERS,
  });
  context.response.end(bytes);
  return true;
}
