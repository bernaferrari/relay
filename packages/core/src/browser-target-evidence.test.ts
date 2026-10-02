import assert from "node:assert/strict";
import test from "node:test";
import {
  captureBrowserViewportScreenshot,
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

test("capture keeps missing owned pages explicit, including after navigation recovery", async () => {
  for (const navigation of [false, true]) {
    let reads = 0;
    const missing = new Error("No current page for this owned session");
    await assert.rejects(
      captureBrowserViewportScreenshot(async () => {
        reads++;
        if (navigation && reads === 1)
          return {
            async screenshot() {
              throw new Error("Execution context was destroyed");
            },
          } as never;
        throw missing;
      }),
      (error) => error === missing,
    );
    assert.equal(reads, navigation ? 2 : 1);
  }
});

test("interrupted capture never reacquires a page even when the cancellation mentions Target closed", async () => {
  const interruption = new Error("Target closed by cancellation");
  interruption.name = "AbortError";
  let reads = 0;
  await assert.rejects(
    captureBrowserViewportScreenshot(async () => {
      reads++;
      return {
        async screenshot() {
          throw interruption;
        },
      } as never;
    }),
    (error) => error === interruption,
  );
  assert.equal(reads, 1);
});

test("a failed DOM readiness recovery surfaces the error without another capture", async () => {
  const interruption = new Error("Navigation did not reach DOM readiness");
  interruption.name = "TimeoutError";
  let reads = 0,
    captures = 0;
  await assert.rejects(
    captureBrowserViewportScreenshot(async () => {
      reads++;
      return {
        async screenshot() {
          captures++;
          throw new Error("Execution context was destroyed");
        },
        async waitForLoadState(state: string, options: unknown) {
          assert.equal(state, "domcontentloaded");
          assert.deepEqual(options, { timeout: 3000 });
          throw interruption;
        },
      } as never;
    }),
    (error) => error === interruption,
  );
  assert.equal(reads, 2);
  assert.equal(captures, 1);
});

test("simultaneous navigation recovery reacquires only each caller's owned page", async () => {
  const captures = new Map<string, number>(),
    reads = new Map<string, number>();
  const captureOwned = (owner: string) =>
    captureBrowserViewportScreenshot(async () => {
      const read = (reads.get(owner) ?? 0) + 1;
      reads.set(owner, read);
      return {
        async screenshot(options: unknown) {
          captures.set(owner, (captures.get(owner) ?? 0) + 1);
          assert.deepEqual(options, { fullPage: false, timeout: 3000 });
          if (read === 1) throw new Error("Execution context was destroyed during navigation");
          return Buffer.from(`pixels for ${owner}`);
        },
        async waitForLoadState() {
          await Promise.resolve();
        },
      } as never;
    });
  const [member, admin] = await Promise.all([captureOwned("member"), captureOwned("admin")]);
  assert.equal(member.toString(), "pixels for member");
  assert.equal(admin.toString(), "pixels for admin");
  assert.deepEqual([...reads.values()], [2, 2]);
  assert.deepEqual([...captures.values()], [2, 2]);
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
