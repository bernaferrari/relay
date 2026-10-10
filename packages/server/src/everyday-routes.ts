import type http from "node:http";
import { randomUUID } from "node:crypto";
import {
  buildRunVerdict,
  createAppMap,
  draftTestSteps,
  listAppMaps,
  readAppMap,
  readPersistedRun,
  runTestId,
  saveAppMapTest,
} from "@relay/core";
import type { AppMap, AppMapScenarioTest, OperationInput } from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";
import { applyAppMapMutation } from "./app-map-route-mutations.js";

const PLAIN_ENGLISH_REASON = "Runs from its description. Record it to make it faster and exact.";

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^www\./u, "")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "app"
  );
}

/** An App by id, by exact name, or by the website's host. */
export function findApp(
  maps: readonly AppMap[],
  input: { app?: string; url?: string },
): AppMap | undefined {
  const wanted = input.app?.trim().toLowerCase();
  if (wanted) {
    return (
      maps.find((map) => map.id.toLowerCase() === wanted) ??
      maps.find((map) => map.name.trim().toLowerCase() === wanted) ??
      maps.find((map) => slug(map.name) === slug(wanted))
    );
  }
  if (input.url) {
    const host = new URL(input.url).host.replace(/^www\./u, "").toLowerCase();
    return maps.find((map) => map.name.trim().toLowerCase() === host || map.id === slug(host));
  }
  return undefined;
}

type RouteInput = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

export async function handleEverydayRoute(input: RouteInput): Promise<boolean> {
  const { method, pathname, request, response, scope } = input;

  if (method === "POST" && pathname === "/tests/from-goal") {
    const body = (await parseJsonBody(request)) as OperationInput<"test.create-from-goal">;
    const goal = String(body.goal ?? "").trim();
    if (!goal) throw new HttpError(400, "Describe what should work.");
    const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined;
    if (url && !/^https?:\/\//iu.test(url))
      throw new HttpError(400, "The website must start with http:// or https://");
    let app = findApp(await listAppMaps(scope.projectId), {
      ...(body.app ? { app: body.app } : {}),
      ...(url ? { url } : {}),
    });
    let createdApp = false;
    if (!app) {
      if (body.app && !url) {
        throw new HttpError(404, `No app named “${body.app}”. Give its website to create it.`, {
          code: "app-not-found",
          recovery: "Pass the website address, or list apps with `relay apps`.",
        });
      }
      if (!url) {
        throw new HttpError(400, "Say which app (app) or give the website (url) the test opens.", {
          code: "app-required",
          recovery: "Pass url for a website, or app for an existing app.",
        });
      }
      const host = new URL(url).host.replace(/^www\./u, "");
      app = await createAppMap({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        appMapId: slug(host),
        name: host,
      });
      createdApp = true;
    }
    const drafted = await draftTestSteps({
      goal,
      ...(url ? { startUrl: url } : {}),
      appMap: app,
    });
    if (!drafted.steps.length)
      throw new HttpError(400, "Describe at least one thing to do or check.");
    const testId = `test-${randomUUID()}`;
    const name = body.name?.trim() || drafted.name;
    await applyAppMapMutation(scope, app.id, app.revision, `create-${testId}`, (map, context) =>
      saveAppMapTest(
        map,
        {
          id: testId,
          organizationId: map.organizationId,
          projectId: map.projectId,
          appMapId: map.id,
          name,
          kind: "scenario",
          intentSchemaVersion: 1,
          ...(url ? { startUrl: url } : {}),
          steps: drafted.steps.map((step, index) => ({
            id: `${testId}-step-${index + 1}`,
            kind: step.kind,
            intent: step.intent,
            binding: { status: "unresolved", reason: PLAIN_ENGLISH_REASON, fromText: true },
          })),
          createdAt: context.at,
          updatedAt: context.at,
        } as AppMapScenarioTest,
        context,
      ),
    );
    json(response, 201, {
      appId: app.id,
      testId,
      name,
      steps: drafted.steps.map((step) => ({
        kind: step.kind === "validation" ? "check" : "action",
        text: step.intent,
      })),
      source: drafted.source,
      createdApp,
    });
    return true;
  }

  const verdict = matchPath(pathname, "/runs/:runId/verdict");
  if (method === "GET" && verdict) {
    const run = await readPersistedRun(verdict.runId!);
    if (!run || (run.projectId && run.projectId !== scope.projectId))
      throw new HttpError(404, `Run ${verdict.runId} not found`);
    const appMapId = /^app-map:([^:]+):/u.exec(run.action)?.[1];
    const testId = runTestId(run);
    const map = appMapId ? await readAppMap(scope.projectId, appMapId) : undefined;
    const test = testId ? map?.tests[testId] : undefined;
    json(response, 200, {
      verdict: buildRunVerdict(run, test ? { name: test.name, steps: test.steps } : undefined),
    });
    return true;
  }
  return false;
}
