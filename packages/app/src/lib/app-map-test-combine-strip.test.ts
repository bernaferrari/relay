import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapVariable } from "@relay/protocol";
import {
  applyableVariables,
  projectTestCombineStrip,
  testCombineCaptureForLens,
  testCombineLensFromPolicy,
  testCombineSentence,
  variableCanApply,
} from "./app-map-test-combine-strip";

function language(apply: AppMapVariable["apply"], options = ["en", "ja", "pt"]): AppMapVariable {
  return {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Language",
    kind: "language",
    apply,
    options: options.map((id) => ({ id, label: id.toUpperCase() })),
    createdAt: 1,
    updatedAt: 1,
  };
}

test("only Variables that can apply and undo appear on the Test strip", () => {
  const ready = language({
    kind: "list",
    entryPath: [{ kind: "tap", target: { label: "Open" } }],
    exitPath: [{ kind: "back" }],
  });
  const locale = language({ kind: "appLocale", app: "com.example" });
  locale.id = "app-locale";
  const broken = language({ kind: "list" });
  broken.id = "broken";
  assert.equal(variableCanApply(ready), true);
  assert.deepEqual(
    applyableVariables([ready, locale, broken]).map((item) => item.id),
    ["language", "app-locale"],
  );
});

test("Visual and Smoke map onto existing capture policies", () => {
  assert.deepEqual(testCombineCaptureForLens("visual"), { mode: "every-screen" });
  assert.deepEqual(testCombineCaptureForLens("smoke"), { mode: "failures-only" });
  assert.equal(testCombineLensFromPolicy("every-screen"), "visual");
  assert.equal(testCombineLensFromPolicy("failures-only"), "smoke");
});

test("the strip projects selected worlds as rows of this Test", () => {
  const variable = language({ kind: "appLocale", app: "com.example" });
  const strip = projectTestCombineStrip({
    test: { id: "settings-tour", name: "Settings tour" },
    variables: [variable],
    selected: { language: ["ja", "pt"] },
  });
  assert.equal(strip.worlds.length, 2);
  assert.equal(strip.cells.length, 2);
  assert.deepEqual(
    strip.cells.map((cell) => cell.values.language),
    ["ja", "pt"],
  );
  assert.equal(strip.column.id, "settings-tour");
  assert.equal(strip.combineId, "matrix-language-to-settings-tour");
  assert.match(
    testCombineSentence({
      testName: "Settings tour",
      worlds: strip.worlds,
      lens: "visual",
    }),
    /Run Settings tour in JA and PT as a visual/u,
  );
});
