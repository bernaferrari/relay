import type http from "node:http";
import {
  deleteTarget,
  listTargets,
  openBrowserTarget,
  preflightTarget,
  readTarget,
  saveBrowserTarget,
} from "@relay/core";
import type { BrowserEnvironmentInput, BrowserViewport } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";

export type TargetRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
};

export async function handleTargetRoute(context: TargetRouteContext): Promise<boolean> {
  const { method, pathname, request: req, response: res } = context;

  if (method === "GET" && pathname === "/targets") {
    json(res, 200, { targets: await listTargets() });
    return true;
  }

  if (method === "POST" && pathname === "/targets") {
    const body = (await parseJsonBody(req)) as {
      id?: string;
      name?: string;
      startUrl?: string;
      headless?: boolean;
      viewport?: BrowserViewport;
      environment?: BrowserEnvironmentInput;
    };
    if (!body.name || !body.startUrl) throw new HttpError(400, "name and startUrl are required");
    json(res, 201, {
      target: await saveBrowserTarget({
        id: body.id,
        name: body.name,
        startUrl: body.startUrl,
        headless: body.headless,
        viewport: body.viewport,
        environment: body.environment,
      }),
    });
    return true;
  }

  const targetMatch = matchPath(pathname, "/targets/:id");
  if (method === "DELETE" && targetMatch) {
    await deleteTarget(targetMatch.id!);
    json(res, 200, { ok: true });
    return true;
  }

  const targetPreflightMatch = matchPath(pathname, "/targets/:id/preflight");
  if (method === "POST" && targetPreflightMatch) {
    const target = await readTarget(targetPreflightMatch.id!);
    if (!target) throw new HttpError(404, "Target not found");
    json(res, 200, { preflight: await preflightTarget(target) });
    return true;
  }

  const targetOpenMatch = matchPath(pathname, "/targets/:id/open");
  if (method === "POST" && targetOpenMatch) {
    const target = await readTarget(targetOpenMatch.id!);
    if (!target) throw new HttpError(404, "Target not found");
    if (target.kind !== "browser") throw new HttpError(400, "Target is not a browser");
    json(res, 200, { session: await openBrowserTarget(target.id) });
    return true;
  }

  return false;
}
