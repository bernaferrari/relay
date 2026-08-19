import assert from "node:assert/strict";
import test from "node:test";
import type { SnapshotNode } from "./device.js";
import { frameObservations, recordFrameObservation } from "./frame-observation.js";
import type { TestJob } from "./session-contract.js";

const nodes = [
  {
    index: 0,
    identifier: "settings.language",
    label: "Notifications",
    type: "Cell",
    hittable: true,
    rect: { x: 0, y: 120, width: 320, height: 44 },
  },
] as unknown as SnapshotNode[];

function job(batchId?: string): TestJob {
  return { id: "job-1", artifacts: [], ...(batchId ? { batchId } : {}) } as unknown as TestJob;
}

test("a matrix case remembers the controls behind each authored screenshot", () => {
  const matrixCase = job("batch-1");
  recordFrameObservation({
    job: matrixCase,
    framePath: "frames/003.png",
    caption: "settings",
    nodes,
  });

  const observed = frameObservations(matrixCase).get("003.png");
  assert.equal(observed?.caption, "settings");
  assert.deepEqual(
    observed?.controls.map((control) => control.label),
    ["Notifications"],
  );
  assert.ok(observed?.fingerprint);
});

test("a run outside a matrix, or without a tree, records nothing to compare", () => {
  const single = job();
  recordFrameObservation({ job: single, framePath: "frames/001.png", nodes });
  assert.deepEqual(single.artifacts, []);

  const blind = job("batch-1");
  recordFrameObservation({ job: blind, framePath: "frames/001.png" });
  assert.deepEqual(blind.artifacts, []);
});

test("re-attaching the same frame does not duplicate its observation", () => {
  const matrixCase = job("batch-1");
  recordFrameObservation({ job: matrixCase, framePath: "frames/001.png", nodes });
  recordFrameObservation({ job: matrixCase, framePath: "frames/001.png", nodes });
  assert.equal(matrixCase.artifacts.length, 1);
});
