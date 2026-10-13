import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import type { Device } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { analyzeScreenshot } from "./screenshot-analysis.js";
import { resetTargetRuntimeReadiness, targetRuntimeReadiness } from "./target-runtime-readiness.js";
import { captureScreenshot, cleanupScreenshot } from "./workspace-capture.js";

function raster(): Buffer {
  const image = new PNG({ width: 108, height: 234 });
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      const value = y > 30 && y < 190 ? 42 : 0;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

function screenshotDevice(bytes: Buffer): Device {
  return {
    capture: {
      screenshot: async ({ path }: { path: string }) => writeFile(path, bytes),
      snapshot: async () => {
        throw new Error("raster capture must not read accessibility");
      },
    },
  } as unknown as Device;
}

test("core capture decodes unchanged raster bytes once while preserving its public evidence", async () => {
  const bytes = raster();
  const expected = analyzeScreenshot(bytes);
  const originalRead = PNG.sync.read;
  let decodes = 0;
  PNG.sync.read = (...args) => {
    decodes++;
    return originalRead(...args);
  };
  let path: string | undefined;
  try {
    const capture = await runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "single-raster-browser" },
      () => captureScreenshot({ device: screenshotDevice(bytes), ephemeral: true }),
    );
    path = capture.path;
    assert.equal(decodes, 1);
    assert.deepEqual(Buffer.from(capture.base64, "base64"), bytes);
    assert.deepEqual(await readFile(capture.path), bytes);
    assert.equal(capture.screenMatch?.visualFingerprint, expected.visualFingerprint);
    assert.deepEqual({ width: capture.width, height: capture.height }, expected.dimensions);
    assert.deepEqual(capture.proposedRows ?? [], expected.proposedRows ?? []);
    assert.ok(capture.capturedAt <= Date.now());
  } finally {
    PNG.sync.read = originalRead;
    if (path) await cleanupScreenshot(path);
  }
});

test("native viewport proof shares the raw raster analysis without another decode", async () => {
  const bytes = raster();
  const root = await mkdtemp(join(tmpdir(), "relay-raster-capture-"));
  const binary = join(root, "pixels.cjs");
  const previousBinary = process.env.RELAY_GO_IOS_BIN;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  await writeFile(
    binary,
    `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst output = process.argv.find(arg => arg.startsWith('--output='));\nif (!output) process.exit(2);\nfs.writeFileSync(output.slice(9), Buffer.from(${JSON.stringify(bytes.toString("base64"))}, 'base64'));\n`,
  );
  await chmod(binary, 0o700);
  process.env.RELAY_GO_IOS_BIN = binary;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const originalRead = PNG.sync.read;
  let decodes = 0;
  PNG.sync.read = (...args) => {
    decodes++;
    return originalRead(...args);
  };
  let path: string | undefined;
  const serial = "single-raster-ipad";
  try {
    const capture = await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      captureScreenshot({ device: screenshotDevice(bytes), ephemeral: true }),
    );
    path = capture.path;
    assert.equal(decodes, 1);
    assert.deepEqual(Buffer.from(capture.base64, "base64"), bytes);
    const readiness = targetRuntimeReadiness({ serial, platform: "ios" });
    assert.equal(readiness.previewPixels.state, "proven");
    assert.equal(readiness.previewPixels.proof?.at, capture.capturedAt);
    assert.notEqual(readiness.semanticControl.state, "proven");
  } finally {
    PNG.sync.read = originalRead;
    if (previousBinary === undefined) delete process.env.RELAY_GO_IOS_BIN;
    else process.env.RELAY_GO_IOS_BIN = previousBinary;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    if (path) await cleanupScreenshot(path);
    resetTargetRuntimeReadiness();
    await rm(root, { recursive: true, force: true });
  }
});

test("preview annotation receives a fresh analysis of its changed bytes", async () => {
  const bytes = raster();
  const expectedIdentity = analyzeScreenshot(bytes).visualFingerprint;
  const originalRead = PNG.sync.read;
  const decoded: Buffer[] = [];
  PNG.sync.read = (input, ...args) => {
    decoded.push(Buffer.from(input));
    return originalRead(input, ...args);
  };
  let path: string | undefined;
  try {
    const capture = await runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "annotated-raster-browser" },
      () =>
        captureScreenshot({
          device: screenshotDevice(bytes),
          ephemeral: true,
          previewTap: { x: 54, y: 190 },
        }),
    );
    path = capture.path;
    const annotated = Buffer.from(capture.base64, "base64");
    assert.notDeepEqual(annotated, bytes);
    assert.equal(decoded.filter((input) => input.equals(bytes)).length, 2);
    assert.equal(decoded.filter((input) => input.equals(annotated)).length, 1);
    assert.equal(capture.screenMatch?.visualFingerprint, expectedIdentity);
    assert.deepEqual(capture.proposedRows ?? [], analyzeScreenshot(annotated).proposedRows ?? []);
    assert.deepEqual(await readFile(capture.path), annotated);
  } finally {
    PNG.sync.read = originalRead;
    if (path) await cleanupScreenshot(path);
  }
});
