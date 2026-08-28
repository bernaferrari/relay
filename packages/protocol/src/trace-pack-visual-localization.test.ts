import assert from "node:assert/strict";
import test from "node:test";
import { tracePackVisualLocalizationSchema } from "./trace-pack-visual-localization.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture() {
  return {
    schemaVersion: 1,
    mode: "trace-pack-visual-localization-recomputation",
    orderedTracePacks: [
      {
        ordinal: 0,
        tracePackDigest: digest("a"),
        sourceRunId: "run-a",
        locale: "en",
        frameCount: 1,
        embeddedFrames: 1,
        inspectedFrames: 1,
      },
      {
        ordinal: 1,
        tracePackDigest: digest("b"),
        sourceRunId: "run-b",
        locale: "en",
        frameCount: 1,
        embeddedFrames: 1,
        inspectedFrames: 1,
      },
    ],
    historicalBaseline: {
      status: "comparable",
      locale: "en",
      frameCountStatus: "unchanged",
      fact: {
        classification: "recomputable",
        statement: "The same locale baseline is available.",
        evidence: [digest("a"), digest("b")],
      },
      frames: [],
    },
    localization: {
      status: "not-applicable",
      locales: ["en"],
      coverage: { frames: 0, inspectedFrames: 0 },
      findings: [],
      fact: {
        classification: "recomputable",
        statement: "Only one locale is present.",
        evidence: [digest("a"), digest("b")],
      },
    },
    sufficiency: { visual: "sufficient", localization: "not-applicable", reasons: [] },
    futureTransitionVerdict: "unknown",
    smallestLiveVerification: {
      classification: "live-verification-required",
      kind: "replay-frozen-test",
      tracePackDigest: digest("b"),
      reason: "Replay the frozen Test.",
      requiresTarget: true,
    },
    repairPolicy: { mutation: "none", requiresReview: true },
  } as const;
}

test("portable visual/localization recomputation cannot claim future success or mutate", () => {
  assert.equal(
    tracePackVisualLocalizationSchema.parse(fixture()).futureTransitionVerdict,
    "unknown",
  );
  assert.throws(() =>
    tracePackVisualLocalizationSchema.parse({
      ...fixture(),
      futureTransitionVerdict: "passed",
    }),
  );
  assert.throws(() =>
    tracePackVisualLocalizationSchema.parse({
      ...fixture(),
      repairPolicy: { mutation: "apply", requiresReview: false },
    }),
  );
});
