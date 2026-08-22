import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCombine, AppMapScenarioTest, Screen } from "@relay/protocol";
import {
  compileOptionsForVisualSurface,
  impliedForceRecaptureSurfaceScreenIds,
} from "./combine-visual-surface.js";
import { compileAppMapCombine, compileAppMapTest } from "./map-work.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "catalog" };
const digest = "e".repeat(64);

function screen(id: string, fingerprint: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    identity: { schemaVersion: 1, fingerprint: fingerprint.repeat(64) },
    variantIds: id === "long-list" ? ["long-list-en"] : [],
    createdAt: at,
    updatedAt: at,
  };
}

function evidence<T extends "image/png" | "application/json">(id: string, mime: T) {
  return { id, uri: `relay-evidence://${digest}`, sha256: digest, mime, bytes: 10 };
}

/** Bind a destination as full-surface on the Test. Combine visual then surveys it. */
function fullSurfaceBinding(): NonNullable<AppMapScenarioTest["surfaceBindings"]>[number] {
  return {
    screenId: "long-list",
    variantId: "long-list-en",
    captureMode: "full-surface",
    reason: "The destination list is longer than one viewport.",
    surfaceId: "long-list-surface",
    baselineCaptureId: "long-list-baseline",
    compare: "visual-and-semantic",
    repair: "propose-recapture",
  };
}

function longListVariant(): AppMap["screenVariants"][string] {
  return {
    ...scope,
    id: "long-list-en",
    screenId: "long-list",
    targetProfile: {
      id: "phone-en",
      targetId: "phone-1",
      source: "device",
      platform: "android",
      name: "Phone · English",
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: at,
    },
    scrollCapturePolicy: {
      captureMode: "full-surface",
      source: "explicit",
      reason: "The destination list is longer than one viewport.",
      decidedAt: at,
    },
    scrollSurfaces: [
      {
        schemaVersion: 1,
        id: "long-list-surface",
        captureId: "long-list-baseline",
        targetProfileId: "phone-en",
        capturePolicy: {
          captureMode: "full-surface",
          source: "explicit",
          reason: "The destination list is longer than one viewport.",
          decidedAt: at,
        },
        capturedAt: at,
        status: "completed",
        reason: "end-of-content",
        message: "Reached the end of the list.",
        restoredStartViewport: true,
        documentOriginProof: {
          schemaVersion: 1,
          method: "frozen-origin-match",
          firstViewport: { screenshotSha256: digest, accessibilityTreeSha256: digest },
          attestation: { ...evidence("origin-attestation", "application/json") },
          authorization: {
            schemaVersion: 1,
            issuer: "relay-local-capture",
            signature: "s".repeat(43),
          },
        },
        viewports: [
          {
            index: 0,
            offsetY: 0,
            appendedHeight: 0,
            capturedAt: at,
            width: 100,
            height: 200,
            screenshot: { ...evidence("shot", "image/png") },
            accessibilityTree: { ...evidence("tree", "application/json") },
          },
        ],
        composite: { ...evidence("composite", "image/png"), width: 100, height: 200 },
        mergedTree: { ...evidence("merged", "application/json"), nodeCount: 8 },
        manifest: { ...evidence("manifest", "application/json") },
      },
    ],
    evidenceIds: ["shot", "tree", "origin-attestation", "composite", "merged", "manifest"],
    evidenceUris: [`relay-evidence://${digest}`],
    createdAt: at,
    updatedAt: at,
  };
}

