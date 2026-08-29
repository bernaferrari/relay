import assert from "node:assert/strict";
import test from "node:test";
import {
  compileBrowserEnvironment,
  type AppMap,
  type AppMapScenarioTest,
  type Screen,
  type TargetProfile,
} from "@relay/protocol";
import { compileAppMapTest } from "./map-work.js";
import {
  AppMapTestRouteSelectionError,
  appMapTestViewportClass,
  selectReviewedTestRouteVariant,
} from "./app-map-test-route-variants.js";

const at = 1;
const scope = { organizationId: "org", projectId: "project", appMapId: "map" };

function profile(input: {
  id: string;
  platform: "android" | "browser";
  width: number;
  capabilities?: TargetProfile["capabilities"];
  engine?: "chromium" | "webkit";
}): TargetProfile {
  const browser = input.platform === "browser";
  return {
    id: input.id,
    targetId: browser ? "browser-target" : "pixel",
    source: browser ? "browser" : "device",
    platform: input.platform,
    name: input.id,
    viewport: { width: input.width, height: 800 },
    ...(browser
      ? {
          browserCaseProfile: compileBrowserEnvironment({
            engine: input.engine,
            viewport: { width: input.width, height: 800 },
          }),
        }
      : {}),
    capabilities: input.capabilities ?? ["tap", "screenshot"],
    observedAt: at,
  };
}

function scenario(): AppMapScenarioTest {
  return {
    ...scope,
    id: "open-cart",
    name: "Open cart",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      {
        id: "navigate",
        kind: "instruction",
        intent: "Open the cart",
        binding: { status: "resolved", kind: "connections", connectionIds: ["android-route"] },
      },
    ],
    family: {
      logicalIntentRevision: 3,
      bindingRevision: 5,
      routeVariants: [
        {
          id: "android",
          revision: 2,
          predicate: { platforms: ["android"] },
          bindings: {
            navigate: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["android-route"],
            },
          },
          reviewedAt: at,
          reviewedBy: "reviewer",
        },
        {
          id: "compact-webkit",
          revision: 4,
          predicate: {
            platforms: ["browser"],
            browserEngines: ["webkit"],
            viewportClasses: ["compact"],
            requiredCapabilities: ["tap"],
          },
          bindings: {
            navigate: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["browser-route"],
            },
          },
          reviewedAt: at,
          reviewedBy: "reviewer",
        },
      ],
    },
    createdAt: at,
    updatedAt: at,
  };
}

test("surface classes have stable width boundaries", () => {
  assert.equal(appMapTestViewportClass({ width: 599, height: 800 }), "compact");
  assert.equal(appMapTestViewportClass({ width: 600, height: 800 }), "medium");
  assert.equal(appMapTestViewportClass({ width: 1_023, height: 800 }), "medium");
  assert.equal(appMapTestViewportClass({ width: 1_024, height: 800 }), "expanded");
});

test("selects exactly one whole reviewed route from frozen target facts", () => {
  const selected = selectReviewedTestRouteVariant(
    scenario(),
    profile({ id: "webkit-compact", platform: "browser", width: 390, engine: "webkit" }),
  );
  assert.equal(selected?.id, "compact-webkit");
  assert.deepEqual(selected?.bindings.navigate, {
    status: "resolved",
    kind: "connections",
    connectionIds: ["browser-route"],
  });
});

test("fails closed on absent and overlapping route variants", () => {
  assert.throws(
    () => selectReviewedTestRouteVariant(scenario(), undefined),
    (error: unknown) =>
      error instanceof AppMapTestRouteSelectionError && error.code === "target-surface-required",
  );
  const ambiguous = scenario();
  ambiguous.family!.routeVariants.push({
    ...structuredClone(ambiguous.family!.routeVariants[1]!),
    id: "another-webkit",
  });
  assert.throws(
    () =>
      selectReviewedTestRouteVariant(
        ambiguous,
        profile({ id: "webkit-compact", platform: "browser", width: 390, engine: "webkit" }),
      ),
    (error: unknown) =>
      error instanceof AppMapTestRouteSelectionError && error.code === "route-variant-ambiguous",
  );
});

test("a reviewed variant cannot inherit a concrete route step from another surface", () => {
  const incomplete = scenario();
  incomplete.steps.push({
    id: "authenticate",
    kind: "module",
    intent: "Authenticate",
    binding: { status: "resolved", kind: "routine", routineId: "login" },
  });
  assert.throws(
    () => compileAppMapTest(mapFixture(), incomplete),
    /must implement every route step; missing authenticate/u,
  );
});

