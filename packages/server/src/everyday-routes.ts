import type http from "node:http";
import { randomUUID } from "node:crypto";
import {
  buildRunVerdict,
  createAppMap,
  draftTestSteps,
  listAppMaps,
  parseTestYaml,
  readAppMap,
  readPersistedRun,
  runTestId,
  saveAppMapTest,
  stepsFromYaml,
  testToYaml,
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

/** The App a Test belongs to: found by id, name or website, or created for a new website. */
async function resolveApp(
  scope: RequestContext,
  input: { app?: string; url?: string },
): Promise<{ app: AppMap; createdApp: boolean }> {
  const found = findApp(await listAppMaps(scope.projectId), input);
  if (found) return { app: found, createdApp: false };
  if (input.app && !input.url) {
    throw new HttpError(404, `No app named “${input.app}”. Give its website to create it.`, {
      code: "app-not-found",
      recovery: "Pass the website address, or list apps with `relay apps`.",
    });
  }
  if (!input.url) {
    throw new HttpError(400, "Say which app (app) or give the website (url) the test opens.", {
      code: "app-required",
      recovery: "Pass url for a website, or app for an existing app.",
    });
  }
  const host = new URL(input.url).host.replace(/^www\./u, "");
  const app = await createAppMap({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    appMapId: slug(host),
    name: host,
  });
  return { app, createdApp: true };
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
    const { app, createdApp } = await resolveApp(scope, {
      ...(body.app ? { app: body.app } : {}),
      ...(url ? { url } : {}),
    });
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

  if (method === "POST" && pathname === "/tests/apply-yaml") {
    const body = (await parseJsonBody(request)) as OperationInput<"test.apply-yaml">;
    let parsed;
    try {
      parsed = parseTestYaml(String(body.yaml ?? ""));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), {
        code: "invalid-test-file",
        recovery: "Fix the reported field; a test needs name, url or app, and steps.",
      });
    }
    const { app, createdApp } = await resolveApp(scope, {
      ...(parsed.app ? { app: parsed.app } : {}),
      ...(parsed.url ? { url: parsed.url } : {}),
    });
    // The file's id, else the Test already using this name, else a new id.
    const existing =
      (parsed.id ? app.tests[parsed.id] : undefined) ??
      Object.values(app.tests).find(
        (test) => !parsed.id && test.name.trim().toLowerCase() === parsed.name.toLowerCase(),
      );
    const testId =
      existing?.id ?? parsed.id ?? `test-${slug(parsed.name)}-${randomUUID().slice(0, 6)}`;
    const steps = stepsFromYaml(testId, parsed.steps, existing?.steps ?? []);
    const keptRecorded = steps.filter((step) => step.binding.status === "resolved").length;
    await applyAppMapMutation(
      scope,
      app.id,
      app.revision,
      `apply-yaml-${testId}-${randomUUID()}`,
      (map, context) => {
        const current = map.tests[testId];
        return saveAppMapTest(
          map,
          {
            ...(current ?? {}),
            id: testId,
            organizationId: map.organizationId,
            projectId: map.projectId,
            appMapId: map.id,
            name: parsed.name,
            kind: "scenario",
            intentSchemaVersion: 1,
            ...(parsed.url ? { startUrl: parsed.url } : {}),
            steps,
            createdAt: current?.createdAt ?? context.at,
            updatedAt: context.at,
          } as AppMapScenarioTest,
          context,
        );
      },
    );
    json(response, existing ? 200 : 201, {
      appId: app.id,
      testId,
      name: parsed.name,
      created: !existing,
      createdApp,
      keptRecorded,
    });
    return true;
  }

  const yamlGet = matchPath(pathname, "/tests/:testId/yaml");
  if (method === "GET" && yamlGet) {
    const wanted = decodeURIComponent(yamlGet.testId!).trim().toLowerCase();
    const appQuery =
      new URL(request.url ?? "/", "http://relay").searchParams.get("app") ?? undefined;
    const maps = await listAppMaps(scope.projectId);
    const scoped = appQuery
      ? [findApp(maps, { app: appQuery })].filter((map): map is AppMap => Boolean(map))
      : maps;
    const matches = scoped.flatMap((map) =>
      Object.values(map.tests)
        .filter(
          (test) => test.id.toLowerCase() === wanted || test.name.trim().toLowerCase() === wanted,
        )
        .map((test) => ({ map, test })),
    );
    if (!matches.length) throw new HttpError(404, `No test named “${yamlGet.testId}”.`);
    if (matches.length > 1)
      throw new HttpError(
        409,
        `“${yamlGet.testId}” matches tests in ${matches.length} apps. Pass app.`,
      );
    const { map, test } = matches[0]!;
    json(response, 200, {
      yaml: testToYaml(test, map.name, test.id),
      appId: map.id,
      testId: test.id,
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
