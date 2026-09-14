import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyCombineCampaignTriage,
  CombineCampaignTriageError,
  createCombineCampaign,
  combineCampaignUnsignedLaneId,
  findActiveCombineCampaignForCombine,
  findActiveRepeatCampaigns,
  pendingSelectedCombineCampaignCells,
  prepareSelectedCombineCampaignResume,
  projectCombineCampaign,
  readCombineCampaign,
  updateCombineCampaign,
  updateCombineCampaignTriage,
  type StoredCombineCampaign,
} from "./combine-campaign.js";
import {
  durableWorkerAssignmentStore,
  resetDurableWorkerAssignmentStoreForTests,
} from "./durable-worker-assignments.js";
import { combineExecutionCaseId } from "./combine-campaign-case-identity.js";

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
    assert.equal(combineCampaignUnsignedLaneId(read!), undefined);
    assert.equal(
      (await findActiveCombineCampaignForCombine("project-1", "settings", "languages"))?.id,
      "campaign-1",
    );
    assert.equal(
      await findActiveCombineCampaignForCombine("project-1", "settings", "languages", "grok-daily"),
      null,
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

test("triage assigns ownership and review status without changing execution status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-triage-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    const seeded = fixture("failed");
    await createCombineCampaign(seeded);
    const updated = await updateCombineCampaignTriage("project-1", "campaign-1", {
      caseIds: [seeded.cases[0]!.cellId],
      triageStatus: "investigating",
      assignee: "human:qa",
      actorId: "human:qa",
      now: 50,
    });
    assert.equal(updated.cases[0]?.status, "failed");
    assert.equal(updated.cases[0]?.triageStatus, "investigating");
    assert.equal(updated.cases[0]?.assignee, "human:qa");
    assert.equal(updated.cases[1]?.assignee, undefined);
    assert.equal(updated.lineage.at(-1)?.kind, "triaged");
    const cleared = applyCombineCampaignTriage(updated, {
      caseIds: [seeded.cases[0]!.cellId],
      assignee: "  ",
      actorId: "human:qa",
      now: 51,
    });
    assert.equal(cleared.cases[0]?.assignee, undefined);
    assert.equal(cleared.cases[0]?.triageStatus, "investigating");
    assert.throws(
      () =>
        applyCombineCampaignTriage(updated, {
          caseIds: ["missing-case"],
          triageStatus: "resolved",
          actorId: "human:qa",
          now: 52,
        }),
      (error: unknown) =>
        error instanceof CombineCampaignTriageError && error.code === "COMBINE_TRIAGE_UNKNOWN_CASE",
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

test("jobless preflight blocked cells are a completed Infra Result, not unfinished work", async () => {
  const campaign = fixture();
  campaign.status = "completed-with-problems";
  campaign.cases = campaign.cases.map((item) => ({
    ...item,
    status: "blocked",
    error: "ACCOUNT_NEEDS_RELOGIN: Open Sign-ins",
  }));
  const projected = await projectCombineCampaign(campaign);
  assert.equal(projected.status, "completed-with-problems");
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

test("explicit Repeat rerun scope retries only reviewed failure cells and preserves evidence lineage", () => {
  const campaign = fixture("passed");
  campaign.status = "completed-with-problems";
  campaign.execution.repeat!.resolved.resume = "untouched";
  campaign.cases[0] = {
    ...campaign.cases[0]!,
    status: "failed",
    jobId: "failed-job",
    runId: "failed-run",
  };
  campaign.cases[1] = {
    ...campaign.cases[1]!,
    status: "failed",
    jobId: "other-failed-job",
    runId: "other-failed-run",
  };

  const rerun = prepareSelectedCombineCampaignResume(campaign, {
    cellIds: [campaign.cases[1]!.cellId],
  });
  assert.deepEqual(rerun.selectedCellIds, [campaign.cases[1]!.cellId]);
  assert.deepEqual(rerun.retriedTerminalCellIds, [campaign.cases[1]!.cellId]);
  assert.equal(rerun.campaign.cases[0]?.status, "failed");
  assert.equal(rerun.campaign.cases[0]?.runId, "failed-run");
  assert.equal(rerun.campaign.cases[1]?.status, "pending");
  assert.equal(rerun.campaign.cases[1]?.runId, undefined);
  assert.deepEqual(rerun.campaign.cases[1]?.priorRunIds, ["other-failed-run"]);
  campaign.cases[0] = { ...campaign.cases[0]!, status: "passed" };
  assert.throws(
    () => prepareSelectedCombineCampaignResume(campaign, { cellIds: [campaign.cases[0]!.cellId] }),
    /only failed, blocked, or cancelled/u,
  );
});

test("expanded profile cases keep authored cell lineage while resuming by execution identity", () => {
  const campaign = fixture("passed");
  const authoredCell = campaign.cases[0]!.cellId;
  const first = combineExecutionCaseId({ cellId: authoredCell, targetProfileId: "profile-a" });
  const second = combineExecutionCaseId({ cellId: authoredCell, targetProfileId: "profile-b" });
  campaign.cases = [
    {
      ...campaign.cases[0]!,
      executionCaseId: first,
      status: "failed",
      jobId: "job-a",
      runId: "run-a",
    },
    {
      ...campaign.cases[0]!,
      index: 2,
      executionCaseId: second,
      status: "failed",
      jobId: "job-b",
      runId: "run-b",
    },
    campaign.cases[1]!,
  ];
  campaign.execution.selectedCellIds = [authoredCell, campaign.cases[2]!.cellId];
  campaign.execution.selectedExecutionCaseIds = [first, second];

  const resumed = prepareSelectedCombineCampaignResume(campaign, {
    executionCaseIds: [second],
  });
  assert.deepEqual(resumed.selectedExecutionCaseIds, [second]);
  assert.deepEqual(resumed.selectedCellIds, [authoredCell]);
  assert.equal(resumed.campaign.cases[0]?.status, "failed");
  assert.equal(resumed.campaign.cases[1]?.status, "pending");
  assert.equal(resumed.campaign.cases[1]?.cellId, authoredCell);
  assert.deepEqual(resumed.campaign.cases[1]?.priorRunIds, ["run-b"]);
});

test("expanded profile resume defaults to all selected execution cases and supports one-case retry", () => {
  const campaign = fixture("passed");
  const authoredCell = campaign.cases[0]!.cellId;
  const first = combineExecutionCaseId({ cellId: authoredCell, targetProfileId: "profile-a" });
  const second = combineExecutionCaseId({ cellId: authoredCell, targetProfileId: "profile-b" });
  campaign.cases = [
    { ...campaign.cases[0]!, executionCaseId: first, status: "pending" },
    { ...campaign.cases[0]!, index: 2, executionCaseId: second, status: "pending" },
  ];
  campaign.execution.selectedCellIds = [authoredCell];
  campaign.execution.selectedExecutionCaseIds = [first, second];
  const all = prepareSelectedCombineCampaignResume(campaign);
  assert.deepEqual(all.selectedExecutionCaseIds, [first, second]);
  assert.equal(
    all.campaign.cases.every((item) => item.status === "pending"),
    true,
  );

  const retryable = all.campaign.cases.map((item) => ({
    ...item,
    status: "failed" as const,
    jobId: `${item.executionCaseId}-job`,
    runId: `${item.executionCaseId}-run`,
  }));
  const one = prepareSelectedCombineCampaignResume(
    { ...all.campaign, cases: retryable },
    { executionCaseIds: [second] },
  );
  assert.deepEqual(one.selectedExecutionCaseIds, [second]);
  assert.equal(one.campaign.cases[0]?.status, "failed");
  assert.equal(one.campaign.cases[1]?.status, "pending");
});

test("one explicitly expanded profile keeps execution identity even without a collision", () => {
  const campaign = fixture("passed");
  const executionCaseId = combineExecutionCaseId({
    cellId: campaign.cases[0]!.cellId,
    targetProfileId: "profile-a",
  });
  campaign.cases[0] = { ...campaign.cases[0]!, executionCaseId, status: "pending" };
  campaign.execution.selectedExecutionCaseIds = [executionCaseId];
  const resumed = prepareSelectedCombineCampaignResume(campaign);
  assert.deepEqual(resumed.selectedExecutionCaseIds, [executionCaseId]);
  assert.deepEqual(resumed.selectedCellIds, [campaign.cases[0]!.cellId]);
});

test("legacy cases remain cell-selectable even if a persisted projection has execution selections", () => {
  const campaign = fixture("passed");
  campaign.execution.selectedExecutionCaseIds = [campaign.cases[0]!.cellId];
  campaign.cases[0] = {
    ...campaign.cases[0]!,
    status: "failed",
    jobId: "legacy-job",
    runId: "legacy-run",
  };
  const resumed = prepareSelectedCombineCampaignResume(campaign, {
    cellIds: [campaign.cases[0]!.cellId],
  });
  assert.deepEqual(resumed.selectedCellIds, [campaign.cases[0]!.cellId]);
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

test("expanded selective retries reject ambiguous authored cell scope", () => {
  const campaign = fixture("passed");
  campaign.cases[0] = { ...campaign.cases[0]!, executionCaseId: "case:profile-a" };
  campaign.execution.selectedExecutionCaseIds = ["case:profile-a"];
  assert.throws(
    () => prepareSelectedCombineCampaignResume(campaign, { cellIds: [campaign.cases[0]!.cellId] }),
    /execution case ids/u,
  );
});

test("active Combine lookup collides on one unsigned Lane and ignores the others", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-combine-unsigned-lane-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = directory;
  try {
    const daily = fixture();
    daily.execution.unsignedLaneId = "grok-daily";
    daily.status = "running";
    await createCombineCampaign(daily);
    const dailyB = fixture();
    dailyB.id = "campaign-2";
    dailyB.status = "running";
    dailyB.execution = { ...dailyB.execution, unsignedLaneId: "grok-daily-b" };
    await createCombineCampaign(dailyB);
    assert.equal(combineCampaignUnsignedLaneId(daily), "grok-daily");
    assert.equal(
      (
        await findActiveCombineCampaignForCombine(
          "project-1",
          "settings",
          "languages",
          "grok-daily",
        )
      )?.id,
      "campaign-1",
    );
    assert.equal(
      (
        await findActiveCombineCampaignForCombine(
          "project-1",
          "settings",
          "languages",
          "grok-daily-b",
        )
      )?.id,
      "campaign-2",
    );
    assert.equal(
      await findActiveCombineCampaignForCombine("project-1", "settings", "languages"),
      null,
    );
  } finally {
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
