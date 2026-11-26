import assert from "node:assert/strict";
import test from "node:test";
import { tracePackComparisonSchema } from "./trace-pack-comparison.js";

const digest = `sha256:${"a".repeat(64)}`;

function fixture() {
  return {
    schemaVersion: 1,
    mode: "trace-pack-offline-comparison",
    orderedTracePacks: [
      {
        ordinal: 0,
        tracePackDigest: digest,
        sourceRunId: "run-1",
        historicalVerdict: "proved",
        classification: "historically-proved",
        completeness: "complete",
      },
      {
        ordinal: 1,
        tracePackDigest: `sha256:${"b".repeat(64)}`,
        sourceRunId: "run-2",
        historicalVerdict: "failed",
        classification: "historically-failed",
        completeness: "complete",
      },
    ],
    testIdentity: {
      status: "common",
      fact: {
        classification: "recomputable",
        statement: "The identity is common.",
        evidence: [digest],
      },
      entries: [
        { tracePackDigest: digest, planDigest: "c".repeat(64), testId: "settings" },
        {
          tracePackDigest: `sha256:${"b".repeat(64)}`,
          planDigest: "d".repeat(64),
          testId: "settings",
        },
      ],
    },
    requiredPaths: [],
    matcherDeltas: [],
    completenessGaps: [],
    futureTransitionVerdict: "unknown",
    smallestLiveVerification: {
      classification: "live-verification-required",
      kind: "replay-frozen-test",
      tracePackDigest: `sha256:${"b".repeat(64)}`,
      reason: "Frozen evidence cannot establish current behavior.",
      requiresTarget: true,
    },
    repairPolicy: { mutation: "none", requiresReview: true },
  } as const;
}

test("comparison schema requires a bounded ordered history and future uncertainty", () => {
  assert.deepEqual(tracePackComparisonSchema.parse(fixture()), fixture());
  assert.throws(() =>
    tracePackComparisonSchema.parse({
      ...fixture(),
      orderedTracePacks: fixture().orderedTracePacks.slice(0, 1),
    }),
  );
  assert.throws(() =>
    tracePackComparisonSchema.parse({ ...fixture(), futureTransitionVerdict: "passed" }),
  );
  assert.throws(() =>
    tracePackComparisonSchema.parse({
      ...fixture(),
      repairPolicy: { mutation: "apply", requiresReview: false },
    }),
  );
});
