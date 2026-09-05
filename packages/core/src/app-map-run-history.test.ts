import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapScenarioTest } from "@relay/protocol";
import { createAppMap, mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import { projectPersistedAppMapRun } from "./app-map-run-history.js";
import type { PersistedRun } from "./runs.js";

function testEntity(updatedAt = 10): AppMapScenarioTest {
  return {
    id: "checkout",
    appMapId: "map",
    organizationId: "org",
    projectId: "project",
    createdAt: 1,
    updatedAt,
    name: "Checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [],
  };
}

function run(revision: number, outcome: PersistedRun["outcome"] = "passed"): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-validation",
    projectId: "project",
    ownerId: "owner",
    action: "app-map:map:test:checkout",
    status: outcome === "passed" ? "ok" : "error",
    outcome,
    queuedAt: 20,
    startedAt: 21,
    finishedAt: 22,
    attempts: 1,
    logs: [],
    steps: [],
    frames: [],
    artifacts: [
      {
        kind: "app-map-test-plan",
        capturedAt: 21,
        data: { appMapId: "map", appMapRevision: revision, test: { id: "checkout" } },
      },
    ],
    dir: "/tmp/run-validation",
    writtenAt: 22,
    inputDigest: "digest",
    resolvedInputs: {},
  };
}

test(
  "successful exact Test run writes one validation receipt and duplicate projection is idempotent",
  { concurrency: false },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-test-validation-history-"));
    const previous = process.env.RELAY_STATE_DIR;
    process.env.RELAY_STATE_DIR = root;
    resetControlDatabaseCache();
    try {
      await createAppMap({
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        name: "Map",
      });
      const saved = await mutateStoredAppMap("project", "map", (map) => {
        return {
          ...map,
          tests: { ...map.tests, checkout: testEntity() },
          revision: map.revision + 1,
        };
      });
      const before = saved.revision;
      assert.equal(await projectPersistedAppMapRun(run(before)), true);
      const validated = await readAppMap("project", "map");
      assert.equal(validated?.tests.checkout?.validation?.status, "passed");
      assert.equal(Object.values(validated?.activity ?? {}).at(-1)?.eventType, "test.validated");
      const afterFirst = validated?.revision;
      assert.equal(await projectPersistedAppMapRun(run(before)), false);
      const afterDuplicate = await readAppMap("project", "map");
      assert.equal(afterDuplicate?.revision, afterFirst);
    } finally {
      if (previous === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "failed and stale old runs never clear pending validation after an edit",
  { concurrency: false },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-test-validation-pending-"));
    const previous = process.env.RELAY_STATE_DIR;
    process.env.RELAY_STATE_DIR = root;
    resetControlDatabaseCache();
    try {
      await createAppMap({
        organizationId: "org",
        projectId: "project",
        appMapId: "map",
        name: "Map",
      });
      const saved = await mutateStoredAppMap("project", "map", (map) => {
        return {
          ...map,
          tests: { ...map.tests, checkout: testEntity() },
          revision: map.revision + 1,
        };
      });
      assert.equal(await projectPersistedAppMapRun(run(saved.revision)), true);
      const edited = await mutateStoredAppMap("project", "map", (map) => {
        const test = map.tests.checkout!;
        return {
          ...map,
          tests: {
            ...map.tests,
            checkout: {
              ...test,
              updatedAt: test.updatedAt + 1,
              validation: {
                status: "needs-validation",
                appMapRevision: map.revision,
                testUpdatedAt: test.updatedAt + 1,
              },
            },
          },
          revision: map.revision + 1,
        };
      });
      assert.equal(await projectPersistedAppMapRun(run(saved.revision)), false);
      assert.equal(await projectPersistedAppMapRun(run(edited.revision, "product-failure")), false);
      const current = await readAppMap("project", "map");
      assert.equal(current?.tests.checkout?.validation?.status, "needs-validation");
    } finally {
      if (previous === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);
