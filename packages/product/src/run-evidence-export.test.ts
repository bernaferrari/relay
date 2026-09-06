import assert from "node:assert/strict";
import test from "node:test";
import type { TracePackExportResponse } from "@relay/protocol";
import { runEvidenceExportDocument } from "./run-evidence-export.js";

const digest = `sha256:${"a".repeat(64)}`;

function exported(runId: string, options: { digest?: string } = {}): TracePackExportResponse {
  const packDigest = options.digest ?? digest;
  return {
    tracePack: {
      schemaVersion: 1,
      kind: "relay-trace-pack",
      digest: packDigest,
      createdAt: 1,
      source: {
        runId,
        runSchemaVersion: 5,
        status: "ok",
        action: "test",
        inputDigest: "b".repeat(64),
        writtenAt: 1,
      },
      redaction: { status: "applied-at-persistence", redactedChannels: [] },
      completeness: { status: "complete", channels: {}, missing: [], artifacts: [] },
      objects: [
        {
          path: "run.json",
          kind: "frozen-run",
          mediaType: "application/json",
          encoding: "json",
          digest: packDigest,
          bytes: 2,
          content: {},
        },
      ],
    },
    analysis: {
      schemaVersion: 1,
      mode: "trace-pack-offline-analysis",
      tracePackDigest: packDigest,
      sourceRunId: runId,
      historicalVerdict: "failed",
      futureTransitionVerdict: "unknown",
      proved: [],
      unknown: [
        {
          code: "MISSING_EVIDENCE",
          statement: "The fixture has no verified future-device claim.",
          resolution: "Replay the frozen Test on the intended target.",
        },
      ],
      smallestLiveVerification: {
        kind: "replay-frozen-test",
        reason: "Offline export cannot prove a later device.",
        requiresTarget: true,
      },
    },
  };
}

test("run evidence export keeps the requested Run identity on the file", () => {
  const document = runEvidenceExportDocument("run-184", exported("run-184"));
  assert.equal(document.fileName, "relay-run-run-184.json");
  assert.equal(document.digest, digest);
  const parsed = JSON.parse(document.body) as TracePackExportResponse;
  assert.equal(parsed.tracePack.source.runId, "run-184");
  assert.equal(parsed.analysis.sourceRunId, "run-184");
  assert.equal(parsed.analysis.futureTransitionVerdict, "unknown");
});

test("run evidence export rejects a TracePack from a different Run", () => {
  assert.throws(
    () => runEvidenceExportDocument("run-184", exported("run-from-test-B")),
    /different Run/u,
  );
});

test("run evidence export rejects analysis that does not match the pack digest", () => {
  const result = exported("run-184");
  result.analysis.tracePackDigest = `sha256:${"c".repeat(64)}`;
  assert.throws(() => runEvidenceExportDocument("run-184", result), /different evidence digest/u);
});