function fixture(bindings?: AppMapScenarioTest["surfaceBindings"]): {
  map: AppMap;
  test: AppMapScenarioTest;
  combine: AppMapCombine;
} {
  const work: AppMapScenarioTest = {
    ...scope,
    id: "open-long-list",
    name: "Open long list",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "navigate",
        kind: "instruction",
        intent: "Open the long list",
        binding: { status: "resolved", kind: "connections", connectionIds: ["open-list"] },
      },
    ],
    ...(bindings ? { surfaceBindings: bindings } : {}),
    createdAt: at,
    updatedAt: at,
  };
  const combine: AppMapCombine = {
    ...scope,
    id: "language-x-list",
    name: "Language × Open long list",
    variableIds: ["language"],
    testIds: [work.id],
    selected: { language: ["en"] },
    captures: { [work.id]: { mode: "every-screen" } },
    createdAt: at,
    updatedAt: at,
  };
  const map: AppMap = {
    schemaVersion: 1,
    id: "catalog",
    organizationId: "org",
    projectId: "project",
    name: "Catalog",
    revision: 3,
    notes: {},
    groups: {},
    screens: {
      home: screen("home", "a"),
      "long-list": screen("long-list", "b"),
    },
    screenVariants: { "long-list-en": longListVariant() },
    connections: {
      "open-list": {
        ...scope,
        id: "open-list",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "long-list" },
        label: "Open list",
        state: "ready",
        actions: [{ id: "tap-list", kind: "tap", target: { identifier: "list" } }],
        createdAt: at,
        updatedAt: at,
      },
    },
    caseStacks: {},
    variables: {
      language: {
        ...scope,
        id: "language",
        name: "Language",
        kind: "language",
        apply: { kind: "appLocale", app: "com.example" },
        options: [{ id: "en", label: "English" }],
        createdAt: at,
        updatedAt: at,
      },
    },
    tests: { [work.id]: work },
    combines: { [combine.id]: combine },
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
  return { map, test: work, combine };
}

function captureSurfaceSteps(
  graph: Record<string, { steps: Array<{ kind: string; forceRecapture?: boolean }> }>,
) {
  return Object.values(graph)
    .flatMap((recipe) => recipe.steps)
    .filter((step) => step.kind === "capture-surface");
}

test("visual / every-screen implies recapture only for bound full-surface destinations", () => {
  assert.deepEqual(
    impliedForceRecaptureSurfaceScreenIds({
      surfaceBindings: [fullSurfaceBinding()],
      capture: { mode: "every-screen" },
    }),
    ["long-list"],
  );
  assert.deepEqual(
    impliedForceRecaptureSurfaceScreenIds({
      surfaceBindings: [fullSurfaceBinding()],
      capture: { mode: "final-screen" },
    }),
    [],
  );
  assert.deepEqual(
    compileOptionsForVisualSurface(
      { surfaceBindings: [fullSurfaceBinding()], capture: { mode: "every-screen" } },
      { forceRecaptureSurfaceScreenIds: ["already"] },
    ).forceRecaptureSurfaceScreenIds,
    ["already", "long-list"],
  );
});

test("Combine visual + full-surface binding compiles a recapture survey after arrival", () => {
  const { map, test, combine } = fixture([fullSurfaceBinding()]);
  const compiled = compileAppMapCombine(map, combine);
  const captures = captureSurfaceSteps(compiled.graph);
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.kind, "capture-surface");
  assert.equal(captures[0]?.kind === "capture-surface" && captures[0].forceRecapture, true);
  const destination = Object.values(compiled.graph).find((recipe) =>
    recipe.steps.some((step) => step.kind === "expect-screen" && step.screenId === "long-list"),
  );
  assert.deepEqual(
    destination?.steps
      .filter((step) => step.kind === "screenshot" || step.kind === "capture-surface")
      .map((step) => step.kind),
    ["screenshot", "capture-surface"],
  );

  const withoutCombineLens = compileAppMapTest(map, test);
  assert.equal(
    captureSurfaceSteps(withoutCombineLens.graph).some(
      (step) => step.kind === "capture-surface" && step.forceRecapture,
    ),
    false,
  );
});

test("every-screen without a full-surface binding stays a viewport screenshot", () => {
  const { map, combine } = fixture();
  const compiled = compileAppMapCombine(map, combine);
  assert.deepEqual(captureSurfaceSteps(compiled.graph), []);
  assert.equal(
    Object.values(compiled.graph).some((recipe) =>
      recipe.steps.some(
        (step) => step.kind === "screenshot" && step.caption === "screen:long-list",
      ),
    ),
    true,
  );
});

test("a full-surface binding whose frozen surface is missing fails closed", () => {
  const { map, test } = fixture([fullSurfaceBinding()]);
  delete map.screenVariants["long-list-en"]!.scrollSurfaces;
  assert.throws(
    () => compileAppMapTest(map, { ...test, capture: { mode: "every-screen" } }),
    /binds missing logical surface baseline long-list-baseline/u,
  );
});
