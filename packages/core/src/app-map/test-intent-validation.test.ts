import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapScenarioTest } from "@relay/protocol";
import { assertScenarioTest } from "./test-intent-validation.js";

const at = 1;

function scenario(steps: AppMapScenarioTest["steps"]): AppMapScenarioTest {
  return {
    id: "checkout",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    createdAt: at,
    updatedAt: at,
    name: "Checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps,
  };
}

function textStep(cache?: unknown): AppMapScenarioTest["steps"][number] {
  return {
    id: "open",
    kind: "instruction",
    intent: "Open the cart",
    binding: {
      status: "unresolved",
      reason: "Runs from its words",
      fromText: true,
      ...(cache ? { cache } : {}),
    },
  } as AppMapScenarioTest["steps"][number];
}

const legacyCache = {
  steps: [{ kind: "tap", target: { label: "Cart" } }],
  runId: "run-1",
  savedAt: 10,
};

function v2Cache(steps: unknown[] = [{ kind: "tap", target: { label: "Cart" } }]) {
  return {
    schemaVersion: 2,
    steps,
    runId: "run-1",
    savedAt: 10,
    targetKind: "browser",
    resolution: [{ strategy: "label", key: "Cart" }],
    verification: { runOutcome: "passed" },
  };
}

test("legacy and v2 cache entries both validate as document data", () => {
  assertScenarioTest(scenario([textStep(legacyCache)]), "test");
  assertScenarioTest(scenario([textStep(v2Cache())]), "test");
  assertScenarioTest(
    scenario([
      textStep({
        ...v2Cache(),
        viewport: { width: 1280, height: 800 },
        healedFrom: { runId: "run-0", savedAt: 5, reason: "the saved path no longer matched" },
        hits: 3,
        lastHitAt: 99,
      }),
    ]),
    "test",
  );
});

test("crafted caches cannot smuggle uncacheable kinds, including a nested act", () => {
  for (const bad of [
    { kind: "script", source: "return 1" },
    { kind: "act", intent: "nested" },
    { kind: "module", recipeId: "x" },
    { kind: "evaluate-visual", criteria: ["x"] },
    { kind: "expect", target: { label: "x" }, condition: "visible" },
    { kind: "device", action: "lock" },
    { kind: "repeat", count: 2, recipeId: "x" },
    { kind: "app", action: "open", url: "https://x.example" },
  ]) {
    assert.throws(
      () => assertScenarioTest(scenario([textStep(v2Cache([bad]))]), "test"),
      /not cacheable/,
      `${bad.kind} must be rejected`,
    );
    // The allowlist is enforced on legacy entries too: they round-trip through
    // the same user-editable document.
    assert.throws(
      () => assertScenarioTest(scenario([textStep({ ...legacyCache, steps: [bad] })]), "test"),
      /not cacheable/,
      `${bad.kind} must be rejected in legacy entries`,
    );
  }
});

test("the keyboard-enter device subset and the act loop's kinds validate", () => {
  assertScenarioTest(
    scenario([
      textStep(
        v2Cache([
          { kind: "tap", target: { label: "Cart" } },
          { kind: "type", text: "shoes", mode: "replace", target: { identifier: "search" } },
          { kind: "scroll", direction: "down" },
          { kind: "key", key: "back" },
          { kind: "sleep", ms: 500 },
          { kind: "device", action: "keyboard-enter" },
        ]),
      ),
    ]),
    "test",
  );
});

test("malformed cache steps and shapes are rejected", () => {
  assert.throws(
    () =>
      assertScenarioTest(
        scenario([textStep({ ...legacyCache, steps: [{ kind: "tap" }] })]),
        "test",
      ),
    /invalid/,
  );
  assert.throws(
    () => assertScenarioTest(scenario([textStep({ ...legacyCache, steps: [] })]), "test"),
    /at most 40 actions/,
  );
  assert.throws(
    () =>
      assertScenarioTest(
        scenario([textStep({ ...v2Cache(), resolution: [{ strategy: "point", key: "1,2" }] })]),
        "test",
      ),
    /strategy is unsupported/,
  );
  assert.throws(
    () =>
      assertScenarioTest(
        scenario([textStep({ ...v2Cache(), verification: { runOutcome: "failed" } })]),
        "test",
      ),
    /runOutcome must be passed/,
  );
  assert.throws(
    () => assertScenarioTest(scenario([textStep({ ...v2Cache(), schemaVersion: 3 })]), "test"),
    /schemaVersion is unsupported/,
  );
  assert.throws(
    () => assertScenarioTest(scenario([textStep({ ...v2Cache(), junk: true })]), "test"),
    /unknown field/,
  );
});
