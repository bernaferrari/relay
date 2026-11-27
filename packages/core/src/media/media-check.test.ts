import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertMediaFacts, inspectMedia } from "./media-check.js";
import { validateRecipeSteps } from "../recipe/recipes.js";

const execute = promisify(execFile);
const facts = {
  sha256: "output",
  decodedSha256: "decoded-output",
  bytes: 400,
  width: 1280,
  height: 720,
  durationMs: 2000,
  hasVideo: true,
  hasAudio: false,
  isImage: false,
};
test("media assertions reject wrong dimensions, short output, unchanged source and invalid lineage", () => {
  assert.throws(
    () => assertMediaFacts({ kind: "media-check", file: "x", media: "video", height: 1080 }, facts),
    /expected height/,
  );
  assert.throws(
    () => assertMediaFacts({ kind: "media-check", file: "x", media: "audio" }, facts),
    /no audio/,
  );
  assert.throws(
    () =>
      assertMediaFacts(
        { kind: "media-check", file: "x", media: "video", minDurationMs: 3000 },
        facts,
      ),
    /too short/,
  );
  assert.throws(
    () =>
      assertMediaFacts(
        { kind: "media-check", file: "x", media: "video", sourceFile: "s" },
        facts,
        facts,
      ),
    /identical/,
  );
  assert.throws(
    () =>
      assertMediaFacts(
        { kind: "media-check", file: "x", media: "video", sourceFile: "s", relation: "extended" },
        facts,
        { ...facts, sha256: "source", decodedSha256: "decoded-source" },
      ),
    /did not increase/,
  );
  assert.throws(
    () =>
      assertMediaFacts(
        { kind: "media-check", file: "x", media: "video", sourceFile: "s", relation: "edited" },
        facts,
        { ...facts, sha256: "different-container" },
      ),
    /identical/,
  );
  assertMediaFacts(
    { kind: "media-check", file: "x", media: "video", sourceFile: "s", relation: "upscaled" },
    facts,
    { ...facts, sha256: "source", decodedSha256: "decoded-source", width: 854, height: 480 },
  );
});
test("media step parser validates numeric checks and source relation", () => {
  assert.throws(
    () => validateRecipeSteps([{ kind: "media-check", file: "x", media: "video", height: -1 }]),
    /positive integer/,
  );
  assert.throws(
    () =>
      validateRecipeSteps([
        { kind: "media-check", file: "x", media: "video", relation: "extended" },
      ]),
    /requires sourceFile/,
  );
  assert.equal(
    validateRecipeSteps([{ kind: "media-check", file: "x", media: "video", height: 720 }])[0]?.kind,
    "media-check",
  );
});
test("inspectMedia decodes real files and rejects corrupt artifacts", async () => {
  await mkdir(".tmp", { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), ".tmp/media-check-"));
  try {
    const file = join(dir, "clip.mp4");
    await execute("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=128x72:d=0.2",
      "-y",
      file,
    ]);
    const result = await inspectMedia(file);
    assert.equal(result.width, 128);
    assert.equal(result.height, 72);
    assert.ok(result.durationMs && result.durationMs >= 200);
    assert.equal(result.sha256.length, 64);
    assert.equal(result.isImage, false);
    assert.throws(
      () => assertMediaFacts({ kind: "media-check", file, media: "image" }, result),
      /expected an image/,
    );
    const image = join(dir, "still.png");
    await execute("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-frames:v", "1", image]);
    const imageFacts = await inspectMedia(image);
    assert.equal(imageFacts.isImage, true);
    assertMediaFacts({ kind: "media-check", file: image, media: "image", width: 128 }, imageFacts);
    assert.throws(
      () => assertMediaFacts({ kind: "media-check", file: image, media: "video" }, imageFacts),
      /expected a video/,
    );

    const bad = join(dir, "bad.mp4");
    await writeFile(bad, "not media");
    await assert.rejects(inspectMedia(bad), /could not be decoded/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
