import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  persistAccountReloginPlanResult,
  readAccountReloginFindings,
} from "./plan-account-relogin-campaign.js";
import {
  findActiveCombineCampaignForCombine,
  projectCombineCampaign,
  readCombineCampaign,
} from "./combine-campaign.js";
import { analyzeCombineEvidenceBatch } from "./combine-evidence-pack.js";

test("expired account persist is one Infra Result, not unfinished work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-account-relogin-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  process.env.RELAY_STATE_DIR = directory;
  process.env.RELAY_RUNS_DIR = join(directory, "runs");
  try {
    const persisted = await persistAccountReloginPlanResult({
      projectId: "project-1",
      ownerId: "human:qa",
      appMapId: "grok-web",
      combineId: "grok-web-daily",
      appMapRevision: 56,
      testIds: ["open-home", "send-hello"],
      targetProfileId: "grok-com",
      detail: "Member expired. Open Sign-ins, complete OAuth, then Refresh.",
      account: { kind: "fixture", accountId: "acct-member", accountRevision: "7" },
      target: { kind: "browser", id: "grok-com", platform: "browser" },
    });
    assert.equal(persisted.findings.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
    assert.equal(persisted.findings.batchId, persisted.batchId);
    const campaign = await readCombineCampaign("project-1", persisted.batchId);
    assert.ok(campaign);
    assert.equal(campaign.status, "completed-with-problems");
    assert.equal(campaign.cases.length, 2);
    assert.ok(campaign.cases.every((item) => item.status === "blocked" && !item.jobId));
    const projected = await projectCombineCampaign(campaign);
    assert.equal(projected.status, "completed-with-problems");
    assert.equal(
      await findActiveCombineCampaignForCombine("project-1", "grok-web", "grok-web-daily"),
      null,
    );
    const sidecar = await readAccountReloginFindings(persisted.batchId);
    assert.equal(sidecar?.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
    const report = await analyzeCombineEvidenceBatch(persisted.batchId);
    assert.equal(report.analysis.findings[0]?.code, "ACCOUNT_NEEDS_RELOGIN");
    assert.equal(report.analysis.findings.length, 1);
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(directory, { recursive: true, force: true });
  }
});
