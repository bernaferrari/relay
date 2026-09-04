import test from "node:test";
import assert from "node:assert/strict";
import { desktopRendererBuildConfigs } from "./renderer-build.mjs";

test("desktop builds only the Product V2 renderer by default", () => {
  assert.deepEqual(desktopRendererBuildConfigs({}), ["vite.v2.config.ts"]);
});

test("legacy desktop renderer builds only with an explicit rollback flag", () => {
  assert.deepEqual(desktopRendererBuildConfigs({ RELAY_BUILD_LEGACY: "1" }), [
    "vite.v2.config.ts",
    "vite.config.ts",
  ]);
  assert.deepEqual(desktopRendererBuildConfigs({ RELAY_BUILD_LEGACY: "0" }), ["vite.v2.config.ts"]);
});
