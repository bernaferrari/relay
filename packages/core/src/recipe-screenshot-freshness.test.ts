import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "./device.js";
import { captureRecipeScreenshot } from "./recipe-runner-screen.js";
import { runWithTargetContext } from "./target-context.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

function frame(text: string): ScreenshotPayload {
  return {
    capturedAt: Date.now(),
    mime: "image/png",
    base64: Buffer.from(text).toString("base64"),
    path: "/tmp/fixture.png",
    bytes: text.length,
  };
}

test("explicit screenshot ignores cached pixels and retains the settled destination", async () => {
  const observation = {
    observedAt: 1,
    nodes: [{ role: "heading", label: "Destination" }],
    screenshot: frame("old"),
  };
  let captures = 0;
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "After tap",
      { runtime: { observation }, artifacts, log: () => {} },
      {
        captureScreenshot: async (options) => {
          assert.equal(options?.ephemeral, true);
          return frame(++captures === 1 ? "transition" : "destination");
        },
      },
    ),
  );
  assert.equal(captures, 3);
  assert.equal(observation.screenshot.base64, frame("destination").base64);
  assert.deepEqual(
    artifacts.map((item) => [
      item.kind,
      (item.data as { settled: boolean; stabilityMeasured?: boolean }).settled,
      (item.data as { stabilityMeasured?: boolean }).stabilityMeasured,
    ]),
    [["visual-settling", true, true]],
  );
});

test("capture-for-review records a pending human-review artifact without a judge", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext({ kind: "device", platform: "android", serial: "fixture" }, () =>
    captureRecipeScreenshot(
      device,
      "Arabic account settings",
      { artifacts, log: () => {} },
      { captureScreenshot: async () => ({ ...frame("arabic"), framePath: "frames/001.png" }) },
      { review: { mode: "later", lookFor: "Save is visible" } },
    ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review");
  assert.ok(review);
  assert.equal((review?.data as { status?: string }).status, "pending");
  assert.equal((review?.data as { caption?: string }).caption, "Arabic account settings");
  assert.equal((review?.data as { lookFor?: string }).lookFor, "Save is visible");
  assert.equal(typeof (review?.data as { imageSha256?: string }).imageSha256, "string");
});

test("capture-for-review records the observed account, viewport, and locale", async () => {
  const device = { command: { wait: async () => ({}) } } as unknown as Device;
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "seeded-member-app" },
    () =>
      captureRecipeScreenshot(
        device,
        "Member · Compact · Arabic",
        {
          artifacts,
          log: () => {},
          job: {
            resolvedInputs: { account: "Member" },
            browserTargetId: "seeded-member-app",
            browserCaseProfile: {
              engine: "chromium",
              locale: "ar",
              viewport: { width: 390, height: 844 },
            },
          } as never,
        },
        { captureScreenshot: async () => ({ ...frame("arabic"), framePath: "frames/001.png" }) },
        { review: { mode: "later", lookFor: "Save is visible" } },
      ),
  );
  const review = artifacts.find((item) => item.kind === "capture-review");
  assert.deepEqual((review?.data as { configuration?: unknown }).configuration, {
    app: "seeded-member-app",
    account: "Member",
    browser: "chromium",
    viewport: "390×844",
    locale: "ar",
  });
});
