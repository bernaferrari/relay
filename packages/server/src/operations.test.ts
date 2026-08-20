import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { operationDefinitions, type ProjectRole } from "@relay/protocol";
import {
  assertOperationRegistryComplete,
  bindOperationRequest,
  findOperationHandler,
  OperationAuthorizationError,
  operationHandlers,
  serverOperationManifest,
} from "./operations.js";
import { startServer } from "./index.js";
import type { RequestContext } from "./security.js";

test("every protocol operation has exactly one authoritative server route", () => {
  assert.doesNotThrow(() => assertOperationRegistryComplete());
  assert.equal(operationHandlers.length, operationDefinitions.length);
  assert.equal(new Set(operationHandlers.map((item) => item.id)).size, operationDefinitions.length);
});

test("dynamic canonical routes resolve to their registered operation", () => {
  assert.equal(findOperationHandler("GET", "/runs/repairs")?.id, "run.repair.list");
  assert.equal(findOperationHandler("POST", "/jobs/job-123/cancel")?.id, "job.cancel");
  assert.equal(findOperationHandler("POST", "/runs/run-123/replay")?.id, "run.replay");
  assert.equal(
    findOperationHandler("GET", "/runs/run-123/checks/usage/repair")?.id,
    "run.repair.get",
  );
  assert.equal(
    findOperationHandler("POST", "/runs/run-123/checks/usage/retry")?.id,
    "run.repair.retry",
  );
  assert.equal(
    findOperationHandler("POST", "/runs/run-123/checks/usage/proposals")?.id,
    "run.repair.propose",
  );
  assert.equal(
    findOperationHandler("POST", "/app-maps/onboarding/proposals/repair-1/revert")?.id,
    "app-map.proposal.revert",
  );
  assert.equal(
    findOperationHandler("POST", "/capture/scroll-survey")?.id,
    "target.scroll-survey.capture",
  );
  assert.equal(findOperationHandler("PUT", "/app-maps/onboarding")?.id, "app-map.update");
  assert.equal(findOperationHandler("POST", "/app-maps/onboarding/commit")?.id, "app-map.commit");
  assert.equal(
    findOperationHandler("POST", "/app-maps/onboarding/screens/capture")?.id,
    "app-map.screen.capture",
  );
  assert.equal(
    findOperationHandler(
      "POST",
      "/app-maps/onboarding/screens/settings/variants/settings-ja/scroll-surfaces/capture",
    )?.id,
    "app-map.scroll-surface.capture",
  );
  assert.equal(
    findOperationHandler(
      "POST",
      "/app-maps/onboarding/screens/settings/variants/settings-ja/scroll-surfaces/capture-1/regenerate",
    )?.id,
    "app-map.scroll-surface.regenerate",
  );
  assert.equal(
    findOperationHandler(
      "GET",
      "/app-maps/onboarding/screens/settings/variants/settings-ja/scroll-surfaces/capture-1/reviewed-origin",
    )?.id,
    "app-map.scroll-surface.reviewed-origin.inspect",
  );
  assert.equal(
    findOperationHandler(
      "POST",
      "/app-maps/onboarding/screens/settings/variants/settings-ja/scroll-surfaces/capture-1/reviewed-origin/review",
    )?.id,
    "app-map.scroll-surface.reviewed-origin.review",
  );
  assert.equal(
    findOperationHandler(
      "POST",
      "/app-maps/onboarding/screens/settings/variants/settings-ja/scroll-surfaces/capture-1/reviewed-origin/reviewed-origin-1/revoke",
    )?.id,
    "app-map.scroll-surface.reviewed-origin.revoke",
  );
  assert.equal(findOperationHandler("POST", "/app-maps/onboarding/teach")?.id, "app-map.teach");
  assert.equal(findOperationHandler("GET", "/events")?.id, "event.stream");
});

test("server manifest is generated from the registry", () => {
  const manifest = serverOperationManifest();
  assert.deepEqual(
    manifest.map((item) => item.id),
    operationDefinitions.map((item) => item.id),
  );
  assert.equal(manifest.find((item) => item.id === "target.interact")?.lease, "exclusive");
});

function scope(role: ProjectRole): RequestContext {
  return {
    subject: `test:${role}`,
    organizationId: "org-1",
    projectId: "project-1",
    allowedProjects: ["project-1"],
    tokenKind: "service",
    localTrusted: false,
    role,
  };
}

function bind(method: string, pathname: string, role: ProjectRole) {
  return bindOperationRequest(
    { headers: {} } as IncomingMessage,
    {} as ServerResponse,
    method,
    pathname,
    new URL(`https://relay.example${pathname}`),
    scope(role),
  );
}

