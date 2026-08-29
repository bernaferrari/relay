import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { createCombineCampaign, persistRun } from "@relay/core";
import type { CombineCampaign } from "@relay/protocol";
import type { TestJob } from "@relay/core";
import { startServer } from "./index.js";

function failedRun(id: string, error: string): TestJob {
  const at = Date.now();
  return {
    id,
    action: "app-map:settings",
    platform: "android",
    targetContext: { kind: "device", platform: "android", serial: "android-1" },
    targetKind: "device",
    status: "error",
    queuedAt: at - 20,
    startedAt: at - 10,
    finishedAt: at,
    logs: ["failed"],
    attempts: 1,
    steps: [],
    frames: [],
    artifacts: [
      {
        kind: "campaign-check-result",
        capturedAt: at,
        data: {
          id: "check-settings",
          title: "Settings check",
          status: "failed",
          error,
          startedAt: at - 10,
          finishedAt: at,
        },
      },
    ],
    glyphs: [],
    kind: "Replay",
    tone: "acc",
    title: "Settings check",
    resolvedInputs: {},
    sensitiveInputNames: [],
    evidencePolicy: { schemaVersion: 1, sensitive: {} },
  };
}

test("campaign continuation rejects a changed App Map before scheduling untouched cases", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-combine-campaign-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    await createCombineCampaign({
      schemaVersion: 1,
      id: "campaign-1",
      projectId: "android",
      ownerId: "human:test",
      appMapId: "settings",
      combineId: "locales",
      sourceRevision: 4,
      latestRevision: 4,
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
          status: "passed",
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
      lineage: [{ kind: "created", at: 10, appMapRevision: 4, actorId: "human:test" }],
      execution: {
        selected: { language: ["en", "it"] },
        selectedCellIds: ["c" + "a".repeat(32), "c" + "b".repeat(32)],
        strategy: "zip",
        seed: 42,
        repeat: {
          schemaVersion: 1,
          requestedAppMapRevision: 3,
          executionAppMapRevision: 4,
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
    });
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "android",
      actorId: "human:test",
      actorKind: "human",
    });

    const before = await client.invoke("job.combine.campaign.get", { batchId: "campaign-1" });
    const beforeCampaign = before.campaign as CombineCampaign;
    assert.equal(beforeCampaign.status, "ready-to-resume");
    assert.equal(beforeCampaign.cases[1]?.status, "pending");
    const adopted = await client.invoke("job.combine.campaign.repeat.active", {
      appMapId: "settings",
      testId: "settings",
    });
    assert.equal(adopted.campaign?.id, "campaign-1");
    assert.equal(adopted.campaign?.execution?.repeat?.evidence, "visual");
    await client.invoke("app-map.create", { appMapId: "settings", name: "Settings" });
    const jobsBeforeResume = await client.invoke("job.list", { limit: 100 });
    const leasesBeforeResume = await client.invoke("lease.list", { status: "all" });
    await assert.rejects(
      client.invoke("job.combine.campaign.resume", {
        batchId: "campaign-1",
        expectedAppMapRevision: 4,
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code === "revision-conflict" &&
        (error.body as { currentRevision?: unknown }).currentRevision === 0,
    );
    const jobsAfterResume = await client.invoke("job.list", { limit: 100 });
    const leasesAfterResume = await client.invoke("lease.list", { status: "all" });
    assert.equal(jobsAfterResume.jobs.length, jobsBeforeResume.jobs.length);
    assert.equal(leasesAfterResume.leases.length, leasesBeforeResume.leases.length);

    const cancelled = await client.invoke("job.combine.campaign.cancel", {
      batchId: "campaign-1",
    });
    const cancelledCampaign = cancelled.campaign as CombineCampaign;
    assert.equal(cancelledCampaign.status, "cancelled");
    assert.equal(cancelledCampaign.cases[1]?.status, "cancelled");
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Repeat failure clusters expose immutable member evidence and deterministic filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-repeat-clusters-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    await persistRun(failedRun("run-en", "Content assertion: expected title"));
    await persistRun(failedRun("run-pt", "Content assertion: expected title"));
    await createCombineCampaign({
      schemaVersion: 1,
      id: "repeat-clusters",
      projectId: "android",
      ownerId: "human:test",
      appMapId: "settings",
      combineId: "locales",
      sourceRevision: 1,
      latestRevision: 1,
      status: "completed-with-problems",
      createdAt: 1,
      updatedAt: 1,
      cases: [
        {
          index: 0,
          cellId: "cell-en",
          testId: "settings",
          world: "English",
          values: { language: "en" },
          targetProfileId: "android-1",
          childIntentDigest: "a",
          outerIntentDigest: "b",
          wrapperGraphDigest: "c",
          staticInputDigest: "d",
          phase: "coverage",
          status: "failed",
          jobId: "run-en",
          runId: "run-en",
        },
        {
          index: 1,
          cellId: "cell-pt",
          testId: "settings",
          world: "Português",
          values: { language: "pt-BR" },
          targetProfileId: "android-1",
          childIntentDigest: "a",
          outerIntentDigest: "b",
          wrapperGraphDigest: "c",
          staticInputDigest: "d",
          phase: "coverage",
          status: "failed",
          jobId: "run-pt",
          runId: "run-pt",
        },
      ],
      lineage: [],
      execution: { selectedCellIds: ["cell-en", "cell-pt"], seed: 1 },
    });
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "android",
      actorId: "human:test",
      actorKind: "human",
    });
    const result = await client.invoke("job.combine.campaign.repeat.clusters", {
      batchId: "repeat-clusters",
      cohort: "android-1",
      failureKind: "causal",
    });
    assert.equal(result.campaignId, "repeat-clusters");
    assert.equal(result.clusters.length, 1);
    assert.deepEqual(
      result.clusters[0]?.cases.map((item) => [item.cellId, item.runId]),
      [
        ["cell-en", "run-en"],
        ["cell-pt", "run-pt"],
      ],
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
