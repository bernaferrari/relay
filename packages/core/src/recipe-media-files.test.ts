import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";
import { currentRunMediaFile } from "./recipe-media-files.js";
import { inspectMedia, runMediaCheckStep } from "./media-check.js";

function context(runDir: string, path: string): RecipeStepContext {
  return {
    log() {},
    job: {
      projectId: "qa",
      runDir,
      artifacts: [{ kind: "download", capturedAt: 1, data: { file: "result.mp4", path } }],
    } as TestJob,
  };
}

test("media checks resolve generated aliases under external Run roots, without borrowing another Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-run-media-"));
  try {
    const firstRoot = join(root, "first");
    const secondRoot = join(root, "second");
    for (const runRoot of [firstRoot, secondRoot])
      await mkdir(join(runRoot, "artifacts"), { recursive: true });
    const firstFile = join(firstRoot, "artifacts", "result.mp4");
    const secondFile = join(secondRoot, "artifacts", "result.mp4");
    const execute = promisify(execFile);
    for (const [file, size] of [
      [firstFile, "128x72"],
      [secondFile, "256x144"],
    ]) {
      await execute("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=red:s=${size}:d=0.2`,
        "-y",
        file!,
      ]);
    }
    const first = context(firstRoot, "artifacts/result.mp4");
    const second = context(secondRoot, "artifacts/result.mp4");
    assert.equal(await currentRunMediaFile("result.mp4", first), await realpath(firstFile));
    assert.equal(await currentRunMediaFile("result.mp4", second), await realpath(secondFile));
    await runMediaCheckStep(
      { kind: "media-check", file: "result.mp4", media: "video", width: 128, height: 72 },
      first,
    );
    await assert.rejects(
      runMediaCheckStep(
        { kind: "media-check", file: "result.mp4", media: "video", width: 128 },
        second,
      ),
      /expected width 128, saw 256/,
    );
    // An external Run root is trusted only when passed by the Run-owning caller.
    await assert.rejects(inspectMedia(firstFile, "qa"), /inside the workspace/);
    assert.equal((await inspectMedia(firstFile, "qa", firstRoot)).width, 128);
    assert.equal(await currentRunMediaFile("missing.mp4", first), undefined);
    assert.equal(await currentRunMediaFile("result.mp4", { log() {} }), undefined);
    await assert.rejects(
      currentRunMediaFile("result.mp4", context(secondRoot, firstFile)),
      /outside its current Run/,
    );
    const link = join(secondRoot, "artifacts", "foreign.mp4");
    await symlink(firstFile, link);
    await assert.rejects(
      currentRunMediaFile("result.mp4", context(secondRoot, "artifacts/foreign.mp4")),
      /outside its current Run/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
