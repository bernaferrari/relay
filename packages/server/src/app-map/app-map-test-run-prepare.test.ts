import assert from "node:assert/strict";
import test from "node:test";
import {
  appMapRuntimeTargetProfileFromSaved,
  managedBrowserTargetProfile,
  preflightCompiledAppMapTestOffline,
} from "@relay/core";
import {
  compileBrowserEnvironment,
  type AppMap,
  type AppMapScenarioTest,
  type AppMapScenarioTestStep,
  type TargetDefinition,
  type TargetProfile,
} from "@relay/protocol";
import { prepareAppMapCompanionTestRun } from "./app-map-test-run-prepare.js";
import { HttpError } from "../http.js";

const scope = { appMapId: "browser-map", organizationId: "org", projectId: "project" };
const target = { kind: "browser", platform: "browser", targetId: "shop" } as const;
const browserTarget: TargetDefinition = {
  id: target.targetId,
  name: "Shop browser",
  kind: "browser",
  createdAt: 1,
  updatedAt: 1,
  browser: {
    startUrl: "https://shop.example.com",
    environment: {
      engine: "firefox",
      viewport: { width: 1_024, height: 768 },
      locale: "it-IT",
      timezoneId: "Europe/Rome",
    },
  },
};

function textStep(id: string): AppMapScenarioTestStep {
  return {
    id,
    intent: `${id} in plain English`,
    kind: "instruction",
    binding: { status: "unresolved", reason: "No recording", fromText: true },
  };
}

function textCheck(id: string): AppMapScenarioTestStep {
  return {
    id,
    intent: `${id} is visible`,
    kind: "validation",
    binding: { status: "unresolved", reason: "No recording", fromText: true },
  };
}

function scriptStep(id: string): AppMapScenarioTestStep {
  return {
    id,
    intent: `${id} from a script`,
    kind: "script",
    binding: { status: "resolved", kind: "script", source: 'return "done";' },
  };
}

function testDocument(steps: AppMapScenarioTestStep[]): AppMapScenarioTest {
  return {
    ...scope,
    id: "smoke",
    name: "Smoke",
    kind: "scenario",
    intentSchemaVersion: 1,
    startUrl: "https://shop.example.com",
    createdAt: 1,
    updatedAt: 1,
    steps,
  };
}

