import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCombineCampaign,
  findActiveCombineCampaignForCombine,
  findActiveRepeatCampaigns,
  pendingSelectedCombineCampaignCells,
  prepareSelectedCombineCampaignResume,
  projectCombineCampaign,
  readCombineCampaign,
  updateCombineCampaign,
  type StoredCombineCampaign,
} from "./combine-campaign.js";
import {
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";

function fixture(status: "passed" | "failed" = "passed"): StoredCombineCampaign {
  return {
    schemaVersion: 1,
    id: "campaign-1",
    projectId: "project-1",
    ownerId: "agent:test",
    appMapId: "settings",
    combineId: "languages",
    sourceRevision: 7,
    latestRevision: 7,
    target: { kind: "device", id: "android-1", platform: "android" },
    status: "pilot-running",
    createdAt: 10,
    updatedAt: 10,
    cases: [
      {
        index: 0,
        cellId: "c" + "a".repeat(32),
        testId: "settings",
        world: "English",
        values: { language: "en" },
        targetProfileId: "android-en",
        childIntentDigest: "a".repeat(64),
        outerIntentDigest: "b".repeat(64),
        wrapperGraphDigest: "c".repeat(64),
        staticInputDigest: "d".repeat(64),
        phase: "pilot",
        status,
      },
      {
        index: 1,
        cellId: "c" + "b".repeat(32),
        testId: "settings",
        world: "Italian",
        values: { language: "it" },
        targetProfileId: "android-it",
        childIntentDigest: "e".repeat(64),
        outerIntentDigest: "f".repeat(64),
        wrapperGraphDigest: "1".repeat(64),
        staticInputDigest: "2".repeat(64),
        phase: "coverage",
        status: "pending",
      },
    ],
    lineage: [{ kind: "created", at: 10, appMapRevision: 7, actorId: "agent:test" }],
    execution: {
      selected: { language: ["en", "it"] },
      selectedCellIds: ["c" + "a".repeat(32), "c" + "b".repeat(32)],
      strategy: "zip",
      seed: 42,
      repeat: {
        schemaVersion: 1,
        requestedAppMapRevision: 6,
        executionAppMapRevision: 7,
        testId: "settings",
        testPlanDigest: "settings-plan",
        rootRecipeId: "settings-root",
        target: { kind: "device", platform: "android", targetId: "android-1" },
        spec: { dimensions: [{ id: "language", values: ["en", "it"] }] },
        resolved: {
          dimensions: [{ id: "language", valueIds: ["en", "it"] }],
          strategy: "zip",
          pilot: { mode: "representative" },
          resume: "untouched",
        },
        evidence: "visual",
        pilotJobId: "pilot-job",
        selectedCaseIds: ["c" + "a".repeat(32), "c" + "b".repeat(32)],
      },
    },
  };
}

test("Combine campaigns persist pilot state and derive a truthful resume boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-campaign-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    await createCombineCampaign(fixture());
    const read = await readCombineCampaign("project-1", "campaign-1");
    assert.equal(read?.execution.seed, 42);
    assert.equal((await projectCombineCampaign(read!)).status, "ready-to-resume");
    assert.equal(
      (await findActiveCombineCampaignForCombine("project-1", "settings", "languages"))?.id,
      "campaign-1",
    );
    assert.deepEqual(
      (await findActiveRepeatCampaigns("project-1", "settings", "settings")).map(
        (campaign) => campaign.id,
      ),
      ["campaign-1"],
    );

    const resumed = await updateCombineCampaign("project-1", "campaign-1", (current) => ({
      ...current,
      latestRevision: 9,
      updatedAt: 20,
      status: "running",
      cases: current.cases.map((item) =>
        item.index === 1 ? { ...item, status: "queued", jobId: "coverage-job" } : item,
      ),
      lineage: [
        ...current.lineage,
        { kind: "resumed", at: 20, appMapRevision: 9, actorId: "agent:repair" },
      ],
    }));
    assert.equal(resumed.latestRevision, 9);
    assert.equal(resumed.cases[0]?.status, "passed");
    assert.equal(resumed.cases[1]?.jobId, "coverage-job");
    assert.deepEqual(
      resumed.lineage.map((item) => item.appMapRevision),
      [7, 9],
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("resume scope is pending selected cells by status, not missing jobId", async () => {
  const campaign = fixture("passed");
  campaign.cases[0]!.jobId = undefined;
  campaign.cases.push({
    ...campaign.cases[1]!,
    index: 2,
    cellId: "c" + "d".repeat(32),
    world: "French",
    values: { language: "fr" },
    status: "pending",
  });
  const pending = pendingSelectedCombineCampaignCells(campaign);
  assert.deepEqual(
    pending.map((item) => item.cellId),
    ["c" + "b".repeat(32)],
  );
  const projected = await projectCombineCampaign(campaign);
  assert.equal(projected.status, "ready-to-resume");
});

test("a failed pilot requires review while untouched cases remain pending", async () => {
  const campaign = fixture("failed");
  const projected = await projectCombineCampaign(campaign);
  assert.equal(projected.status, "needs-review");
  assert.equal(projected.cases[1]?.status, "pending");
});

test("failed and all resume modes reopen only reviewed non-passing cases", () => {
  const campaign = fixture("passed");
  campaign.execution.repeat!.resolved.resume = "failed";
  campaign.cases[0] = {
    ...campaign.cases[0]!,
    status: "passed",
    jobId: "passed-job",
    runId: "passed-run",
  };
  campaign.cases[1] = {
    ...campaign.cases[1]!,
    status: "failed",
    jobId: "failed-job",
    runId: "failed-run",
    error: "failed",
  };
  campaign.cases.push(
    {
      ...campaign.cases[1]!,
      index: 2,
      cellId: "c" + "c".repeat(32),
      values: { language: "fr" },
      status: "blocked",
      jobId: "blocked-job",
      runId: "blocked-run",
    },
    {
      ...campaign.cases[1]!,
      index: 3,
      cellId: "c" + "d".repeat(32),
      values: { language: "de" },
      status: "cancelled",
      jobId: "cancelled-job",
      runId: "cancelled-run",
    },
    {
      ...campaign.cases[1]!,
      index: 4,
      cellId: "c" + "e".repeat(32),
      values: { language: "es" },
      status: "pending",
      jobId: undefined,
      runId: undefined,
    },
    {
      ...campaign.cases[1]!,
      index: 5,
      cellId: "c" + "f".repeat(32),
      values: { language: "ja" },
      status: "running",
      jobId: "active-job",
      runId: undefined,
    },
  );
  campaign.execution.selectedCellIds = campaign.cases.map((item) => item.cellId);
  campaign.execution.repeat!.selectedCaseIds = [...campaign.execution.selectedCellIds];

  const failed = prepareSelectedCombineCampaignResume(campaign);
  assert.deepEqual(failed.selectedCellIds, [campaign.cases[1]!.cellId, campaign.cases[4]!.cellId]);
  assert.deepEqual(failed.retriedTerminalCellIds, [campaign.cases[1]!.cellId]);
  assert.equal(failed.campaign.cases[0]?.status, "passed");
  assert.equal(failed.campaign.cases[2]?.status, "blocked");
  assert.equal(failed.campaign.cases[5]?.status, "running");
  assert.deepEqual(failed.campaign.cases[1]?.priorRunIds, ["failed-run"]);
  assert.equal(failed.campaign.cases[1]?.runId, undefined);
  assert.equal(failed.campaign.cases[1]?.jobId, undefined);

  campaign.execution.repeat!.resolved.resume = "all";
  const all = prepareSelectedCombineCampaignResume(campaign);
  assert.deepEqual(all.selectedCellIds, [
    campaign.cases[1]!.cellId,
    campaign.cases[2]!.cellId,
    campaign.cases[3]!.cellId,
    campaign.cases[4]!.cellId,
  ]);
  assert.deepEqual(all.retriedTerminalCellIds, [
    campaign.cases[1]!.cellId,
    campaign.cases[2]!.cellId,
    campaign.cases[3]!.cellId,
  ]);
});

test("terminal Repeat results cannot reopen without immutable Run evidence", () => {
  const campaign = fixture("failed");
  campaign.execution.repeat!.resolved.resume = "failed";
  campaign.cases[0]!.jobId = "failed-job";
  assert.throws(
    () => prepareSelectedCombineCampaignResume(campaign),
    /without immutable Run evidence/u,
  );
});

async function withDurableCampaignState(operation: () => Promise<void> | void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-campaign-recovery-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  resetDurableWorkerAssignmentStoreForTests();
  try {
    await operation();
  } finally {
    resetDurableWorkerAssignmentStoreForTests();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

function queueRecoveryAssignment(id: string) {
  return durableWorkerAssignmentStore().queue({
    id,
    projectId: "project-1",
    executionTarget: {
      schemaVersion: 1,
      kind: "local-device",
      provider: { key: "relay.local.agent-device", scope: "local" },
      targetId: "android-1",
      platform: "android",
      identity: { kind: "device-serial", value: "android-1" },
    },
    lane: { workerId: "local:android:target:android-1", capacity: 1 },
    queuedAt: 1_000,
  });
}

test("restart recovery returns an unclaimed queued Combine cell to the safe resume set", async () => {
  await withDurableCampaignState(() => {
    const campaign = fixture("passed");
    const coverage = campaign.cases[1]!;
    coverage.status = "queued";
    coverage.jobId = "queued-before-dispatch";
    campaign.status = "running";
    queueRecoveryAssignment(coverage.jobId);
    durableWorkerAssignmentStore().reconcileAfterRestart({
      workerInstanceId: "restart-after-queue",
      at: 2_000,
    });

    return projectCombineCampaign(campaign).then((projected) => {
      assert.equal(projected.cases[1]?.status, "pending");
      assert.equal(projected.cases[1]?.jobId, "queued-before-dispatch");
      assert.deepEqual(
        pendingSelectedCombineCampaignCells(projected).map((item) => item.cellId),
        [coverage.cellId],
      );
      assert.equal(projected.status, "ready-to-resume");
    });
  });
});

test("restart recovery blocks a Combine cell that had already begun execution", async () => {
  await withDurableCampaignState(() => {
    const campaign = fixture("passed");
    const coverage = campaign.cases[1]!;
    coverage.status = "queued";
    coverage.jobId = "executing-before-restart";
    campaign.status = "running";
    queueRecoveryAssignment(coverage.jobId);
    durableWorkerAssignmentStore().claimRunning(coverage.jobId, "server-before-restart", 1_100);
    durableWorkerAssignmentStore().reconcileAfterRestart({
      workerInstanceId: "restart-after-execution",
      at: 2_000,
    });

    return projectCombineCampaign(campaign).then((projected) => {
      assert.equal(projected.cases[1]?.status, "blocked");
      assert.match(projected.cases[1]?.error ?? "", /began execution/u);
      assert.equal(projected.status, "needs-review");
    });
  });
});
