import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import type { Device } from "../device/device.js";
import { runWithTargetContext } from "../target/target-context.js";
import { captureScreenshotInMemory } from "./workspace-capture-memory.js";

function pngFixture(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = 200;
    png.data[index + 1] = 100;
    png.data[index + 2] = 50;
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** A device honest about the capture contract: asked for a path it writes one,
 * asked for memory it answers with the raster itself. */
function fixtureDevice(png: Buffer, writes: string[]): Device {
  return {
    capture: {
      screenshot: async (input?: { path?: string }) => {
        if (input?.path) {
          writes.push(input.path);
          await mkdir(dirname(input.path), { recursive: true });
          await writeFile(input.path, png);
          return { path: input.path };
        }
        return { path: "", base64: png.toString("base64") };
      },
    },
  } as unknown as Device;
}

test("in-memory capture returns identical bytes without touching disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-memshot-"));
  const png = pngFixture(640, 480);
  const writes: string[] = [];
  const device = fixtureDevice(png, writes);
  // TMPDIR is read per call, so any temporary file the capture pipeline even
  // tried to create would land inside this test-owned directory.
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    const shot = await runWithTargetContext(
      { kind: "browser", platform: "browser", targetId: "memshot-test" },
      () => captureScreenshotInMemory({ device }),
    );
    assert.equal(
      Buffer.from(shot.base64, "base64").equals(png),
      true,
      "the payload is byte-identical to the raster the target produced",
    );
    assert.equal(shot.width, 640);
    assert.equal(shot.height, 480);
    assert.equal(shot.bytes, png.byteLength);
    assert.equal("path" in shot, false, "an ephemeral frame carries no disk path at all");
    assert.deepEqual(writes, [], "the capture never asked the target for a file");
    assert.deepEqual(
      await readdir(root),
      [],
      "no temporary file or relay capture directory was created",
    );
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
    await rm(root, { recursive: true, force: true });
  }
});

test("in-memory capture fails closed when the target only answers with a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-memshot-"));
  const writes: string[] = [];
  const device = {
    capture: {
      screenshot: async () => ({ path: "" }),
    },
  } as unknown as Device;
  try {
    await assert.rejects(
      runWithTargetContext({ kind: "browser", platform: "browser", targetId: "memshot-test" }, () =>
        captureScreenshotInMemory({ device }),
      ),
      /in-memory pixels/u,
    );
    assert.deepEqual(writes, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
