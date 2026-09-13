import assert from "node:assert/strict";
import test from "node:test";
import {
  combineCampaignBelongsToObservedPack,
  quoteObservedPackDuration,
} from "./combine-observed-duration.js";

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

test("eight-Test daily p95 ignores a two-lane 17s sample", () => {
  const quote = quoteObservedPackDuration({
    workItemCount: 8,
    samples: [
      { campaignId: "60fcdae7", durationMs: 203_384 },
      { campaignId: "19bdd834", durationMs: 201_102 },
      { campaignId: "cbc4711f", durationMs: 202_384 },
      { campaignId: "1445e569", durationMs: 195_736 },
      { campaignId: "a01ab9ca", durationMs: 198_919 },
    ],
  });
  assert.equal(quote?.provenance, "observed-p95");
  assert.equal(quote?.workItemCount, 8);
  assert.equal(quote?.durationMs, 203_184);
  assert.notEqual(quote?.durationMs, 17_254);
});

test("two-lane chrome jobs are not an eight-Test daily pack sample", () => {
  const daily = { appMapId: "grok-web", combineId: "grok-web-daily", workItemCount: 8 };
  assert.equal(
    combineCampaignBelongsToObservedPack(
      {
        appMapId: "grok-web",
        combineId: "grok-web-daily",
        cases: Array.from({ length: 8 }, (_, index) => ({ jobId: `daily-${index}` })),
      },
      daily,
    ),
    true,
  );
  assert.equal(
    combineCampaignBelongsToObservedPack(
      {
        appMapId: "grok-web",
        combineId: "grok-web-daily",
        cases: [{ jobId: "359564dc" }, { jobId: "182e73e4" }],
      },
      daily,
    ),
    false,
  );
});