function mapWith(
  testDocumentValue: AppMapScenarioTest,
  screenVariants: AppMap["screenVariants"] = {},
): AppMap {
  const variantIds = Object.keys(screenVariants);
  return {
    ...scope,
    id: scope.appMapId,
    schemaVersion: 1,
    name: "Browser map",
    revision: 3,
    notes: {},
    groups: {},
    screens: variantIds.length
      ? {
          home: {
            ...scope,
            id: "home",
            title: "Home",
            createdAt: 1,
            updatedAt: 1,
            identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
            variantIds,
          },
        }
      : {},
    screenVariants,
    connections: {},
    caseStacks: {},
    variables: {},
    tests: { [testDocumentValue.id]: testDocumentValue },
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function savedBrowserVariant(id: string, targetProfile: TargetProfile): AppMap["screenVariants"] {
  return {
    [id]: {
      ...scope,
      id,
      screenId: "home",
      observationId: `observation-${id}`,
      targetProfile,
      observation: { fingerprint: "a".repeat(64), nodes: [], volatileSignals: [] },
      evidenceIds: [],
      evidenceUris: [],
      createdAt: 1,
      updatedAt: 1,
    } as AppMap["screenVariants"][string],
  };
}

function foreignBrowserProfile(): TargetProfile {
  return {
    id: "browser:other",
    targetId: "other",
    source: "browser",
    platform: "browser",
    name: "Other browser",
    viewport: { width: 1_280, height: 800 },
    browserCaseProfile: compileBrowserEnvironment({}),
    capabilities: ["snapshot"],
    observedAt: 1,
  };
}

function prepareInput(fixture: {
  map: AppMap;
  test: AppMapScenarioTest;
  browserTarget?: TargetDefinition;
  targetProfileId?: string;
}) {
  return {
    map: fixture.map,
    test: fixture.test,
    target,
    projectId: scope.projectId,
    compileOptions: {},
    ...(fixture.browserTarget ? { browserTarget: fixture.browserTarget } : {}),
    ...(fixture.targetProfileId ? { targetProfileId: fixture.targetProfileId } : {}),
  };
}

test("a plain-English Test freezes the managed browser environment without any recorded evidence", async () => {
  const document = testDocument([textStep("step-1"), textCheck("step-2")]);
  const prepared = await prepareAppMapCompanionTestRun(
    prepareInput({ map: mapWith(document), test: document, browserTarget }),
  );

  // The compiled profile drops observedAt, so the exact admission instant
  // never participates in the frozen identity.
  const expected = appMapRuntimeTargetProfileFromSaved(
    managedBrowserTargetProfile(browserTarget, 1),
  );
  assert.equal(prepared.runtimeTargetProfile?.id, `browser:${target.targetId}`);
  assert.deepEqual(prepared.runtimeTargetProfile, expected);
  assert.equal(prepared.compiled.plan.runtimeTargetProfile?.id, `browser:${target.targetId}`);
  assert.deepEqual(
    prepared.compiled.plan.runtimeTargetProfile?.browserCaseProfile,
    expected.browserCaseProfile,
  );
  assert.equal(prepared.compiled.plan.runtimeTargetProfile?.browserCaseProfile?.engine, "firefox");
  assert.deepEqual(prepared.compiled.plan.runtimeTargetProfile?.viewport, {
    width: 1_024,
    height: 768,
  });

  const preflight = preflightCompiledAppMapTestOffline(prepared.compiled.plan);
  assert.deepEqual(
    preflight.findings.filter((finding) => finding.severity === "blocker"),
    [],
  );

  // The derived profile is run-scoped: it is never written into the App Map.
  assert.deepEqual(prepared.executionMap.screenVariants, {});
});

test("without a managed browser target no environment is derived", async () => {
  const document = testDocument([textStep("step-1")]);
  const prepared = await prepareAppMapCompanionTestRun(
    prepareInput({ map: mapWith(document), test: document }),
  );
  assert.equal(prepared.runtimeTargetProfile, undefined);
  assert.equal(prepared.compiled.plan.runtimeTargetProfile, undefined);
});

test("a mixed Test still follows recorded evidence inference", async () => {
  const document = testDocument([textStep("step-1"), scriptStep("step-2")]);
  const lenient = await prepareAppMapCompanionTestRun(
    prepareInput({ map: mapWith(document), test: document, browserTarget }),
  );
  assert.equal(lenient.runtimeTargetProfile, undefined);
  assert.equal(lenient.compiled.plan.runtimeTargetProfile, undefined);

  // Foreign evidence governs the mixed Test exactly as before: the managed
  // browser derivation must not rescue it from the target mismatch.
  const foreign = mapWith(
    document,
    savedBrowserVariant("variant-foreign", foreignBrowserProfile()),
  );
  await assert.rejects(
    prepareAppMapCompanionTestRun(prepareInput({ map: foreign, test: document, browserTarget })),
    (error: unknown) =>
      error instanceof HttpError && error.body?.code === "TARGET_PROFILE_TARGET_MISMATCH",
  );
});

test("a disabled text step keeps the Test out of the derivation", async () => {
  const document = testDocument([
    textStep("step-1"),
    {
      ...textStep("step-2"),
      execution: {
        status: "disabled",
        reason: "Not ready",
        repairTargetId: "step-2",
        decidedBy: "author",
        decidedAt: 1,
      },
    },
  ]);
  const prepared = await prepareAppMapCompanionTestRun(
    prepareInput({ map: mapWith(document), test: document, browserTarget }),
  );
  assert.equal(prepared.runtimeTargetProfile, undefined);
  assert.equal(prepared.compiled.plan.runtimeTargetProfile, undefined);
});

test("foreign saved evidence does not block a plain-English Test", async () => {
  const document = testDocument([textStep("step-1")]);
  const map = mapWith(document, savedBrowserVariant("variant-foreign", foreignBrowserProfile()));
  const prepared = await prepareAppMapCompanionTestRun(
    prepareInput({ map, test: document, browserTarget }),
  );
  assert.equal(prepared.runtimeTargetProfile?.id, `browser:${target.targetId}`);
});

test("an explicitly selected profile keeps the authoritative path for a plain-English Test", async () => {
  const document = testDocument([textStep("step-1")]);
  const explicitProfile: TargetProfile = {
    id: "browser:shop-signed-in",
    targetId: target.targetId,
    source: "browser",
    platform: "browser",
    name: "Signed-in shop browser",
    viewport: { width: 1_280, height: 800 },
    browserCaseProfile: {
      ...compileBrowserEnvironment({}),
      authenticationFixtureId: "member",
    },
    capabilities: ["snapshot"],
    observedAt: 1,
  };
  const map = mapWith(document, savedBrowserVariant("variant-explicit", explicitProfile));
  const prepared = await prepareAppMapCompanionTestRun(
    prepareInput({ map, test: document, browserTarget, targetProfileId: explicitProfile.id }),
  );
  assert.equal(prepared.runtimeTargetProfile?.id, explicitProfile.id);
  assert.equal(
    prepared.runtimeTargetProfile?.browserCaseProfile?.authenticationFixtureId,
    "member",
  );
});
