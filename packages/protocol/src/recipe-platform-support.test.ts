import assert from "node:assert/strict";
import test from "node:test";
import { recipeStepPlatformBlocker } from "./recipe-platform-support.js";

test("blocks mobile-data, offline, iOS upload, and browser background at the platform seam", () => {
  assert.match(
    recipeStepPlatformBlocker({ kind: "settings", setting: "mobile-data", state: "off" }, "ios") ??
      "",
    /Android/u,
  );
  assert.equal(
    recipeStepPlatformBlocker(
      { kind: "settings", setting: "mobile-data", state: "off" },
      "android",
    ),
    undefined,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "offline", state: "on" }, "android") ?? "",
    /browser/u,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "upload", file: "tests/fixtures/sample.pdf" }, "ios") ?? "",
    /Files-app/u,
  );
  assert.equal(
    recipeStepPlatformBlocker({ kind: "upload", file: "tests/fixtures/sample.pdf" }, "browser"),
    undefined,
  );
  assert.equal(
    recipeStepPlatformBlocker({ kind: "upload", file: "tests/fixtures/sample.pdf" }, "android"),
    undefined,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "app", action: "background", app: "ai.x.grok" }, "browser") ??
      "",
    /browser/u,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "device", action: "lock" }, "ios") ?? "",
    /not supported by this iOS runner/u,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "device", action: "unlock" }, "browser") ?? "",
    /not supported on browser/u,
  );
  assert.match(
    recipeStepPlatformBlocker({ kind: "settings", setting: "airplane", state: "on" }, "ios") ?? "",
    /Settings handoff/u,
  );
  assert.equal(
    recipeStepPlatformBlocker({ kind: "settings", setting: "airplane", state: "on" }, "android"),
    undefined,
  );
});
