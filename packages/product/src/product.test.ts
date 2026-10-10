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
import { ApiError } from "@relay/client";
import { createScriptedRelayClient } from "@relay/workflows/testing";
test("route registry is exhaustive and exact", () => {
  assert.equal(ROUTE_DEFINITIONS.length, 23);
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
  assert.equal(routeMeta("/recordings/r-1").primaryAction, "continue-recording");
  assert.equal(routeMeta("/batches/b-1").primaryAction, "review-batch");
  assert.equal(routeMeta("/settings/about").primaryObject, null);
});
test("builders encode and load intents validate concrete routes", () => {
  assert.equal(routeUrls.test("a/b"), "/tests/a%2Fb");
  assert.equal(routeUrls.recording("a/b"), "/recordings/a%2Fb");
  assert.equal(routeUrls.suite("app one", "smoke/all"), "/apps/app%20one/suites/smoke%2Fall");
  assert.equal(routeUrls.environment("chrome/staging"), "/environments/chrome%2Fstaging");
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
test("global test lookup uses app-map.list", async () => {
  const app = { tests: { wanted: { id: "wanted" } } };
  const scripted = createScriptedRelayClient([{ id: "app-map.list", output: { appMaps: [app] } }]);
  const found = await createProductFeatures(scripted.client, { actorId: "actor-1" }).test.get(
    "wanted",
  );
  assert.equal(found?.id, "wanted");
});
test("global test lookup fails closed when an identity belongs to multiple apps", async () => {
  const test = { id: "duplicate" };
  const scripted = createScriptedRelayClient([
    {
      id: "app-map.list",
      output: {
        appMaps: [
          { id: "app-one", tests: { duplicate: test } },
          { id: "app-two", tests: { duplicate: test } },
        ],
      },
    },
  ]);

  await assert.rejects(
    () => createProductFeatures(scripted.client, { actorId: "actor-1" }).test.get("duplicate"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "product-test-identity-ambiguous");
      assert.deepEqual((error as { appMapIds?: string[] }).appMapIds, ["app-one", "app-two"]);
      return true;
    },
  );
});
test("errors become human recovery guidance", () => {
  const error = projectError(new Error("offline"));
  assert.equal(error.title, "Relay is not connected");
  assert.equal(error.retryable, true);
  assert.doesNotMatch(error.detail, /offline/);
  assert.match(error.recovery, /Start Relay/);
});
test("browser transport failures become an actionable local-service error", () => {
  for (const failure of [
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new Error("net::ERR_CONNECTION_REFUSED"),
    new Error("Cross-Origin Request Blocked by CORS policy"),
  ]) {
    const error = projectError(failure);
    assert.equal(error.title, "Relay is not connected");
    assert.equal(error.retryable, true);
    assert.match(error.detail, /local Relay service/);
    assert.match(error.recovery, /try again/);
  }
});
test("temporary gateway failures offer retry guidance", () => {
  for (const status of [502, 503, 504]) {
    const error = projectError(new ApiError(status, "gateway failure", {}));
    assert.equal(error.title, "Relay is temporarily unavailable");
    assert.equal(error.retryable, true);
    assert.match(error.detail, /Try again/);
    assert.doesNotMatch(error.detail, /HTTP/);
  }
});
test("projectError preserves structured server WorkflowProblem semantics", () => {
  const error = projectError(
    new ApiError(409, "opaque transport text", {
      error: {
        code: "stale-workflow-version",
        title: "This change is out of date",
        detail: "Inspect the latest change before acting again.",
        recovery: "Open the change and review its current state.",
        retryable: false,
      },
    }),
  );
  assert.equal(error.title, "This change is out of date");
  assert.equal(error.retryable, false);
  assert.doesNotMatch(error.detail, /opaque transport text/);
});
