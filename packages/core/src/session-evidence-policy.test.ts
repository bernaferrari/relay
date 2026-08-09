import assert from "node:assert/strict";
import test from "node:test";
import { automaticEvidencePhases } from "./session.js";

test("automatic evidence preserves causal frames without duplicating passive steps", () => {
  assert.deepEqual(automaticEvidencePhases({ kind: "tap", target: { text: "Continue" } }), [
    "before",
    "after",
  ]);
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "expect-screen",
      screenId: "home",
      screenTitle: "Home",
      fingerprint: "a".repeat(64),
    }),
    ["after"],
  );
  assert.deepEqual(automaticEvidencePhases({ kind: "sleep", ms: 500 }), []);
  assert.deepEqual(automaticEvidencePhases({ kind: "screenshot" }), []);
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "tour",
      depth: 0,
      screenshot: true,
      excludeLanguageRows: true,
    }),
    [],
  );
});
