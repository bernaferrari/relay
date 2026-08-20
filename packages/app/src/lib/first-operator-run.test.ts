import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapCombine, AppMapScenarioTest, AppMapVariable } from "@relay/protocol";
import {
  deriveFirstOperatorRunState,
  parseFirstOperatorRunPreference,
  shouldShowFirstOperatorRun,
} from "./first-operator-run";
import { firstTestTargetStatus } from "./onboarding";

function readyTarget() {
  return firstTestTargetStatus({
    online: true,
    target: { serial: "pixel", name: "Pixel 9", platform: "android", booted: true },
    readiness: { kind: "ready" },
    hasControl: true,
  });
}

function testDoc(): AppMapScenarioTest {
  return {
    id: "settings-tour",
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name: "Settings tour",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function variable(): AppMapVariable {
  return {
    id: "language",
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name: "Language",
    kind: "language",
    apply: { kind: "list" },
    options: [
      { id: "en", label: "English" },
      { id: "it", label: "Italiano" },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
}

function combine(bindings: AppMapCombine["cellRuntimeProfiles"] = []): AppMapCombine {
  return {
    id: "locales",
    organizationId: "local",
    projectId: "default",
    appMapId: "map-1",
    name: "Language × Settings tour",
    variableIds: ["language"],
    testIds: ["settings-tour"],
    selected: { language: ["en", "it"] },
    cellRuntimeProfiles: bindings,
    createdAt: 1,
    updatedAt: 1,
  };
}

function map(
  overrides: Partial<AppMap> = {},
): Pick<AppMap, "id" | "tests" | "variables" | "combines"> {
  return {
    id: "map-1",
    tests: { "settings-tour": testDoc() },
    variables: { language: variable() },
    combines: { locales: combine() },
    ...overrides,
  };
}

test("honest device state blocks bind and run", () => {
  const state = deriveFirstOperatorRunState({
    target: firstTestTargetStatus({
      online: true,
      target: undefined,
      readiness: { kind: "choose-device" },
      hasControl: false,
    }),
    map: map(),
  });
  assert.equal(state.stage, "device");
  assert.equal(state.action, "device");
  assert.match(state.detail, /Select a connected device/u);
});

test("unbound Combine cells ask for an explicit profile without inventing one", () => {
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map(),
  });
  assert.equal(state.stage, "bind");
  assert.equal(state.action, "combine");
  assert.equal(state.combineId, "locales");
  assert.match(state.detail, /no runtime profile/u);
});

test("a bound Combine with no report asks to run one cell", () => {
  const state = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: map({
      combines: {
        locales: combine([
          { testId: "settings-tour", values: { language: "en" }, targetProfileId: "pixel-en" },
          { testId: "settings-tour", values: { language: "it" }, targetProfileId: "pixel-it" },
        ]),
      },
    }),
  });
  assert.equal(state.stage, "run");
  assert.equal(state.action, "combine");
});

test("the operator card stays hidden while first-test is up or the map has no work", () => {
  const bind = deriveFirstOperatorRunState({ target: readyTarget(), map: map() });
  assert.equal(shouldShowFirstOperatorRun({ version: 1 }, bind, true), false);
  const empty = deriveFirstOperatorRunState({
    target: readyTarget(),
    map: { id: "blank", tests: {}, variables: {}, combines: {} },
  });
  assert.equal(empty.hasWork, false);
  assert.equal(shouldShowFirstOperatorRun({ version: 1 }, empty, false), false);
  assert.equal(parseFirstOperatorRunPreference('{"version":1,"dismissedAt":9}').dismissedAt, 9);
});
