import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapVariable } from "@relay/protocol";
import { localeMatrixScopeFromAppMapLanguageVariable } from "./app-map-locale-matrix.js";

const scope = { organizationId: "org", projectId: "project", appMapId: "map" };

function variable(overrides: Partial<AppMapVariable> = {}): AppMapVariable {
  return {
    ...scope,
    id: "language",
    name: "Language",
    kind: "language",
    apply: {
      kind: "list",
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
    },
    options: [
      { id: "en", identifier: "locale.en", label: "English" },
      { id: "it", identifier: "locale.it", label: "Italiano" },
    ],
    restoreId: "en",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function map(language = variable()): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "Map",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: { [language.id]: language },
    tests: {},
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

test("App Map language Variable scope preserves saved picker entry and Test return", () => {
  const result = localeMatrixScopeFromAppMapLanguageVariable({
    map: map(),
    variableId: "language",
    locales: ["it"],
  });
  assert.deepEqual(result, {
    scope: {
      locales: ["it"],
      entryPath: [{ kind: "tap", target: { identifier: "settings.language" } }],
      exitPath: [{ kind: "back" }],
      languageOptions: {
        en: { identifier: "locale.en" },
        it: { identifier: "locale.it" },
      },
      restoreLocale: "en",
      restoreAtEnd: true,
      screenshotEachLocale: true,
    },
  });
});

test("Android appLocale Variables need no picker route and are target-constrained", () => {
  const result = localeMatrixScopeFromAppMapLanguageVariable({
    map: map(
      variable({
        apply: { kind: "appLocale", app: "com.example.app" },
      }),
    ),
    variableId: "language",
  });
  assert.deepEqual(result, {
    scope: {
      locales: ["en", "it"],
      app: "com.example.app",
      appLocale: "com.example.app",
      restoreLocale: "en",
      restoreAtEnd: true,
      screenshotEachLocale: true,
    },
    targetPlatform: "android",
  });
});

test("a list Variable without a saved return is not a compatible Test locale source", () => {
  assert.throws(
    () =>
      localeMatrixScopeFromAppMapLanguageVariable({
        map: map(
          variable({
            apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Language" } }] },
          }),
        ),
        variableId: "language",
      }),
    /returns to the Test/u,
  );
});
