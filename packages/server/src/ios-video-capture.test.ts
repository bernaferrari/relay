import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { IosEvidenceCaptureUnavailableError } from "@relay/core";
import {
  iosVideoTakeDirectory,
  iosVideoUnavailableResponse,
  isFinalizedMp4,
  pruneIosVideoTakes,
} from "./ios-video-capture.js";

test("recognizes only finalized MP4 evidence", () => {
  assert.equal(isFinalizedMp4(Buffer.from("....ftyp....mdat....moov....")), true);
  assert.equal(isFinalizedMp4(Buffer.from("....ftyp....mdat....")), false);
  assert.equal(isFinalizedMp4(Buffer.from("not a movie")), false);
});

test("turns a proof-only iOS video failure into a structured Reconnect response", () => {
  const error = new IosEvidenceCaptureUnavailableError({
    operation: "evidence-start",
    stage: "runner-preparation",
    outcome: "unavailable",
    code: "IOS_EVIDENCE_CAPTURE_UNAVAILABLE",
    attempts: 1,
    repairAttempted: false,
    message: "Keep the iPad unlocked, then press Reconnect once.",
    readiness: {
      previewPixels: {
        mode: "pixels",
        state: "proven",
        freshness: "current",
        proof: { at: 1 },
      },
      semanticControl: {
        mode: "accessibility",
        state: "unavailable",
        freshness: "unproven",
        reason: "probe-failed",
      },
      evidenceCapture: {
        mode: "evidence",
        state: "unavailable",
        freshness: "unproven",
        reason: "probe-failed",
      },
    },
    recovery: "Recorded iOS video is unavailable. Press Reconnect once, then start the take again.",
    recoveryAction: {
      operationId: "target.recover",
      input: { serial: "ipad-1", reason: "record" },
      cli: { argv: ["device", "recover", "ipad-1", "--input", '{"reason":"record"}'] },
    },
  });

  const response = iosVideoUnavailableResponse(error);
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "IOS_EVIDENCE_CAPTURE_UNAVAILABLE");
  assert.equal(response.body.readiness.previewPixels.state, "proven");
  assert.equal(response.body.diagnostic.repairAttempted, false);
  assert.deepEqual(response.body.recoveryAction.input, { serial: "ipad-1", reason: "record" });
  assert.equal(iosVideoUnavailableResponse(new Error("ordinary error")), undefined);
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
