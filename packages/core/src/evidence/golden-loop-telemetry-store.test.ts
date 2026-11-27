import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGoldenLoopTelemetrySink } from "./golden-loop-telemetry-store.js";

test("golden-loop sink stores only salted identities and refuses raw content", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-golden-loop-"));
  try {
    const sink = createGoldenLoopTelemetrySink(root);
    const recorded = sink.record({
      type: "boundary",
      boundary: "record",
      outcome: "completed",
      projectKey: "project-alpha",
      journeyKey: "journey-1",
      at: 1_000,
    });
    assert.match(recorded.projectScopeId, /^local:[a-f0-9]{64}$/u);
    assert.match(recorded.journeyId, /^local:[a-f0-9]{64}$/u);
    assert.notEqual(recorded.projectScopeId.includes("project-alpha"), true);
    sink.record({
      type: "action-latency",
      action: "replay",
      durationMs: 150,
      projectKey: "project-alpha",
      journeyKey: "journey-1",
      at: 1_200,
    });
    sink.record({
      type: "recovery-outcome",
      outcome: "recovered",
      durationMs: 80,
      projectKey: "project-alpha",
      journeyKey: "journey-1",
      at: 1_300,
    });
    const report = sink.report(1_400);
    assert.equal(report.eventCount, 3);
    assert.equal(report.funnel.record, 1);
    assert.equal(report.recovery.recovered, 1);
    assert.equal(report.actionLatency.replay?.count, 1);
    const raw = await readFile(join(root, ".relay", "golden-loop.json"), "utf8");
    assert.doesNotMatch(raw, /project-alpha|journey-1|Settings|serial/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
