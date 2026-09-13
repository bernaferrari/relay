import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppMapScenarioTest } from "@relay/protocol";
import { compileBrowserEnvironment } from "@relay/protocol";
import { createAppMap, mutateStoredAppMap, readAppMap } from "./collaboration.js";
import { resetControlDatabaseCache } from "./collaboration-db.js";
import {
  overlayHonestBrowserTargetProfile,
  planScreenSteps,
  projectPersistedAppMapRun,
} from "./app-map-run-history.js";
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

function validationRun(
  revision: number,
  outcome: PersistedRun["outcome"] = "passed",
): PersistedRun {
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

test("App Map capture joins module frames only to the final destination screen", () => {
  const run = {
    artifacts: [
      {
        kind: "app-map-test-plan",
        data: {
          rootRecipeId: "root",
          recipes: {
            root: {
              steps: [
                {
                  kind: "module",
                  id: "module-a",
                  recipeId: "module-recipe",
                },
                {
                  kind: "module",
                  id: "module-b",
                  recipeId: "module-recipe",
                  check: {
                    transitionDependencies: [
                      { destination: { kind: "screen", screenId: "screen-intermediate" } },
                      { destination: { kind: "screen", screenId: "screen-compiled" } },
                    ],
                  },
                },
              ],
            },
            "module-recipe": {
              steps: [
                { kind: "expect-screen", id: "origin", screenId: "screen-origin" },
                { kind: "expect-screen", id: "destination", screenId: "screen-destination" },
                { kind: "module", id: "cycle", recipeId: "module-recipe" },
              ],
            },
          },
        },
      },
    ],
  } as unknown as PersistedRun;
  assert.deepEqual(planScreenSteps(run), [
    { id: "module-a", screenId: "screen-destination" },
    { id: "module-b", screenId: "screen-compiled" },
  ]);
});

test(
  "promotes localized screen captures to their logical screens without replacing baselines",
  { concurrency: false },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-map-capture-promotion-"));
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
      const saved = await mutateStoredAppMap("project", "map", (map) => ({
        ...map,
        tests: { checkout: testEntity() },
        screens: {
          origin: {
            organizationId: "org",
            projectId: "project",
            appMapId: "map",
            id: "origin",
            title: "Origin",
            identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
            variantIds: [],
            createdAt: 1,
            updatedAt: 1,
          },
          destination: {
            organizationId: "org",
            projectId: "project",
            appMapId: "map",
            id: "destination",
            title: "Destination",
            identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
            variantIds: ["destination-baseline"],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        screenVariants: {
          "destination-baseline": {
            organizationId: "org",
            projectId: "project",
            appMapId: "map",
            id: "destination-baseline",
            screenId: "destination",
            targetProfile: {
              id: "browser:golden",
              targetId: "golden",
              source: "browser",
              platform: "browser",
              name: "Golden",
              capabilities: [],
              observedAt: 1,
            },
            evidenceIds: ["baseline-image"],
            evidenceUris: ["relay-evidence://baseline-image"],
            screenshotUri: "relay-evidence://baseline-image",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        revision: map.revision + 1,
      }));
      await writeFile(join(root, "origin.png"), Buffer.from("origin-image"));
      await writeFile(join(root, "destination.png"), Buffer.from("destination-image"));
      await writeFile(join(root, "origin.json"), JSON.stringify({ nodes: [{ role: "screen" }] }));
      await writeFile(
        join(root, "destination.json"),
        JSON.stringify({ nodes: [{ role: "screen" }] }),
      );
      const run: PersistedRun = {
        ...validationRun(saved.revision),
        id: "run-localized-capture",
        projectId: "project",
        serial: "golden",
        platform: "browser",
        dir: root,
        finishedAt: 20,
        resolvedInputs: { language: "pt-BR" },
        artifacts: [
          {
            kind: "app-map-test-plan",
            capturedAt: 10,
            data: {
              appMapId: "map",
              appMapRevision: saved.revision,
              test: { id: "checkout" },
              rootRecipeId: "root",
              recipes: {
                root: {
                  steps: [
                    {
                      kind: "module",
                      id: "origin-step",
                      recipeId: "origin-module",
                      check: {
                        transitionDependencies: [
                          { destination: { kind: "screen", screenId: "origin" } },
                        ],
                      },
                    },
                    {
                      kind: "module",
                      id: "destination-step",
                      recipeId: "destination-module",
                      check: {
                        transitionDependencies: [
                          { destination: { kind: "screen", screenId: "destination" } },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        steps: [
          {
            ...({} as PersistedRun["steps"][number]),
            id: "origin-step",
            recipeStepId: "origin-step",
            index: 0,
            frames: [{ path: "origin.png", caption: "origin", capturedAt: 11 }],
          },
          {
            ...({} as PersistedRun["steps"][number]),
            id: "destination-step",
            recipeStepId: "destination-step",
            index: 1,
            frames: [{ path: "destination.png", caption: "destination", capturedAt: 12 }],
          },
        ],
      };
      // Model a crash after the validation receipt commit and before capture promotion.
      assert.equal(await projectPersistedAppMapRun({ ...run, steps: [] }), true);
      const receiptMap = await readAppMap("project", "map");
      assert.deepEqual(receiptMap?.activity[`test-validated-${run.id}`]?.subject, {
        kind: "test",
        id: "checkout",
      });
      assert.equal(await projectPersistedAppMapRun(run), true);
      const projected = await readAppMap("project", "map");
      const originVariants = projected!.screens.origin!.variantIds;
      const destinationVariants = projected!.screens.destination!.variantIds;
      assert.equal(originVariants.length, 1);
      assert.equal(destinationVariants.length, 2);
      const origin = projected!.screenVariants[originVariants[0]!]!;
      const destination =
        projected!.screenVariants[
          destinationVariants.find((id) => id !== "destination-baseline")!
        ]!;
      assert.equal(origin.captureProvenance?.locale, "pt-BR");
      assert.equal(destination.captureProvenance?.locale, "pt-BR");
      assert.equal(
        origin.rawAccessibilityTree?.observationId,
        "run-run-localized-capture-origin-11",
      );
      assert.equal(
        destination.rawAccessibilityTree?.observationId,
        "run-run-localized-capture-destination-12",
      );
      assert.notEqual(origin.screenshotUri, destination.screenshotUri);
      assert.equal(
        projected!.screenVariants["destination-baseline"]!.screenshotUri,
        "relay-evidence://baseline-image",
      );
      assert.equal(await projectPersistedAppMapRun(run), false);
      assert.equal((await readAppMap("project", "map"))!.screens.destination!.variantIds.length, 2);
    } finally {
      if (previous === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);

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
      assert.equal(await projectPersistedAppMapRun(validationRun(before)), true);
      const validated = await readAppMap("project", "map");
      assert.equal(validated?.tests.checkout?.validation?.status, "passed");
      assert.equal(Object.values(validated?.activity ?? {}).at(-1)?.eventType, "test.validated");
      const afterFirst = validated?.revision;
      assert.equal(await projectPersistedAppMapRun(validationRun(before)), false);
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
      assert.equal(await projectPersistedAppMapRun(validationRun(saved.revision)), true);
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
      assert.equal(await projectPersistedAppMapRun(validationRun(saved.revision)), false);
      assert.equal(
        await projectPersistedAppMapRun(validationRun(edited.revision, "product-failure")),
        false,
      );
      const current = await readAppMap("project", "map");
      assert.equal(current?.tests.checkout?.validation?.status, "needs-validation");
    } finally {
      if (previous === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previous;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("overlay fixtures do not keep the unsigned browser profile id", () => {
  const unsigned = {
    id: "browser:grok-com",
    targetId: "grok-com",
    source: "browser" as const,
    platform: "browser" as const,
    name: "grok-com",
    capabilities: [] as const,
    observedAt: 1,
    browserCaseProfile: compileBrowserEnvironment({
      engine: "chromium",
      viewport: { width: 1280, height: 800 },
    }),
  };
  assert.equal(overlayHonestBrowserTargetProfile(unsigned).id, "browser:grok-com");
  const overlayed = overlayHonestBrowserTargetProfile({
    ...unsigned,
    browserCaseProfile: compileBrowserEnvironment({
      engine: "chromium",
      viewport: { width: 1280, height: 800 },
      authenticationFixtureId: "authfx:7189423f-193e-45ed-b674-154505cc5107:1",
    }),
  });
  assert.notEqual(overlayed.id, "browser:grok-com");
  assert.match(overlayed.id, /^browser:grok-com-1280x800-[a-f0-9]{12}$/u);
});
