import type http from "node:http";
import { importManagedFixture, listManagedFixtures } from "@relay/core";
import { MAX_FIXTURE_BASE64_CHARS } from "@relay/protocol";
import { HttpError, json, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";

export async function handleManagedFixtureRoute(input: {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
}): Promise<boolean> {
  if (input.pathname !== "/fixtures") return false;
  if (input.method === "GET") {
    json(input.response, 200, { fixtures: await listManagedFixtures(input.scope.projectId) });
    return true;
  }
  if (input.method === "POST") {
    const body = await parseJsonBody(input.request, MAX_FIXTURE_BASE64_CHARS + 4096);
    try {
      json(input.response, 201, {
        fixture: await importManagedFixture(input.scope.projectId, body),
      });
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Could not import test file",
      );
    }
    return true;
  }
  return false;
}
