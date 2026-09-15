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
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "expect-screen",
      id: "relay-source-settings:warm",
      screenId: "settings",
      screenTitle: "Settings",
      fingerprint: "b".repeat(64),
    }),
    [],
  );
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "module",
      recipeId: "settings-language-checkpoint",
    }),
    ["after"],
  );
  assert.deepEqual(automaticEvidencePhases({ kind: "sleep", ms: 500 }), []);
  assert.deepEqual(automaticEvidencePhases({ kind: "screenshot" }), []);
  assert.deepEqual(
    automaticEvidencePhases({ kind: "app", action: "open", app: "com.example.app" }),
    [],
  );
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "app",
      action: "set-locale",
      app: "com.example.app",
      locale: "it",
    }),
    [],
  );
  assert.deepEqual(automaticEvidencePhases({ kind: "device", action: "keyboard-dismiss" }), []);
  assert.deepEqual(automaticEvidencePhases({ kind: "device", action: "keyboard-enter" }), [
    "after",
  ]);
  assert.deepEqual(
    automaticEvidencePhases({ kind: "wait-for", target: { label: "Ask" }, timeoutMs: 8000 }),
    [],
  );
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "expect-set",
      labels: ["Ask", "Imagine", "Build"],
      extras: "allow",
    }),
    [],
  );
  assert.deepEqual(
    automaticEvidencePhases({
      kind: "expect",
      target: { label: "Copy message" },
      condition: "visible",
    }),
    [],
  );
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

test("a module followed by an explicit screenshot does not duplicate destination capture", () => {
  assert.deepEqual(
    automaticEvidencePhases({ kind: "module", recipeId: "tour" }, { kind: "screenshot" }),
    [],
  );
  assert.deepEqual(automaticEvidencePhases({ kind: "module", recipeId: "tour" }), ["after"]);
});