function screen(id: string): Screen {
  return {
    ...scope,
    id,
    title: id,
    logicalStateBinding: {
      logicalStateId: `state:${id}`,
      revision: 1,
      reviewedAt: at,
      reviewedBy: "reviewer",
    },
    identity: { schemaVersion: 1, fingerprint: (id === "home" ? "a" : "b").repeat(64) },
    variantIds: id === "home" ? ["android-home", "browser-home"] : [],
    createdAt: at,
    updatedAt: at,
  };
}

function mapFixture(): AppMap {
  const android = profile({ id: "android", platform: "android", width: 1_080 });
  const browser = profile({
    id: "webkit-compact",
    platform: "browser",
    width: 390,
    engine: "webkit",
  });
  const connection = (id: string, intentId: string) => ({
    ...scope,
    id,
    fromScreenId: "home",
    destination: { kind: "screen" as const, screenId: "cart" },
    label: id,
    actionIntentBinding: {
      intentId,
      revision: 2,
      reviewedAt: at,
      reviewedBy: "reviewer",
    },
    state: "ready" as const,
    actions: [{ id: `tap-${id}`, kind: "tap" as const, target: { identifier: id } }],
    createdAt: at,
    updatedAt: at,
  });
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 9,
    notes: {},
    groups: {},
    logicalStates: {
      "state:home": {
        ...scope,
        id: "state:home",
        name: "Home",
        createdAt: at,
        updatedAt: at,
      },
      "state:cart": {
        ...scope,
        id: "state:cart",
        name: "Cart",
        createdAt: at,
        updatedAt: at,
      },
    },
    actionIntents: {
      "intent:open-cart": {
        ...scope,
        id: "intent:open-cart",
        name: "Open cart",
        createdAt: at,
        updatedAt: at,
      },
    },
    screens: { home: screen("home"), cart: screen("cart") },
    screenVariants: {
      "android-home": {
        ...scope,
        id: "android-home",
        screenId: "home",
        targetProfile: android,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
      "browser-home": {
        ...scope,
        id: "browser-home",
        screenId: "home",
        targetProfile: browser,
        evidenceIds: [],
        createdAt: at,
        updatedAt: at,
      },
    },
    connections: {
      "android-route": connection("android-route", "intent:open-cart"),
      "browser-route": connection("browser-route", "intent:open-cart"),
    },
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("compiler applies one route and freezes inspectable family provenance", () => {
  const map = mapFixture();
  const compiled = compileAppMapTest(map, scenario(), {
    runtimeTargetProfile: {
      id: "webkit-compact",
      targetId: "browser-target",
      platform: "browser",
      viewport: { width: 390, height: 800 },
      browserCaseProfile: compileBrowserEnvironment({
        engine: "webkit",
        viewport: { width: 390, height: 800 },
      }),
    },
  });
  assert.equal(compiled.plan.testFamily?.selectedRouteVariant?.id, "compact-webkit");
  assert.equal(compiled.plan.testFamily?.logicalIntentRevision, 3);
  assert.equal(compiled.plan.testFamily?.bindingRevision, 5);
  assert.equal(compiled.plan.testFamily?.targetSurface?.browserEngine, "webkit");
  assert.deepEqual(
    compiled.plan.rawAccessibilityTargetProfiles?.find(({ id }) => id === "webkit-compact")
      ?.browserCaseProfile,
    map.screenVariants["browser-home"]!.targetProfile.browserCaseProfile,
  );
  assert.deepEqual(compiled.plan.testFamily?.actionIntentBindings, [
    {
      connectionId: "browser-route",
      intentId: "intent:open-cart",
      revision: 2,
      reviewedAt: at,
      reviewedBy: "reviewer",
    },
  ]);
  assert.equal(
    compiled.plan.stepProvenance.some((entry) =>
      entry.referencedEntityIds.includes("browser-route"),
    ),
    true,
  );
  assert.equal(
    compiled.plan.stepProvenance.some((entry) =>
      entry.referencedEntityIds.includes("android-route"),
    ),
    false,
  );
});

test("legacy Tests compile as isolated single-surface families", () => {
  const legacy = scenario();
  delete legacy.family;
  const compiled = compileAppMapTest(mapFixture(), legacy);
  assert.deepEqual(compiled.plan.testFamily?.mode, "legacy-single-surface");
  assert.equal(compiled.plan.testFamily?.logicalIntentRevision, 9);
  assert.equal(compiled.plan.testFamily?.selectedRouteVariant, undefined);
});
