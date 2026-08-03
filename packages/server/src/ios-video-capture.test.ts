import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { iosVideoTakeDirectory, isFinalizedMp4, pruneIosVideoTakes } from "./ios-video-capture.js";

test("recognizes only finalized MP4 evidence", () => {
  assert.equal(isFinalizedMp4(Buffer.from("....ftyp....mdat....moov....")), true);
  assert.equal(isFinalizedMp4(Buffer.from("....ftyp....mdat....")), false);
  assert.equal(isFinalizedMp4(Buffer.from("not a movie")), false);
});

test("stores Apple review takes outside runs and prunes only expired ready evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-ios-takes-"));
  const previousTempRoot = process.env.RELAY_TEMP_ROOT;
  const previousRunsRoot = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_TEMP_ROOT = join(root, "temporary");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  const directory = iosVideoTakeDirectory();
  await mkdir(directory, { recursive: true });

  const expiredId = "ios-take-expired-aaa111";
  const currentId = "ios-take-current-bbb222";
  const recordingId = "ios-take-recording-ccc333";
  const writeTake = async (id: string, state: "recording" | "ready", timestamp: number) => {
    const path = join(directory, `${id}.mp4`);
    await writeFile(path, "video");
    await writeFile(
      join(directory, `${id}.json`),
      JSON.stringify({
        id,
        serial: `${id}-device`,
        path,
        startedAt: timestamp,
        ...(state === "ready" ? { finishedAt: timestamp } : {}),
        state,
      }),
    );
    return path;
  };

  try {
    assert.equal(directory.startsWith(process.env.RELAY_RUNS_DIR), false);
    const expiredPath = await writeTake(expiredId, "ready", 1_000);
    const currentPath = await writeTake(currentId, "ready", 9_500);
    const recordingPath = await writeTake(recordingId, "recording", 1_000);

    assert.equal(await pruneIosVideoTakes({ now: 10_000, maxAgeMs: 1_000 }), 1);
    await assert.rejects(access(expiredPath));
    await assert.rejects(access(join(directory, `${expiredId}.json`)));
    await access(currentPath);
    await access(recordingPath);
  } finally {
    if (previousTempRoot === undefined) delete process.env.RELAY_TEMP_ROOT;
    else process.env.RELAY_TEMP_ROOT = previousTempRoot;
    if (previousRunsRoot === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRunsRoot;
    await rm(root, { recursive: true, force: true });
  }
});
