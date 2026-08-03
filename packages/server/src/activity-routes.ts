import type http from "node:http";
import {
  ActivityCursorError,
  appendActivity,
  listActivity,
  MAX_ACTIVITY_PAGE_SIZE,
} from "@relay/core";
import type { OperationDefinition } from "@relay/protocol";
import { HttpError, json } from "./http.js";
import type { RequestContext } from "./security.js";

const DEFAULT_LIMIT = 50;

export type ActivityOperationRegistration = {
  id: string;
  path: string;
  definition: OperationDefinition;
};

function pathParameters(pathname: string, pattern: string): Record<string, string> {
  const actual = pathname.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  const result: Record<string, string> = {};
  for (let index = 0; index < Math.min(actual.length, expected.length); index++) {
    const key = expected[index]!;
    if (key.startsWith(":")) result[key.slice(1)] = decodeURIComponent(actual[index]!);
  }
  return result;
}

function semanticResource(
  operationId: string,
  pathname: string,
  pattern: string,
  projectId: string,
): { kind: string; id: string } {
  const params = pathParameters(pathname, pattern);
  const prefix = operationId.split(".")[0] ?? "project";
  const kind =
    prefix === "authoring" ? "recording-session" : prefix === "workspace" ? "project" : prefix;
  const preferredKeys =
    kind === "recording-session"
      ? ["sessionId", "id"]
      : [
          `${kind.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Id`,
          "id",
          "appMapId",
          "recipeId",
          "sessionId",
          "actionId",
          "leaseId",
        ];
  return {
    kind,
    id: preferredKeys.map((key) => params[key]).find(Boolean) ?? projectId,
  };
}

/** Record the canonical semantic command before its handler consumes any body.
 * This intentionally stores only registry metadata and route identity. */
export async function recordOperationActivity(input: {
  operation: ActivityOperationRegistration;
  pathname: string;
  scope: RequestContext;
}): Promise<void> {
  if (input.operation.definition.mode !== "command") return;
  const resource = semanticResource(
    input.operation.id,
    input.pathname,
    input.operation.path,
    input.scope.projectId,
  );
  await appendActivity({
    eventType: "operation.requested",
    resourceKind: resource.kind,
    resourceId: resource.id,
    summary: input.operation.definition.label,
  });
}

function activityLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "activity limit must be a positive integer");
  }
  return Math.min(value, MAX_ACTIVITY_PAGE_SIZE);
}

export async function handleActivityRoute(input: {
  method: string;
  pathname: string;
  url: URL;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  if (input.method !== "GET" || input.pathname !== "/activity") return false;
  try {
    const page = await listActivity({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      limit: activityLimit(input.url.searchParams.get("limit")),
      ...(input.url.searchParams.get("cursor")
        ? { cursor: input.url.searchParams.get("cursor")! }
        : {}),
    });
    json(input.response, 200, page);
  } catch (error) {
    if (error instanceof ActivityCursorError) throw new HttpError(400, error.message);
    throw error;
  }
  return true;
}
