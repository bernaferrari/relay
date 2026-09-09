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
    artifacts.map((item) => [item.kind, (item.data as { settled: boolean }).settled]),
    [["visual-settling", true]],
  );
});
