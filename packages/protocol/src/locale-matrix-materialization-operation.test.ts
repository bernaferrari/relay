import assert from "node:assert/strict";
import test from "node:test";
import { localeMatrixMaterializationOperationDefinition } from "./locale-matrix-materialization-operation.js";

test("locale materialization operation is a target-free, versioned read contract", () => {
  assert.equal(localeMatrixMaterializationOperationDefinition.transport.method, "POST");
  assert.equal(localeMatrixMaterializationOperationDefinition.lease, "none");
  assert.deepEqual(localeMatrixMaterializationOperationDefinition.targetCapabilities, []);
  assert.equal(localeMatrixMaterializationOperationDefinition.idempotency, "inherent");
  assert.equal(localeMatrixMaterializationOperationDefinition.minimumRole, "viewer");
  assert.doesNotThrow(() =>
    localeMatrixMaterializationOperationDefinition.output.parse({
      schemaVersion: 1,
      materializedAt: 1,
      source: { kind: "recipe", recipeId: "settings" },
      scope: { locales: ["en", "it", "en"], languagePath: [{ kind: "tap" }] },
      cases: [
        { caseIndex: 0, locale: "en" },
        { caseIndex: 1, locale: "it" },
        { caseIndex: 2, locale: "en" },
      ],
      durationCohort: { testId: "settings", action: "settings" },
    }),
  );
  assert.doesNotThrow(() =>
    localeMatrixMaterializationOperationDefinition.input.parse({
      appMapId: "settings-map",
      testId: "settings-smoke",
      variableId: "language",
    }),
  );
  assert.throws(
    () =>
      localeMatrixMaterializationOperationDefinition.input.parse({
        recipe: "settings",
        appMapId: "settings-map",
        testId: "settings-smoke",
        variableId: "language",
      }),
    /exactly one/u,
  );
  assert.doesNotThrow(() =>
    localeMatrixMaterializationOperationDefinition.output.parse({
      schemaVersion: 1,
      materializedAt: 1,
      source: {
        kind: "app-map-test",
        appMapId: "settings-map",
        testId: "settings-smoke",
        variableId: "language",
        appMapRevision: 8,
        recipeId: "app-map:settings-map:test:settings-smoke:root:r8",
      },
      scope: {
        locales: ["en", "it"],
        entryPath: [{ kind: "tap" }],
        exitPath: [{ kind: "back" }],
      },
      cases: [
        { caseIndex: 0, locale: "en" },
        { caseIndex: 1, locale: "it" },
      ],
      durationCohort: {
        testId: "app-map:settings-map:test:settings-smoke:variable:language",
        action: "app-map:settings-map:test:settings-smoke",
      },
    }),
  );
  assert.throws(
    () =>
      localeMatrixMaterializationOperationDefinition.output.parse({
        schemaVersion: 1,
        materializedAt: 1,
        source: { kind: "recipe", recipeId: "settings" },
        scope: { locales: ["en"], languagePath: [] },
        cases: [{ caseIndex: 3, locale: "en" }],
        durationCohort: { testId: "settings", action: "settings" },
      }),
    /contiguous/u,
  );
  assert.throws(
    () =>
      localeMatrixMaterializationOperationDefinition.output.parse({
        schemaVersion: 1,
        materializedAt: 1,
        source: { kind: "recipe", recipeId: "settings" },
        scope: { locales: ["en"], languagePath: [] },
        cases: [{ caseIndex: 0, locale: "en" }],
        durationCohort: { testId: "settings", action: "settings" },
        targetPlatform: "browser",
      }),
    /targetPlatform/u,
  );
});
