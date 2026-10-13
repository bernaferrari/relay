import type http from "node:http";
import { e2eOperationInputSchemas } from "@relay/protocol";
import { createE2EProjectService } from "./e2e-project-service.js";
import type { RequestContext } from "./security.js";
import { HttpError, json, parseJsonBody } from "./http.js";
const service = createE2EProjectService();
export async function handleE2EProjectRoute(input: {
  method: string;
  pathname: string;
  url: URL;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
}) {
  if (!input.pathname.startsWith("/e2e/")) return false;
  if (!input.scope.localTrusted)
    throw new HttpError(403, "Executable projects are available only from the local Relay host");
  const { method, pathname, response } = input;
  const scope = { projectId: input.scope.projectId, ownerId: input.scope.subject };
  try {
    if (pathname === "/e2e/projects") {
      if (method === "GET") {
        json(response, 200, await service.list());
        return true;
      }
      if (method === "POST") {
        const body = e2eOperationInputSchemas["e2e.project.open"].parse(
          await parseJsonBody(input.request),
        );
        json(response, 200, {
          project: await service.open(body.path, body.trust, body.configFile),
        });
        return true;
      }
    }
    const p = /^\/e2e\/projects\/([^/]+)\/(refresh|source|run)$/.exec(pathname);
    if (p) {
      const projectId = decodeURIComponent(p[1]!);
      if (p[2] === "source" && method === "GET") {
        const body = e2eOperationInputSchemas["e2e.project.source"].parse({
          projectId,
          file: input.url.searchParams.get("file"),
        });
        json(response, 200, await service.source(body.projectId, body.file));
        return true;
      }
      if (p[2] === "refresh" && method === "POST") {
        await parseJsonBody(input.request);
        json(response, 200, { project: await service.refresh(projectId) });
        return true;
      }
      if (p[2] === "run" && method === "POST") {
        const body = e2eOperationInputSchemas["e2e.project.run"].parse({
          ...((await parseJsonBody(input.request)) as object),
          projectId,
        });
        json(response, 202, { execution: await service.run(body.projectId, body.testId, scope) });
        return true;
      }
    }
    const e = /^\/e2e\/executions\/([^/]+)(?:\/(cancel|import))?$/.exec(pathname);
    if (e) {
      const executionId = decodeURIComponent(e[1]!);
      if (!e[2] && method === "GET") {
        json(response, 200, { execution: await service.execution(executionId) });
        return true;
      }
      if (e[2] && method === "POST") {
        await parseJsonBody(input.request);
        json(response, 200, {
          execution:
            e[2] === "cancel"
              ? await service.cancel(executionId)
              : await service.retryImport(executionId, scope),
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "e2e request failed");
  }
}
