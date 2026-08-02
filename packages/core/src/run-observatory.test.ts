import assert from "node:assert/strict";
import test from "node:test";
import { buildRunEvidence } from "./run-observatory.js";
import type { PersistedRun } from "./runs.js";

function run(overrides: Partial<PersistedRun> = {}): PersistedRun {
  return {
    schemaVersion: 5,
    id: "run-1",
    projectId: "project-1",
    action: "checkout",
    serial: "pixel-9",
    platform: "android",
    status: "ok",
    attempts: 1,
    queuedAt: 1,
    logs: [],
    steps: [],
    frames: [],
    dir: "/tmp/run-1",
    writtenAt: 10,
    artifacts: [],
    inputDigest: "digest",
    resolvedInputs: {},
    ...overrides,
  };
}

test("buildRunEvidence normalizes device logs and network exchanges", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "logs",
          capturedAt: 20,
          data: {
            entries: [{ at: 21, level: "ERROR", tag: "Checkout", message: "Payment failed" }],
          },
        },
        {
          kind: "network",
          capturedAt: 22,
          data: {
            entries: [
              {
                at: 23,
                method: "post",
                url: "https://example.test/pay",
                status: 500,
                durationMs: 42,
              },
            ],
          },
        },
      ],
      evidence: {
        schemaVersion: 1,
        runId: "run-1",
        target: { kind: "device", platform: "android", id: "pixel-9" },
        startedAt: 1,
        channels: {
          input: {
            channel: "input",
            status: "captured",
            entries: 1,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          screenshot: {
            channel: "screenshot",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          video: {
            channel: "video",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          "ui-tree": {
            channel: "ui-tree",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          logs: {
            channel: "logs",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
          network: {
            channel: "network",
            status: "captured",
            entries: 1,
            bytes: 10,
            dropped: 0,
            redactions: 0,
          },
          performance: {
            channel: "performance",
            status: "captured",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          crash: {
            channel: "crash",
            status: "denied",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
          audio: {
            channel: "audio",
            status: "denied",
            entries: 0,
            bytes: 0,
            dropped: 0,
            redactions: 0,
          },
        },
        events: [],
      },
    }),
  );

  assert.equal(evidence.logs[0]?.level, "error");
  assert.equal(evidence.logs[0]?.source, "Checkout");
  assert.equal(evidence.network[0]?.method, "POST");
  assert.equal(evidence.network[0]?.result, "failure");
  assert.equal(evidence.network[0]?.status, 500);
  assert.equal(evidence.limits.bodiesIncluded, false);
});

test("buildRunEvidence never exposes network bodies without consent", () => {
  const evidence = buildRunEvidence(
    run({
      artifacts: [
        {
          kind: "network",
          capturedAt: 2,
          data: {
            entries: [
              {
                method: "POST",
                url: "https://example.test/pay",
                status: 200,
                requestBody: "card=secret",
                responseBody: "approved",
              },
            ],
          },
        },
      ],
    }),
    { includeBodies: true },
  );
  assert.equal(evidence.limits.bodiesIncluded, false);
  assert.equal(evidence.network[0]?.requestBody, undefined);
  assert.match(evidence.notes.join(" "), /no network-body consent/i);
});
