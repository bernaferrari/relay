import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { audioFixtureLaunchArguments } from "./browser-audio-fixture.js";
import { importManagedFixture } from "../managed-fixtures.js";

test("microphone fixtures resolve only in their project and require WAV content", async () => {
  const previous = process.env.RELAY_STATE_DIR;
  const root = await mkdtemp(join(tmpdir(), "audio-fixture-"));
  process.env.RELAY_STATE_DIR = root;
  try {
    const wav = join(root, "sample.wav");
    await promisify(execFile)("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=0.1",
      wav,
    ]);
    const fixture = await importManagedFixture("qa", {
      name: "sample.wav",
      base64: (await readFile(wav)).toString("base64"),
    });
    const args = await audioFixtureLaunchArguments(fixture.file, "qa");
    assert.equal(args[0], "--use-fake-device-for-media-stream");
    assert.ok(args[1]?.startsWith("--use-file-for-fake-audio-capture="));
    await assert.rejects(audioFixtureLaunchArguments(fixture.file), /project scope/);
    await assert.rejects(audioFixtureLaunchArguments(fixture.file, "other"));
    const invalid = await importManagedFixture("qa", {
      name: "bad.wav",
      base64: Buffer.from("not really wave").toString("base64"),
    });
    await assert.rejects(audioFixtureLaunchArguments(invalid.file, "qa"), /WAV file/);
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
