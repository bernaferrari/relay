import assert from "node:assert/strict";
import test from "node:test";
import {
  isBrowserExecutionContextDestroyed,
  snapshotBrowserPage,
} from "./browser-target-evidence.js";

test("navigation-destroyed Playwright worlds are retried on the next document", async () => {
  assert.equal(
    isBrowserExecutionContextDestroyed(
      new Error(
        "locator.evaluateAll: Execution context was destroyed, most likely because of a navigation",
      ),
    ),
    true,
  );
  assert.equal(isBrowserExecutionContextDestroyed(new Error("No match for Sign up")), false);

  let attempts = 0;
  const page = {
    waitForLoadState: async () => undefined,
    locator: () => ({
      evaluateAll: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            "locator.evaluateAll: Execution context was destroyed, most likely because of a navigation",
          );
        }
        return [{ role: "h1", label: "Create your account" }];
      },
    }),
  };
  const nodes = await snapshotBrowserPage(page as never);
  assert.equal(attempts, 2);
  assert.equal(nodes[0]?.label, "Create your account");
});
