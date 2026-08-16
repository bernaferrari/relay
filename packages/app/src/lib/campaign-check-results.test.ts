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

test("stable check IDs claim frames once while ambiguous legacy titles claim none", () => {
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
            recipeId: "privacy",
            check: { id: "privacy", title: "Legal" },
          },
          {
            kind: "module",
            recipeId: "terms",
            check: { id: "terms", title: "Legal" },
          },
        ],
      },
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 100,
          data: { id: "privacy", title: "Legal", status: "failed" },
        },
        {
          kind: "campaign-check-result",
          capturedAt: 101,
          data: { id: "terms", title: "Legal", status: "failed" },
        },
      ],
      frames: [
        { path: "stable.png", caption: "failed:privacy", capturedAt: 100 },
        { path: "legacy.png", caption: "failed:Legal", capturedAt: 101 },
      ],
    }),
  );

  assert.deepEqual(
    checks.map((check) => check.frames.map(({ index }) => index)),
    [[0], []],
  );
});

test("an unambiguous legacy title caption remains compatible", () => {
  const [check] = campaignCheckResults(
    job({
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 100,
          data: { id: "privacy", title: "Privacy Policy", status: "failed" },
        },
      ],
      frames: [{ path: "legacy.png", caption: "failed:Privacy Policy", capturedAt: 100 }],
    }),
  );

  assert.equal(check?.frames[0]?.index, 0);
});

test("repair summary preserves ordered locator outcomes and reports missing accessibility", () => {
  const [check] = campaignCheckResults(
    job({
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 200,
          data: {
            id: "usage",
            title: "Usage",
            status: "failed",
            error: "Expected Usage, observed Settings",
          },
        },
        {
          kind: "campaign-check-evidence",
          capturedAt: 200,
          data: {
            checkId: "usage",
            error: "tap failed: control remained offscreen",
            chrome: { app: "Grok", header: "Settings" },
            screenIdentity: { fingerprint: "screen-123" },
            accessibility: { available: false, nodeCount: 0 },
            nodes: [],
            attempts: [
              {
                kind: "target-resolution-attempt",
                capturedAt: 180,
                data: {
                  status: "failed",
                  target: { ref: "@stale" },
                  error: "control remained offscreen",
                },
              },
              {
                kind: "target-resolution",
                capturedAt: 190,
                data: {
                  method: "label",
                  strategy: "label",
                  target: { label: "Usage" },
                  bounds: { x: 20, y: 80, width: 200, height: 44 },
                  point: { x: 120, y: 102 },
                },
              },
              {
                kind: "locator-fallback",
                capturedAt: 191,
                data: {
                  original: { ref: "@stale" },
                  replacement: { label: "Usage" },
                  strategy: "label",
                  reason: "control remained offscreen",
                  persisted: false,
                },
              },
            ],
          },
        },
      ],
      frames: [{ path: "failure.png", caption: "failed:usage", capturedAt: 200 }],
    }),
  );

  assert.deepEqual(check?.repair?.observed, {
    app: "Grok",
    header: "Settings",
    identity: "screen-123",
    accessibilityAvailable: false,
    nodeCount: 0,
  });
  assert.deepEqual(check?.repair?.attempts, [
    {
      method: "ref",
      target: "ref “@stale”",
      outcome: "rejected",
      detail: "control remained offscreen",
    },
    {
      method: "label",
      target: "label “Usage”",
      outcome: "used",
      note: "Used configured fallback; saved map unchanged.",
      bounds: "x 20, y 80, 200 × 44",
      point: "(120, 102)",
    },
  ]);
  assert.equal(check?.repair?.failureReason, "tap failed: control remained offscreen");
  assert.equal(
    check?.repair?.nextStep,
    "Inspect the failure screenshot, manually locate the missing control, then repair its mapped locator.",
  );
});

test("repair summary bounds malformed oversized evidence without altering raw artifacts", () => {
  const oversized = "x".repeat(500);
  const attempts = Array.from({ length: 20 }, (_, index) => ({
    kind: "target-resolution-attempt",
    capturedAt: index,
    data: {
      target: { label: `${index}-${oversized}` },
      error: oversized,
    },
  }));
  const [check] = campaignCheckResults(
    job({
      artifacts: [
        {
          kind: "campaign-check-result",
          capturedAt: 100,
          data: { id: "large", title: "Large", status: "failed" },
        },
        {
          kind: "campaign-check-evidence",
          capturedAt: 100,
          data: {
            checkId: "large",
            error: oversized,
            chrome: { app: oversized },
            screenIdentity: "malformed",
            attempts: [null, { kind: "unknown", data: oversized }, ...attempts],
            nodes: [],
          },
        },
      ],
    }),
  );

  assert.equal(check?.repair?.attempts.length, 8);
  assert.equal(check?.repair?.attemptsTruncated, true);
  assert.ok((check?.repair?.failureReason?.length ?? 0) <= 240);
  assert.ok((check?.repair?.observed.app?.length ?? 0) <= 96);
  assert.ok(check?.repair?.attempts.every((attempt) => attempt.target.length <= 180));
  assert.equal(
    ((check?.evidence[0]?.data as { error?: string } | undefined)?.error ?? "").length,
    500,
  );
});
