import assert from "node:assert/strict";
import test from "node:test";
import { ABANDONED_CAMPAIGN_AFTER_MS, isAbandonedCampaign } from "./combine-campaign.js";

const now = 1_000_000_000_000;
const campaign = (overrides: Partial<Parameters<typeof isAbandonedCampaign>[0]> = {}) =>
  ({
    status: "running",
    updatedAt: now - ABANDONED_CAMPAIGN_AFTER_MS - 1,
    cases: [{ status: "queued" }, { status: "queued", jobId: "job-lost-in-restart" }],
    ...overrides,
  }) as Parameters<typeof isAbandonedCampaign>[0];

test("a run that never started and went quiet no longer holds the Plan", () => {
  assert.equal(isAbandonedCampaign(campaign(), now), true);
});

test("recent, started, or finished runs still count as they are", () => {
  assert.equal(isAbandonedCampaign(campaign({ updatedAt: now - 60_000 }), now), false);
  assert.equal(
    isAbandonedCampaign(
      campaign({ cases: [{ status: "passed" }, { status: "queued" }] } as never),
      now,
    ),
    false,
  );
  assert.equal(isAbandonedCampaign(campaign({ status: "completed" } as never), now), false);
});
