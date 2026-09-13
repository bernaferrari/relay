import assert from "node:assert/strict";
import test from "node:test";
import { quoteObservedPackDuration } from "./combine-observed-duration.js";

test("one completed pack is an observed sample, not a p95", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 7,
    samples: [{ campaignId: "seven-a", durationMs: 143_000 }],
  });
  assert.deepEqual(quote, {
    durationMs: 143_000,
    provenance: "observed-sample",
    sampleCount: 1,
    workItemCount: 7,
    campaignIds: ["seven-a"],
  });
});

test("three completed packs quote an observed p95", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 6,
    samples: [
      { campaignId: "six-a", durationMs: 96_000 },
      { campaignId: "six-b", durationMs: 97_000 },
      { campaignId: "six-c", durationMs: 101_000 },
    ],
  });
  assert.equal(quote?.provenance, "observed-p95");
  assert.equal(quote?.sampleCount, 3);
  assert.equal(quote?.workItemCount, 6);
  assert.equal(quote?.durationMs, 100_600);
});

test("missing samples stay unquoted instead of guessing", () => {
  assert.equal(quoteObservedPackDuration({ workItemCount: 7, samples: [] }), undefined);
});
