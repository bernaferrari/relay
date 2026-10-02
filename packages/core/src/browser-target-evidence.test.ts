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

test("viewport capture bounds a navigation-stalled screenshot and reads once from the fresh page", async () => {
  const { captureBrowserViewportScreenshot } = await import("./browser-target-evidence.js");
  const calls: unknown[] = [];
  const pixels = Buffer.from("fresh pixels");
  let reads = 0;
  const oldPage = {
    screenshot: async (options: unknown) => {
      calls.push(options);
      const error = new Error("page.screenshot: Timeout 30000ms exceeded.");
      error.name = "TimeoutError";
      throw error;
    },
  };
  const newPage = {
    screenshot: async (options: unknown) => {
      calls.push(options);
      return pixels;
    },
    waitForLoadState: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
  const result = await captureBrowserViewportScreenshot(
    async () => (++reads === 1 ? oldPage : newPage) as never,
    "frame.png",
  );
  assert.equal(result, pixels);
  assert.equal(reads, 2);
  assert.deepEqual(calls, [
    { path: "frame.png", fullPage: false, timeout: 3000 },
    ["domcontentloaded", { timeout: 3000 }],
    { path: "frame.png", fullPage: false, timeout: 3000 },
  ]);
});

test("viewport capture surfaces a repeated timeout and never retries a permission error", async () => {
  const { captureBrowserViewportScreenshot } = await import("./browser-target-evidence.js");
  for (const name of ["TimeoutError", "PermissionError"]) {
    let reads = 0;
    const error = new Error(
      name === "TimeoutError" ? "page.screenshot: Timeout exceeded" : "Permission denied",
    );
    error.name = name;
    const page = {
      screenshot: async () => {
        throw error;
      },
      waitForLoadState: async () => undefined,
    };
    await assert.rejects(
      captureBrowserViewportScreenshot(async () => {
        reads++;
        return page as never;
      }),
      (caught) => caught === error,
    );
    assert.equal(reads, name === "TimeoutError" ? 2 : 1);
  }
});