test("operation authorization applies before optional command envelopes", () => {
  assert.doesNotThrow(() => bind("GET", "/health", "viewer"));
  assert.doesNotThrow(() => bind("PUT", "/app-maps/map-1", "author"));
  assert.doesNotThrow(() => bind("POST", "/jobs", "runner"));
  assert.doesNotThrow(() => bind("PUT", "/settings/privacy", "admin"));

  assert.throws(
    () => bind("POST", "/jobs", "viewer"),
    (error: unknown) =>
      error instanceof OperationAuthorizationError &&
      error.operationId === "job.start" &&
      error.actualRole === "viewer" &&
      error.requiredRole === "runner",
  );
  assert.throws(
    () => bind("PUT", "/settings/privacy", "runner"),
    (error: unknown) =>
      error instanceof OperationAuthorizationError && error.requiredRole === "admin",
  );
  assert.throws(
    () => bind("GET", "/activity", "runner"),
    (error: unknown) =>
      error instanceof OperationAuthorizationError && error.operationId === "activity.list",
  );
});

test("GET /meta exposes the registry manifest, not a handwritten endpoint list", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/meta`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      operations: Array<{ id: string }>;
      access?: { role: string; organizationId: string; projectId: string };
      endpoints?: unknown;
    };
    assert.equal(body.endpoints, undefined);
    assert.deepEqual(
      body.operations.map((item) => item.id),
      operationDefinitions.map((item) => item.id),
    );

    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as {
      access?: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(healthBody.access, {
      role: "admin",
      organizationId: "local",
      projectId: "default",
    });
  } finally {
    await server.close();
  }
});

test("a network service token receives its configured role and actionable denials", async () => {
  const previous = {
    redaction: process.env.RELAY_REDACTION_MODE,
    role: process.env.RELAY_AUTH_ROLE,
    organization: process.env.RELAY_AUTH_ORGANIZATION_ID,
    projects: process.env.RELAY_AUTH_PROJECT_IDS,
  };
  process.env.RELAY_REDACTION_MODE = "on";
  process.env.RELAY_AUTH_ROLE = "viewer";
  process.env.RELAY_AUTH_ORGANIZATION_ID = "org-network";
  process.env.RELAY_AUTH_PROJECT_IDS = "project-network";
  const token = "test-service-token-with-32-characters";
  const server = await startServer({ host: "0.0.0.0", port: 0, token });
  const headers = { authorization: `Bearer ${token}` };
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`, { headers });
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as {
      access: { role: string; organizationId: string; projectId: string };
    };
    assert.deepEqual(healthBody.access, {
      role: "viewer",
      organizationId: "org-network",
      projectId: "project-network",
    });

    const denied = await fetch(`http://127.0.0.1:${server.port}/jobs`, {
      method: "POST",
      headers,
    });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), {
      error: "job.start requires the runner role; this connection has the viewer role",
      code: "PROJECT_ROLE_REQUIRED",
      operationId: "job.start",
      role: "viewer",
      requiredRole: "runner",
      recovery:
        "Use a Relay connection whose configured project role permits this operation, or ask a project administrator to perform it.",
    });
  } finally {
    await server.close();
    if (previous.redaction === undefined) delete process.env.RELAY_REDACTION_MODE;
    else process.env.RELAY_REDACTION_MODE = previous.redaction;
    if (previous.role === undefined) delete process.env.RELAY_AUTH_ROLE;
    else process.env.RELAY_AUTH_ROLE = previous.role;
    if (previous.organization === undefined) delete process.env.RELAY_AUTH_ORGANIZATION_ID;
    else process.env.RELAY_AUTH_ORGANIZATION_ID = previous.organization;
    if (previous.projects === undefined) delete process.env.RELAY_AUTH_PROJECT_IDS;
    else process.env.RELAY_AUTH_PROJECT_IDS = previous.projects;
  }
});

function normalizedRoute(method: string, path: string): string {
  return `${method} ${path.replace(/:[^/]+/g, ":*")}`;
}

async function discoverPublicMutationRoutes(): Promise<Set<string>> {
  const files = ["index.ts", "job-routes.ts", "run-routes.ts", "authoring-routes.ts"];
  const routes = new Set<string>();
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const matches = new Map<string, string>();
    for (const match of source.matchAll(
      /const\s+(\w+)\s*=\s*matchPath\(pathname,\s*"([^"]+)"\)/g,
    )) {
      matches.set(match[1]!, match[2]!);
    }
    for (const match of source.matchAll(
      /method === "(POST|PUT|DELETE)"\s*&&\s*pathname === "([^"]+)"/g,
    )) {
      routes.add(normalizedRoute(match[1]!, match[2]!));
    }
    for (const match of source.matchAll(/method === "(POST|PUT|DELETE)"\s*&&\s*(\w+)/g)) {
      const path = matches.get(match[2]!);
      if (path) routes.add(normalizedRoute(match[1]!, path));
    }
  }
  return routes;
}

test("every discoverable public server mutation has an operation descriptor", async () => {
  const actual = await discoverPublicMutationRoutes();
  const registered = new Set(
    operationHandlers
      .filter((item) => item.method !== "GET")
      .map((item) => normalizedRoute(item.method, item.path)),
  );
  assert.deepEqual([...actual].filter((route) => !registered.has(route)).sort(), []);
});
