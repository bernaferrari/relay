import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCombineCampaign,
  projectCombineCampaign,
  readCombineCampaign,
  updateCombineCampaign,
  type StoredCombineCampaign,
} from "./combine-campaign.js";

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
      { index: 0, world: "English", values: { language: "en" }, phase: "pilot", status },
      {
        index: 1,
        world: "Italian",
        values: { language: "it" },
        phase: "coverage",
        status: "pending",
      },
    ],
    lineage: [{ kind: "created", at: 10, appMapRevision: 7, actorId: "agent:test" }],
    execution: { selected: { language: ["en", "it"] }, strategy: "zip", seed: 42 },
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

test("a failed pilot requires review while untouched cases remain pending", async () => {
  const campaign = fixture("failed");
  const projected = await projectCombineCampaign(campaign);
  assert.equal(projected.status, "needs-review");
  assert.equal(projected.cases[1]?.status, "pending");
});
