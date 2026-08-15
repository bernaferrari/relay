import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types";
import { campaignCheckCounts, campaignCheckResults } from "./campaign-check-results";

function job(input: Partial<JobInfo>): JobInfo {
  return {
    id: "job-1",
    action: "settings-tour",
    status: "error",
    queuedAt: 100,
    logs: [],
    ...input,
  };
}

test("campaign checks preserve every partial outcome and its exact dependency reason", () => {
  const checks = campaignCheckResults(
    job({
      checks: [
        {
          id: "start",
          title: "Start",
          status: "passed",
          startedAt: 100,
          finishedAt: 130,
          durationMs: 30,
        },
      ],
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 160,
          data: {
            id: "usage",
            title: "Usage",
            status: "failed",
            error: "Expected Usage, observed Settings",
            startedAt: 130,
            finishedAt: 160,
          },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 161,
          data: {
            id: "memory",
            title: "Memory",
            status: "blocked",
            dependencyReason: "Usage did not reach its mapped destination",
            startedAt: 160,
            finishedAt: 161,
          },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 162,
          data: {
            id: "licenses",
            title: "Open source licenses",
            status: "skipped",
            reason: "Equivalent content; representative viewport retained",
            startedAt: 161,
            finishedAt: 162,
          },
        },
        {
          kind: "campaign-check-evidence",
          capturedAt: 160,
          data: { checkId: "usage", nodes: [{ text: "Settings" }] },
        },
      ],
      frames: [
        {
          path: "failure.png",
          caption: "failed:Usage",
          capturedAt: 160,
        },
      ],
    }),
  );

  assert.deepEqual(
    checks.map(({ id, status }) => ({ id, status })),
    [
      { id: "usage", status: "failed" },
      { id: "memory", status: "blocked" },
      { id: "licenses", status: "skipped" },
      { id: "start", status: "passed" },
    ],
  );
  assert.equal(checks[0]?.error, "Expected Usage, observed Settings");
  assert.equal(checks[0]?.evidence.length, 1);
  assert.equal(checks[0]?.frames[0]?.index, 0);
  assert.equal(checks[1]?.dependencyReason, "Usage did not reach its mapped destination");
  assert.equal(checks[2]?.dependencyReason, "Equivalent content; representative viewport retained");
  assert.deepEqual(campaignCheckCounts(checks), {
    passed: 1,
    failed: 1,
    skipped: 1,
    blocked: 1,
  });
});

test("bounded summary checks remain visible before detailed artifacts load", () => {
  const checks = campaignCheckResults(
    job({
      checks: [
        {
          id: "settings",
          title: "Settings",
          status: "failed",
          error: "screen changed",
          startedAt: 100,
          finishedAt: 180,
          durationMs: 80,
        },
      ],
    }),
  );

  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.error, "screen changed");
  assert.equal(checks[0]?.durationMs, 80);
});

test("authored order survives deferred completion and the latest terminal result wins", () => {
  const checks = campaignCheckResults(
    job({
      recipeSnapshot: {
        id: "campaign",
        title: "Settings campaign",
        source: "custom",
        createdAt: 1,
        updatedAt: 1,
        steps: [
          {
            kind: "module",
            recipeId: "terms",
            check: { id: "terms", title: "Terms of Use" },
          },
          {
            kind: "module",
            recipeId: "privacy",
            check: { id: "privacy", title: "Privacy Policy" },
          },
          {
            kind: "module",
            recipeId: "help",
            check: { id: "help", title: "Help & Support" },
          },
        ],
      },
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 100,
          data: { id: "terms", title: "Terms of Use", status: "passed" },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 120,
          data: { id: "privacy", title: "Privacy Policy", status: "failed", error: "Transient" },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 130,
          data: { id: "help", title: "Help & Support", status: "passed" },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 140,
          data: { id: "privacy", title: "Privacy Policy", status: "passed" },
        },
      ],
    }),
  );

  assert.deepEqual(
    checks.map(({ id, status }) => ({ id, status })),
    [
      { id: "terms", status: "passed" },
      { id: "privacy", status: "passed" },
      { id: "help", status: "passed" },
    ],
  );
  assert.equal(checks[1]?.error, undefined);
});
