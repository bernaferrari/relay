import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGoldenLoopTelemetryEvent,
  projectGoldenLoopTelemetry,
  type GoldenLoopTelemetryEvent,
} from "./golden-loop-telemetry.js";

const projectScopeId = `local:${"a".repeat(64)}`;
const journeyId = `local:${"b".repeat(64)}`;

function event(sequence: number, at: number, payload: object): GoldenLoopTelemetryEvent {
  return {
    schemaVersion: 1,
    sequence,
    at,
    projectScopeId,
    journeyId,
    ...payload,
  } as GoldenLoopTelemetryEvent;
}

test("privacy-safe event contract rejects arbitrary content and raw identities", () => {
  const valid = event(1, 10, { type: "boundary", boundary: "record", outcome: "completed" });
  assert.deepEqual(parseGoldenLoopTelemetryEvent(valid), valid);
  assert.throws(
    () => parseGoldenLoopTelemetryEvent({ ...valid, label: "Settings" }),
    /unsupported fields/u,
  );
  assert.throws(
    () => parseGoldenLoopTelemetryEvent({ ...valid, deviceSerial: "secret" }),
    /unsupported fields/u,
  );
  assert.throws(
    () => parseGoldenLoopTelemetryEvent({ ...valid, journeyId: "workflow-raw" }),
    /local pseudonym/u,
  );
});

test("deterministic report covers complete and abandoned funnels, latency, recovery, and proof quality", () => {
  const events: GoldenLoopTelemetryEvent[] = [
    event(1, 100, { type: "boundary", boundary: "connect", outcome: "completed" }),
    event(2, 150, { type: "boundary", boundary: "record", outcome: "completed" }),
    event(3, 200, { type: "boundary", boundary: "checkpoint", outcome: "completed" }),
    event(4, 250, { type: "boundary", boundary: "compile", outcome: "completed" }),
    event(5, 300, { type: "boundary", boundary: "review", outcome: "completed" }),
    event(6, 400, { type: "boundary", boundary: "replay", outcome: "completed" }),
    event(7, 500, { type: "boundary", boundary: "approve", outcome: "completed" }),
    event(8, 600, { type: "action-latency", action: "replay", durationMs: 150 }),
    event(9, 700, { type: "recovery-outcome", outcome: "recovered", durationMs: 80 }),
    event(10, 800, { type: "duplicate-input-count", count: 0 }),
    event(11, 900, {
      type: "evidence-completeness",
      status: "partial",
      requiredChannels: 4,
      missingChannels: 1,
    }),
    event(12, 1_000, { type: "causal-failure-surfaced", surfaced: true }),
  ];
  const report = projectGoldenLoopTelemetry(events, 2_000);
  assert.equal(report.journeys[0]?.timeToFirstTrustworthyTestMs, 400);
  assert.equal(report.journeys[0]?.incompleteAfter, "approve");
  assert.equal(report.funnel.checkpoint, 1);
  assert.equal(report.actionLatency.replay?.p95Ms, 150);
  assert.equal(report.recovery.recovered, 1);
  assert.deepEqual(report.duplicateInput, { observed: 1, count: 0 });
  assert.deepEqual(report.evidence, { observed: 1, complete: 0, partial: 1 });
  assert.deepEqual(report.causalFailure, { observed: 1, surfaced: 1 });

  const abandoned = projectGoldenLoopTelemetry(
    [
      event(1, 100, { type: "boundary", boundary: "connect", outcome: "completed" }),
      event(2, 200, { type: "boundary", boundary: "record", outcome: "abandoned" }),
    ],
    300,
  );
  assert.equal(abandoned.journeys[0]?.abandonmentBoundary, "record");

  const failed = projectGoldenLoopTelemetry(
    [
      event(1, 100, { type: "boundary", boundary: "run", outcome: "started" }),
      event(2, 200, { type: "boundary", boundary: "run", outcome: "failed" }),
    ],
    300,
  );
  assert.equal(failed.funnel.run, 0, "a failed Run never enters the completed funnel");
  assert.equal(failed.journeys[0]?.failureBoundary, "run");
  assert.equal(failed.journeys[0]?.incompleteAfter, undefined);
  assert.deepEqual(failed.duplicateInput, { observed: 0, count: 0 });

  const outOfOrder = projectGoldenLoopTelemetry(
    [
      event(2, 200, { type: "boundary", boundary: "record", outcome: "completed" }),
      event(1, 100, { type: "boundary", boundary: "connect", outcome: "completed" }),
      event(3, 300, { type: "boundary", boundary: "record", outcome: "completed" }),
    ],
    400,
  );
  assert.equal(outOfOrder.orderingViolations, 1);
  assert.equal(outOfOrder.funnel.record, 1, "funnel counts journeys, not duplicate events");
});
