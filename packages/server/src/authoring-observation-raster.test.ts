import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Device } from "@relay/core";
import type { AuthoringSession } from "@relay/protocol";
import { captureAuthoringObservation } from "./authoring-observation.js";

// Observe the existing decoder through core's own dependency; the server does
// not gain another image package just to verify its capture lifecycle.
const { PNG } = createRequire(new URL("../../core/package.json", import.meta.url))("pngjs") as {
  PNG: {
    new (options: { width: number; height: number }): {
      width: number;
      height: number;
      data: Buffer;
    };
    sync: {
      read(bytes: Buffer): unknown;
      write(image: { width: number; height: number; data: Buffer }): Buffer;
    };
  };
};
const image = new PNG({ width: 64, height: 96 });
for (let y = 0; y < image.height; y++) {
  for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    const value = x < 22 && y < 30 ? 220 : 18;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
}
const fixture = PNG.sync.write(image);

test("the real iOS observation analyzes each primary and bracket raster once", async () => {
  const read = PNG.sync.read;
  let decodes = 0;
  PNG.sync.read = (bytes) => {
    decodes++;
    return read(bytes);
  };
  let screenshotReads = 0;
  try {
    const captured = await captureAuthoringObservation(
      {
        target: { kind: "device", platform: "ios", targetId: "raster-fixture" },
      } as AuthoringSession,
      {
        resolveDevice: async () => ({}) as Device,
        captureSnapshot: async () => ({
          capturedAt: 20,
          nodes: [{ role: "button", label: "Fixture" }],
          interactive: [],
          inspectable: true,
          source: "sdk",
          screenIdentity: {
            schemaVersion: 1,
            fingerprint: "semantic-fixture",
            nodes: [],
            volatileSignals: [],
          },
        }),
        captureScreenshot: async () => ({
          capturedAt: ++screenshotReads === 1 ? 10 : 30,
          mime: "image/png",
          base64: fixture.toString("base64"),
          path: "",
          bytes: fixture.length,
          width: 64,
          height: 96,
        }),
      },
    );
    assert.equal(screenshotReads, 2);
    assert.equal(decodes, 2, "one PNG decode per captured raster, not per downstream check");
    assert.equal(
      captured.fingerprint,
      "f00f8be9ef7d5e2f92e0933c58ff063b9cb23c149fe0f3d83c560ef7de165c42",
    );
    assert.equal(captured.proof?.pixels.bracket?.status, "coherent");
    assert.equal(captured.proof?.semantics.status, "current");
    assert.deepEqual(captured.screenshot?.data, fixture);
  } finally {
    PNG.sync.read = read;
  }
});
