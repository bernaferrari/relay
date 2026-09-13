import assert from "node:assert/strict";
import test from "node:test";
import {
  GROK_WEB_COVERAGE_GAPS,
  GROK_WEB_SMOKE_CATALOG,
  truthfulGrokWebSmokeName,
} from "./grok-web-smoke-catalog.js";

test("narrowed grok-web smokes are named for what they inspect, with coverage gaps retained", () => {
  assert.equal(truthfulGrokWebSmokeName("test-grok-web-signed-in-hide-upsell"), "Inspect upsell");
  assert.equal(
    truthfulGrokWebSmokeName("test-grok-web-signed-in-model-iterate"),
    "Inspect model choices",
  );
  assert.equal(truthfulGrokWebSmokeName("test-grok-web-signed-in-settings"), "Open settings panel");
  assert.deepEqual(
    GROK_WEB_SMOKE_CATALOG.map((item) => item.id),
    [
      "test-grok-web-signed-in-hide-upsell",
      "test-grok-web-signed-in-model-iterate",
      "test-grok-web-signed-in-settings",
    ],
  );
  assert.deepEqual(
    [...GROK_WEB_COVERAGE_GAPS],
    ["Switch models", "Dismiss upsell", "Persist setting"],
  );
});
