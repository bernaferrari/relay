import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureReviewQueueItemKey, type CombineCampaign } from "@relay/protocol";
import { createCombineCampaign } from "./combine-campaign.js";
import {
  captureReviewQueueForCampaign,
  captureReviewQueueForPersistedPlan,
} from "./capture-review-plan.js";

function campaign(): CombineCampaign & { execution: NonNullable<CombineCampaign["execution"]> } {
  return {
    schemaVersion: 1,
    id: "frozen-review",
    projectId: "default",
    appMapId: "map",
    combineId: "plan",
    sourceRevision: 1,
    latestRevision: 1,
    status: "running",
    createdAt: 1,
    updatedAt: 1,
    lineage: [],
    execution: { selectedCellIds: ["one", "two", "three"], seed: 1 },
    cases: ["one", "two", "three"].map((cellId, index) => ({
      index,
      cellId,
      testId: "settings",
      world: cellId,
      values: {},
      targetProfileId: cellId,
      childIntentDigest: "child",
      outerIntentDigest: "outer",
      wrapperGraphDigest: "graph",
      staticInputDigest: "inputs",
      phase: "coverage",
      status: index === 2 ? "blocked" : "pending",
      plannedCaptures: [{ checkpointId: "settings", caption: "Settings" }],
    })),
  };
}

const capturedRun = {
  id: "current",
  status: "ok" as const,
  artifacts: [
    {
      kind: "capture-review",
      capturedAt: 1,
      data: {
        caption: "Settings",
        checkpointId: "settings",
        framePath: "frames/settings.png",
        imageSha256: "hash",
        attempt: 1,
      },
    },
  ],
};

test("frozen coverage retains unstarted and blocked cases without inventing Run identities", () => {
  const frozen = campaign();
  frozen.cases[0]!.runId = "current";
  const queue = captureReviewQueueForCampaign(frozen, [capturedRun]);
  assert.equal(queue.summary.planned, 3);
  assert.equal(queue.summary.captured, 1);
  assert.equal(queue.summary.missing, 1);
  assert.equal(queue.summary.blocked, 1);
  assert.equal(queue.items[1]!.runId, undefined);
  assert.equal(new Set(queue.items.map(captureReviewQueueItemKey)).size, 3);
});

test("a retry overlays only its current Run and preserves the frozen denominator", () => {
  const frozen = campaign();
  frozen.cases[0]!.jobId = "new-attempt";
  frozen.cases[0]!.priorRunIds = ["current"];
  const before = captureReviewQueueForCampaign(frozen, [capturedRun]);
  assert.equal(before.summary.captured, 0);
  const after = captureReviewQueueForCampaign(frozen, [
    capturedRun,
    { ...capturedRun, id: "new-attempt" },
  ]);
  assert.equal(after.summary.planned, 3);
  assert.equal(after.summary.captured, 1);
  assert.equal(after.items[0]!.runId, "new-attempt");
});

test("persisted campaign coverage exists before any Run is created and exceeds 1000 cases", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-frozen-review-"));
  const previous = {
    runs: process.env.RELAY_RUNS_DIR,
    state: process.env.RELAY_STATE_DIR,
    workspace: process.env.RELAY_WORKSPACE_ROOT,
  };
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_STATE_DIR = join(root, ".relay");
  process.env.RELAY_WORKSPACE_ROOT = root;
  try {
    const frozen = campaign();
    const template = frozen.cases[0]!;
    frozen.cases = Array.from({ length: 1002 }, (_, index) => ({
      ...template,
      index,
      cellId: `case-${index}`,
    }));
    frozen.execution.selectedCellIds = frozen.cases.map((item) => item.cellId);
    await createCombineCampaign(frozen);
    const queue = await captureReviewQueueForPersistedPlan(frozen.id);
    assert.equal(queue.summary.planned, 1002);
    assert.equal(queue.summary.missing, 1002);
    assert.equal(queue.summary.captured, 0);
  } finally {
    if (previous.runs === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previous.runs;
    if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous.state;
    if (previous.workspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previous.workspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("incidental captures cannot expand the frozen planned count", () => {
  const frozen = campaign();
  frozen.cases[0]!.runId = "current";
  const extra = {
    ...capturedRun.artifacts[0]!,
    data: {
      ...capturedRun.artifacts[0]!.data,
      checkpointId: "incidental",
      caption: "Other screen",
      framePath: "frames/extra.png",
    },
  };
  const queue = captureReviewQueueForCampaign(frozen, [
    { ...capturedRun, artifacts: [...capturedRun.artifacts, extra] },
  ]);
  assert.equal(queue.summary.planned, 3);
  assert.equal(queue.summary.captured, 1);
  assert.equal(
    queue.items.some((item) => item.caption === "Other screen"),
    false,
  );
});

test("named case selection does not count the rest of the matrix as missing", () => {
  const frozen = campaign();
  frozen.execution.selectedCellIds = ["two"];
  const queue = captureReviewQueueForCampaign(frozen, []);
  assert.equal(queue.summary.planned, 1);
  assert.equal(queue.summary.missing, 1);
  assert.match(queue.items[0]!.executionCaseId!, /:two$/u);
});
