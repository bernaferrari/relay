import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEvidenceManifest,
  type EvidenceChannel,
  type EvidenceManifest,
} from "@relay/protocol";
import { compareEvidenceMetrics, extractEvidenceMetrics } from "./evidence-metrics.js";

const channels = [
  "input",
  "screenshot",
  "video",
  "ui-tree",
  "logs",
  "network",
  "performance",
  "crash",
  "audio",
] as EvidenceChannel[];

function manifest(): EvidenceManifest {
  return {
    schemaVersion: 1,
    runId: "run-1",
    target: { kind: "browser", platform: "browser", profileId: "chrome" },
    startedAt: 1_000,
    finishedAt: 3_000,
    channels: Object.fromEntries(
      channels.map((channel) => [
        channel,
        {
          channel,
          status: "captured",
          entries: channel === "network" ? 7 : 0,
          bytes: 0,
          dropped: 0,
          redactions: 0,
        },
      ]),
    ) as EvidenceManifest["channels"],
    events: [
      { sequence: 1, at: 1_100, monotonicMs: 100, channel: "input", kind: "tap", stepId: "a" },
      { sequence: 2, at: 1_300, monotonicMs: 300, channel: "input", kind: "tap", stepId: "a" },
      { sequence: 3, at: 1_500, monotonicMs: 500, channel: "input", kind: "tap", stepId: "a" },
    ],
  };
}

test("evidence metrics are deterministic and source-linked", () => {
  const metrics = extractEvidenceMetrics(manifest(), {
    targetProfileId: "chrome",
    appVersion: "1",
  });
  assert.equal(metrics.find((metric) => metric.id === "completion.duration")?.value, 2_000);
  assert.equal(metrics.find((metric) => metric.id === "interaction.attempts")?.value, 3);
  assert.equal(
    metrics.find((metric) => metric.id === "interaction.rapid-repeat-clusters")?.value,
    1,
  );
  assert.equal(metrics.find((metric) => metric.id === "network.requests")?.value, 7);
});

test("truncated evidence is insufficient and incompatible profiles do not form baselines", () => {
  const currentManifest = manifest();
  currentManifest.channels.network.dropped = 2;
  const current = extractEvidenceMetrics(currentManifest, { targetProfileId: "chrome" });
  assert.equal(
    current.find((metric) => metric.id === "network.requests")?.status,
    "insufficient-evidence",
  );
  const other = extractEvidenceMetrics(manifest(), { targetProfileId: "safari" });
  assert.ok(compareEvidenceMetrics(current, [other]).every((signal) => !signal.material));
});

test("evidence parser rejects unknown schemas and channel statuses", () => {
  assert.equal(parseEvidenceManifest(manifest()).schemaVersion, 1);
  assert.throws(() => parseEvidenceManifest({ ...manifest(), schemaVersion: 2 }), /unsupported/);
  const invalid = manifest();
  invalid.channels.audio.status = "mystery" as never;
  assert.throws(() => parseEvidenceManifest(invalid), /invalid evidence status/);
});
