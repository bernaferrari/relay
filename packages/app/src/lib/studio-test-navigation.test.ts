import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import { resolveStudioTestNavigation } from "./studio-test-navigation";

function appMap(id: string, testIds: string[]): AppMap {
  return {
    id,
    tests: Object.fromEntries(testIds.map((testId) => [testId, { id: testId }])),
    flows: {},
    routines: {},
  } as AppMap;
}

test("Run navigation preserves the exact requested Test instead of choosing by recency", () => {
  const requested = resolveStudioTestNavigation(
    [appMap("settings", ["newest-test", "older-requested-test"])],
    "older-requested-test",
  );

  assert.equal(requested?.appMap.id, "settings");
  assert.equal(requested?.testId, "older-requested-test");
});

test("legacy map navigation remains supported without inventing a Test identity", () => {
  const requested = resolveStudioTestNavigation([appMap("settings", ["test-1"])], "settings");
  assert.equal(requested?.appMap.id, "settings");
  assert.equal(requested?.testId, undefined);
});
