import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { createCombineCampaign } from "@relay/core";
import type { CombineCampaign } from "@relay/protocol";
import { startServer } from "./index.js";

test("campaign routes preserve untouched cases and cancel without scheduling them", async () => {
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
          world: "English",
          values: { language: "en" },
          phase: "pilot",
          status: "passed",
        },
        {
          index: 1,
          world: "Italian",
          values: { language: "it" },
          phase: "coverage",
          status: "pending",
        },
      ],
      lineage: [{ kind: "created", at: 10, appMapRevision: 4, actorId: "human:test" }],
      execution: { selected: { language: ["en", "it"] }, strategy: "zip", seed: 42 },
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
    const jobsBeforeResume = await client.invoke("job.list", { limit: 100 });
    const leasesBeforeResume = await client.invoke("lease.list", { status: "all" });
    await assert.rejects(
      client.invoke("job.combine.campaign.resume", { batchId: "campaign-1" }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { code?: unknown }).code ===
          "APP_MAP_COMBINE_RUNTIME_PROFILE_CONTRACT_REQUIRED",
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
