import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceManifest, TargetProfile } from "@relay/protocol";
import { buildSoakReport } from "./soak-report.js";

const profile: TargetProfile = {
  id: "android:one",
  targetId: "one",
  source: "device",
  platform: "android",
  name: "Pixel",
  capabilities: [],
  observedAt: 1,
};

function evidence(): EvidenceManifest {
  const channel = (name: keyof EvidenceManifest["channels"], status: "captured" | "denied") => ({
    channel: name,
    status,
    entries: status === "captured" ? 1 : 0,
    bytes: 0,
    dropped: 0,
    redactions: 0,
  });
  return {
    schemaVersion: 1,
    runId: "run",
    target: { kind: "device", platform: "android", id: "one" },
    startedAt: 1,
    finishedAt: 2,
    channels: {
      input: channel("input", "captured"),
      screenshot: channel("screenshot", "captured"),
      video: channel("video", "captured"),
      "ui-tree": channel("ui-tree", "captured"),
      logs: channel("logs", "captured"),
      network: channel("network", "captured"),
      performance: channel("performance", "captured"),
      crash: channel("crash", "captured"),
      audio: channel("audio", "denied"),
    },
    events: [],
  };
}

test("soak report separates run outcomes from evidence coverage", () => {
  const report = buildSoakReport(
    [
      {
        id: "run-1",
        action: "login",
        batchId: "soak-1",
        status: "ok",
        outcome: "passed",
        targetProfile: profile,
        caseCount: 4,
        evidence: evidence(),
        evidencePolicy: {
          schemaVersion: 1,
          sensitive: { crash: { grantedAt: 1, grantedBy: "tester", reason: "soak" } },
        },
      },
      {
        id: "run-2",
        action: "login",
        batchId: "soak-1",
        status: "running",
        targetProfile: profile,
        caseCount: 4,
        evidencePolicy: { schemaVersion: 1, sensitive: {} },
      },
    ],
    "soak-1",
  );
  assert.equal(report?.repetitions, 4);
  assert.equal(report?.passed, 1);
  assert.equal(report?.pending, 1);
  assert.deepEqual(
    report?.evidence.find((item) => item.channel === "crash"),
    {
      channel: "crash",
      expected: 1,
      captured: 1,
      partial: 0,
      denied: 0,
      unsupported: 0,
      failed: 0,
      missing: 0,
      coverageRate: 1,
    },
  );
  assert.equal(report?.evidence.find((item) => item.channel === "audio")?.expected, 0);
});
