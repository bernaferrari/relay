import assert from "node:assert/strict";
import test from "node:test";
import {
  appLanguages,
  routeMeta,
  routeUrls,
  routeLoadIntent,
  ROUTE_DEFINITIONS,
  createProductFeatures,
  projectError,
} from "./index.js";
import { createScriptedRelayClient } from "@relay/workflows/testing";
test("route registry is exhaustive and exact", () => {
  assert.equal(ROUTE_DEFINITIONS.length, 26);
  assert.equal(routeMeta("/tests/new").id, "/tests/new");
  assert.equal(routeMeta("/tests/t-1").id, "/tests/:testId");
  assert.throws(() => routeMeta("/tests/t-1/extra"));
  for (const definition of ROUTE_DEFINITIONS)
    assert.equal(routeMeta(definition.pattern).id, definition.id);
});
test("route metadata uses public vocabulary", () => {
  const text = JSON.stringify(ROUTE_DEFINITIONS);
  for (const term of ["App Map", "Variable", "Combine", "Lease", "digest", "Campaign"])
    assert.equal(text.includes(term), false);
  assert.equal(routeMeta("/recordings/r-1/review").primaryAction, "review-recording");
  assert.equal(routeMeta("/batches/b-1").primaryAction, "review-batch");
  assert.equal(routeMeta("/settings/about").primaryObject, null);
});
test("builders encode and load intents validate concrete routes", () => {
  assert.equal(routeUrls.test("a/b"), "/tests/a%2Fb");
  assert.throws(() => routeUrls.test(" "));
  assert.equal(
    routeLoadIntent({ pattern: "/tests/:testId", params: { testId: "t-1" } }).route,
    "/tests/t-1",
  );
  assert.deepEqual(routeLoadIntent("/tests/a%2Fb").params, { testId: "a/b" });
  assert.throws(() => routeLoadIntent("/tests/t-1", { status: "running" }));
});
test("Home resolves one honest action from canonical product state", async () => {
  const { resolveHomeAction } = await import("./index.js");
  assert.equal(
    resolveHomeAction({ hasApp: true, hasTests: true, activeRecording: true }),
    "continue-recording",
  );
  assert.equal(
    resolveHomeAction({
      hasApp: true,
      hasTests: true,
      activeRecording: false,
      currentChange: "missing-coverage",
    }),
    "add-missing-test",
  );
  assert.equal(
    resolveHomeAction({ hasApp: true, hasTests: false, activeRecording: false }),
    "record-first-test",
  );
  assert.equal(
    resolveHomeAction({ hasApp: false, hasTests: false, activeRecording: false }),
    "add-app",
  );
});
test("language projection is public and bounded", () => {
  const result = appLanguages({
    variables: {
      v: { kind: "language", id: "v", name: "Language", options: [{ id: "en", label: "English" }] },
    },
  } as never);
  assert.deepEqual(result[0]?.values[0], { id: "en", label: "English", selected: false });
});
test("feature functions use canonical operations", async () => {
  const scripted = createScriptedRelayClient([{ id: "target.list", output: { targets: [] } }]);
  const features = createProductFeatures(scripted.client, { actorId: "actor-1" });
  assert.deepEqual(await features.device.list(), []);
  assert.equal(scripted.invocations[0]?.id, "target.list");
});
test("global Test lookup uses app-map.list", async () => {
  const app = { tests: { wanted: { id: "wanted" } } };
  const scripted = createScriptedRelayClient([{ id: "app-map.list", output: { appMaps: [app] } }]);
  const found = await createProductFeatures(scripted.client, { actorId: "actor-1" }).test.get(
    "wanted",
  );
  assert.equal(found?.id, "wanted");
});
test("errors become human recovery guidance", () => {
  const error = projectError(new Error("offline"));
  assert.equal(error.retryable, true);
  assert.match(error.recovery, /try again/);
});
