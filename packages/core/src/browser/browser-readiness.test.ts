import assert from "node:assert/strict";
import test from "node:test";
import { browserContentLooksHydrated } from "./browser-readiness.js";

test("skip-link shells are not treated as hydrated browser content", () => {
  assert.equal(browserContentLooksHydrated(""), false);
  assert.equal(browserContentLooksHydrated("Skip to main content"), false);
  assert.equal(browserContentLooksHydrated("Skip to content\n\n"), false);
  assert.equal(
    browserContentLooksHydrated(
      "What should we explore?\nAsk Grok anything\nSign in\nSign up\nImagine",
    ),
    true,
  );
});

test("short rendered pages are valid without an arbitrary copy length requirement", () => {
  assert.equal(browserContentLooksHydrated("Sign in"), true);
  assert.equal(browserContentLooksHydrated("fixture"), true);
  assert.equal(browserContentLooksHydrated("Skip to content\nSettings"), true);
  assert.equal(browserContentLooksHydrated("Loading…"), false);
  assert.equal(browserContentLooksHydrated("Skip to main content\nPlease wait..."), false);
});
