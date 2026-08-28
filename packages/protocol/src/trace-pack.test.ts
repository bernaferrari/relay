import assert from "node:assert/strict";
import test from "node:test";
import { parseTracePack, tracePackExportResponseSchema } from "./trace-pack.js";

const hash = `sha256:${"a".repeat(64)}`;

function fixture() {
  return {
    schemaVersion: 1 as const,
    kind: "relay-trace-pack" as const,
    digest: hash,
    createdAt: 1,
    source: {
      runId: "run-1",
      runSchemaVersion: 5,
      status: "ok",
      action: "app-map:map:test",
      inputDigest: "b".repeat(64),
      writtenAt: 1,
    },
    redaction: { status: "applied-at-persistence" as const, redactedChannels: [] },
    completeness: { status: "complete" as const, channels: {}, missing: [] },
    objects: [
      {
        path: "run.json",
        kind: "frozen-run" as const,
        mediaType: "application/json",
        encoding: "json" as const,
        digest: hash,
        bytes: 2,
        content: {},
      },
    ],
  };
}

test("TracePack schema is strict and requires a content-addressed frozen run", () => {
  assert.equal(parseTracePack(fixture()).source.runId, "run-1");
  assert.throws(() => parseTracePack({ ...fixture(), extra: true }));
  assert.throws(() =>
    parseTracePack({
      ...fixture(),
      objects: [{ ...fixture().objects[0], encoding: "base64", content: {} }],
    }),
  );
  assert.throws(() => parseTracePack({ ...fixture(), digest: "not-content-addressed" }));
  assert.throws(() =>
    parseTracePack({
      ...fixture(),
      objects: [{ ...fixture().objects[0], path: "files/../outside.png" }],
    }),
  );
});

test("TracePack capture proof cannot contradict its recorded origin", () => {
  assert.throws(() =>
    parseTracePack({
      ...fixture(),
      source: {
        ...fixture().source,
        authoringCapture: {
          schemaVersion: 1,
          mode: "watch-and-infer",
          origin: "observed-transition",
        },
        authoringCaptureProof: "instrumented-unproved",
      },
    }),
  );
});

test("offline TracePack analysis can never claim a future transition passed", () => {
  const analysis = {
    schemaVersion: 1,
    mode: "trace-pack-offline-analysis",
    tracePackDigest: hash,
    sourceRunId: "run-1",
    historicalVerdict: "proved",
    futureTransitionVerdict: "unknown",
    proved: [],
    unknown: [
      {
        code: "FUTURE_TARGET_STATE",
        statement: "A future device transition was not executed.",
        resolution: "Replay the frozen Test on a live target.",
      },
    ],
    smallestLiveVerification: {
      kind: "replay-frozen-test",
      reason: "A target is required.",
      requiresTarget: true,
    },
  };
  assert.equal(
    tracePackExportResponseSchema.parse({ tracePack: fixture(), analysis }).analysis
      .futureTransitionVerdict,
    "unknown",
  );
  assert.throws(() =>
    tracePackExportResponseSchema.parse({
      tracePack: fixture(),
      analysis: { ...analysis, futureTransitionVerdict: "passed" },
    }),
  );
});
