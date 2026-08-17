import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { campaignPerformanceFromJob } from "./campaign-performance";

function job(input: Partial<JobInfo>): JobInfo {
  return {
    id: "job-1",
    action: "relay-40",
    status: "ok",
    queuedAt: 100,
    logs: [],
    ...input,
  };
}

test("campaign performance names slowest checks and cached versus fresh surfaces", () => {
  const report = campaignPerformanceFromJob(
    job({
      startedAt: 1_000,
      finishedAt: 21_000,
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 8_000,
          data: {
            id: "voice",
            title: "Voice",
            status: "passed",
            durationMs: 12_000,
          },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 9_000,
          data: {
            id: "advanced",
            title: "Advanced",
            status: "passed",
            durationMs: 1_200,
          },
        },
        {
          kind: "logical-scroll-surface-result",
          capturedAt: 8_000,
          data: {
            cache: { status: "hit" },
            capture: { viewports: [{}, {}], restoredStartViewport: true },
          },
        },
        {
          kind: "logical-scroll-surface-result",
          capturedAt: 8_500,
          data: {
            cache: { status: "bypassed" },
            capture: { viewports: [{}], restoredStartViewport: true },
          },
        },
      ],
    }),
  );
  assert.equal(report.totalDurationMs, 20_000);
  assert.equal(report.coverageDurationMs, 13_200);
  assert.equal(report.slowest[0]?.id, "voice");
  assert.equal(report.cacheHits, 1);
  assert.equal(report.cacheBypassed, 1);
  assert.equal(report.viewportCount, 3);
  assert.equal(
    report.recommendations.some((item) => item.id === "cache-hits"),
    true,
  );
  assert.equal(
    report.recommendations.some((item) => item.id === "slowest"),
    true,
  );
});
