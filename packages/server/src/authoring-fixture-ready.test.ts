import assert from "node:assert/strict";
import test from "node:test";
import { fixtureCaptureReadiness } from "./authoring-fixture-ready.js";

test("skip-link-only snapshots are unhydrated", () => {
  assert.equal(fixtureCaptureReadiness(["skip to main content"]), "unhydrated");
  assert.equal(fixtureCaptureReadiness([]), "unhydrated");
});

test("Sign in chrome is signed-out even when Imagine is present", () => {
  assert.equal(
    fixtureCaptureReadiness(["Imagine", "Sign in", "What should we explore?"]),
    "signed-out",
  );
});

test("Library marks a signed-in home", () => {
  assert.equal(
    fixtureCaptureReadiness(["Library", "Private Chat", "BF Bernardo Ferrari"]),
    "ready",
  );
});

test("hydrated signed-in surfaces without Library wait rather than fail", () => {
  assert.equal(fixtureCaptureReadiness(["Settings", "Account", "Appearance"]), "waiting");
});
