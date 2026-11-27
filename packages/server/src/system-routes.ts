/** System-level routes: audit, doctor, reports, product metadata, and the
 * model key. These are pure request/response handlers with no shared mutable
 * server state, extracted from the dispatch composition root. */
import {
  getJob,
  listActionsWithTrace,
  runDoctor,
  doctorFailureMessage,
  saveModelKey,
  toJobReport,
  toJunitXml,
  type RelayModelProvider,
} from "@relay/core";
import { collectVisibleReports } from "./report-access.js";
import { listAuditEvents } from "./security.js";
import { serverMeta } from "./server-meta.js";
import { HttpError, json, matchPath, parseJsonBody, parseLimit, text } from "./http.js";
import type { ServerRouteInput } from "./server-route-input.js";

export async function handleSystemRoute(input: ServerRouteInput): Promise<boolean> {
  const { method, pathname, url, request, response, scope } = input;

  if (method === "GET" && pathname === "/audit") {
    json(response, 200, {
      events: listAuditEvents(parseLimit(url.searchParams.get("limit"), 100), scope),
    });
    return true;
  }

  if (method === "GET" && pathname === "/actions") {
    json(response, 200, { actions: listActionsWithTrace() });
    return true;
  }

  if (method === "POST" && pathname === "/system/model-key") {
    const body = (await parseJsonBody(request)) as {
      key?: unknown;
      provider?: unknown;
      baseURL?: unknown;
    };
    if (typeof body.key !== "string") throw new HttpError(400, "key must be a string");
    if (
      body.provider !== undefined &&
      (typeof body.provider !== "string" ||
        !["anthropic", "openai", "google", "openrouter", "openai-compatible"].includes(
          body.provider,
        ))
    ) {
      throw new HttpError(400, "provider must be a supported model provider");
    }
    if (body.baseURL !== undefined && typeof body.baseURL !== "string") {
      throw new HttpError(400, "baseURL must be a string");
    }
    try {
      const provider =
        typeof body.provider === "string" ? (body.provider as RelayModelProvider) : undefined;
      const result = await saveModelKey(body.key, {
        ...(provider ? { provider } : {}),
        ...(typeof body.baseURL === "string" ? { baseURL: body.baseURL } : {}),
      });
      json(response, 200, {
        configured: result.configured,
        source: result.source,
        ...(result.provider ? { provider: result.provider } : {}),
      });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid key");
    }
    return true;
  }

  if (method === "GET" && pathname === "/doctor") {
    const result = await runDoctor();
    json(
      response,
      result.ok ? 200 : 503,
      result.ok ? result : { ...result, error: doctorFailureMessage(result) },
    );
    return true;
  }

  // Must be registered before /report/:jobId so "junit" is not treated as an id.
  if (method === "GET" && pathname === "/report/junit") {
    const limit = parseLimit(url.searchParams.get("limit"), 50);
    text(response, 200, toJunitXml(collectVisibleReports(limit, scope)), "text/xml; charset=utf-8");
    return true;
  }

  if (method === "GET" && pathname === "/report") {
    const limit = parseLimit(url.searchParams.get("limit"), 20);
    json(response, 200, { reports: collectVisibleReports(limit, scope) });
    return true;
  }

  const reportMatch = matchPath(pathname, "/report/:jobId");
  if (method === "GET" && reportMatch) {
    const job = getJob(reportMatch.jobId!);
    if (!job) throw new HttpError(404, "Job not found");
    if (
      !scope.localTrusted &&
      (job.projectId !== scope.projectId || job.ownerId !== scope.subject)
    ) {
      throw new HttpError(404, "Job not found");
    }
    json(response, 200, toJobReport(job));
    return true;
  }

  if (method === "GET" && pathname === "/meta") {
    json(response, 200, serverMeta(scope));
    return true;
  }

  return false;
}
