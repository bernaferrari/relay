import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { fmtAgo, fmtDur } from "./job";

function job(input: Partial<JobInfo>): JobInfo {
  return {
    action: "settings-tour",
    attempts: 1,
    id: "run",
    logs: [],
    queuedAt: 1_000,
    status: "ok",
    ...input,
  } as JobInfo;
}

test("uses the recorded duration for persisted run summaries", () => {
  assert.equal(fmtDur(job({ durationMs: 1_250 })), "1.3s");
});

test("never exposes invalid time arithmetic in the UI", () => {
  assert.equal(fmtDur(job({ queuedAt: Number.NaN })), "");
  assert.equal(fmtAgo(Number.NaN), "");
});

test("relative time is not a duration", () => {
  assert.equal(fmtAgo(1, 30_001), "now");
  assert.equal(fmtAgo(1, 60_001), "1m ago");
  assert.equal(fmtAgo(1, 3_600_001), "1h ago");
  assert.equal(fmtAgo(1, 86_400_001), "1d ago");
});

test("running jobs use the live clock", () => {
  assert.equal(fmtDur(job({ status: "running", startedAt: 1_000 }), 2_500), "1.5s");
});
