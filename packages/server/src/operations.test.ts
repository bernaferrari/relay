import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { operationDefinitions } from "@relay/protocol";
import {
  assertOperationRegistryComplete,
  findOperationHandler,
  operationHandlers,
  serverOperationManifest,
} from "./operations.js";
import { startServer } from "./index.js";

test("every protocol operation has exactly one authoritative server route", () => {
  assert.doesNotThrow(() => assertOperationRegistryComplete());
  assert.equal(operationHandlers.length, operationDefinitions.length);
  assert.equal(new Set(operationHandlers.map((item) => item.id)).size, operationDefinitions.length);
});

test("dynamic canonical routes resolve to their registered operation", () => {
  assert.equal(findOperationHandler("POST", "/jobs/job-123/cancel")?.id, "job.cancel");
  assert.equal(
    findOperationHandler("PUT", "/journeys/onboarding/document")?.id,
    "journey.document.update",
  );
  assert.equal(findOperationHandler("GET", "/events"), null);
});

test("server manifest is generated from the registry", () => {
  const manifest = serverOperationManifest();
  assert.deepEqual(
    manifest.map((item) => item.id),
    operationDefinitions.map((item) => item.id),
  );
  assert.equal(manifest.find((item) => item.id === "target.interact")?.lease, "exclusive");
});

test("GET /meta exposes the registry manifest, not a handwritten endpoint list", async () => {
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/meta`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      operations: Array<{ id: string }>;
      endpoints?: unknown;
    };
    assert.equal(body.endpoints, undefined);
    assert.deepEqual(
      body.operations.map((item) => item.id),
      operationDefinitions.map((item) => item.id),
    );
  } finally {
    await server.close();
  }
});

function normalizedRoute(method: string, path: string): string {
  return `${method} ${path.replace(/:[^/]+/g, ":*")}`;
}

async function discoverPublicMutationRoutes(): Promise<Set<string>> {
  const files = ["index.ts", "job-routes.ts", "run-routes.ts"];
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
