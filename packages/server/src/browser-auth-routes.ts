import type http from "node:http";
import {
  attachBrowserAuthenticationHealth,
  browserCaseProfileForTarget,
  captureBrowserAuthenticationStorageState,
  collectBrowserTargetAccountHealth,
  currentOperationContext,
  inspectManagedBrowserAuthPage,
  listBrowserAuthenticationFixtures,
  probeBrowserAuthenticationFixture,
  readTarget,
  revokeBrowserAuthenticationFixture,
  saveBrowserAuthenticationFixture,
  saveBrowserTarget,
} from "@relay/core";
import {
  browserAuthenticationFixtureOperationInputSchemas,
  type BrowserEnvironmentInput,
} from "@relay/protocol";
import { HttpError, json, matchPath, parseJsonBody } from "./http.js";
import type { RequestContext } from "./security.js";
import { assertTargetControl } from "./access-control.js";

type BrowserAuthRouteContext = {
  method: string;
  pathname: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  scope: RequestContext;
};

function requireHumanBrowserAuthenticationReview(): { actorId: string } {
  const operation = currentOperationContext();
  if (!operation || operation.actorKind !== "human") {
    throw new HttpError(403, "Browser sign-in fixtures require a human reviewer");
  }
  return { actorId: operation.actorId };
}

function browserAuthenticationConflict(error: unknown, fallback: string): HttpError {
  const message =
    error instanceof Error &&
    (/^Browser authentication\b/u.test(error.message) ||
      /^Open the managed browser\b/u.test(error.message))
      ? error.message
      : fallback;
  return new HttpError(409, message);
}

async function saveTargetBrowserEnvironment(
  target: NonNullable<Awaited<ReturnType<typeof readTarget>>>,
  environment: BrowserEnvironmentInput,
) {
  if (!target.browser) throw new HttpError(404, "Managed browser target not found");
  return saveBrowserTarget({
    id: target.id,
    name: target.name,
    startUrl: target.browser.startUrl,
    headless: target.browser.headless,
    viewport: environment.viewport,
    environment,
    profileRetention: target.browser.profileRetention,
  });
}

export async function handleBrowserAuthRoute(context: BrowserAuthRouteContext): Promise<boolean> {
  const { method, pathname, request: req, response: res, scope } = context;

  const listMatch = matchPath(pathname, "/targets/:id/browser-auth-fixtures");
  if (method === "GET" && listMatch) {
    const targetId = listMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const fixtures = await listBrowserAuthenticationFixtures({
      projectId: scope.projectId,
      targetId,
    });
    json(res, 200, { fixtures: await attachBrowserAuthenticationHealth(fixtures) });
    return true;
  }

  if (method === "POST" && listMatch) {
    const targetId = listMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const { actorId } = requireHumanBrowserAuthenticationReview();
    await assertTargetControl(scope, targetId);
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.save"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    const fixture = await (async () => {
      try {
        return await saveBrowserAuthenticationFixture({
          projectId: scope.projectId,
          targetId,
          name: body.name,
          createdBy: actorId,
          storageState: await captureBrowserAuthenticationStorageState(targetId),
          expiresAt: body.expiresAt,
          fixtureId: body.fixtureId,
        });
      } catch (error) {
        throw browserAuthenticationConflict(error, "Could not save browser sign-in state");
      }
    })();
    // The fixture stays an immutable execution identity in the fixture store.
    // Never persist authenticationFixtureId onto the saved browser
    // environment: that would make every unsigned open of this target
    // account-bound (breaking snapshot/interact with the project-scope
    // guard) and would make fixture Lanes unbindable
    // (LANE_FIXTURE_PERSIST_ERROR). The saved target is returned unchanged.
    json(res, 201, { fixture, target });
    return true;
  }

  const revokeMatch = matchPath(pathname, "/targets/:id/browser-auth-fixtures/revoke");
  if (method === "POST" && revokeMatch) {
    const targetId = revokeMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const { actorId } = requireHumanBrowserAuthenticationReview();
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.revoke"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    const fixture = await (async () => {
      try {
        return await revokeBrowserAuthenticationFixture({
          projectId: scope.projectId,
          targetId,
          reference: body.reference,
          revokedBy: actorId,
        });
      } catch (error) {
        throw browserAuthenticationConflict(error, "Could not revoke browser sign-in state");
      }
    })();
    const profile = browserCaseProfileForTarget(target);
    const { authenticationFixtureId: activeReference, ...environment } = profile;
    const updated =
      activeReference === fixture.reference
        ? await saveTargetBrowserEnvironment(target, environment)
        : target;
    json(res, 200, { fixture, target: updated });
    return true;
  }

  const probeMatch = matchPath(pathname, "/targets/:id/browser-auth-fixtures/probe");
  if (method === "POST" && probeMatch) {
    const targetId = probeMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.probe"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    try {
      const probed = await probeBrowserAuthenticationFixture({
        projectId: scope.projectId,
        targetId,
        reference: body.reference,
        url: body.url ?? target.browser.startUrl,
        inspectPage: (url) =>
          inspectManagedBrowserAuthPage({
            projectId: scope.projectId,
            targetId,
            reference: body.reference,
            url,
          }),
      });
      json(res, 200, probed);
      return true;
    } catch (error) {
      throw browserAuthenticationConflict(error, "Could not check this sign-in");
    }
  }

  const healthMatch = matchPath(pathname, "/targets/:id/browser-auth-fixtures/health");
  if (method === "POST" && healthMatch) {
    const targetId = healthMatch.id!;
    const target = await readTarget(targetId);
    if (!target?.browser) throw new HttpError(404, "Managed browser target not found");
    const body = browserAuthenticationFixtureOperationInputSchemas[
      "target.browser-auth.health"
    ].parse({
      targetId,
      ...((await parseJsonBody(req)) as object),
    });
    try {
      const probe = body.probe !== false;
      const collected = await collectBrowserTargetAccountHealth({
        projectId: scope.projectId,
        targetId,
        probe,
        url: target.browser.startUrl,
        inspectPage: probe
          ? (url, context) =>
              inspectManagedBrowserAuthPage({
                projectId: scope.projectId,
                targetId,
                reference: context.reference,
                url,
              })
          : undefined,
      });
      json(res, 200, collected);
      return true;
    } catch (error) {
      throw browserAuthenticationConflict(error, "Could not check sign-in health");
    }
  }

  return false;
}
