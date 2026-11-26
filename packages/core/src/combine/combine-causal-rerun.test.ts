import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, Proposal } from "@relay/protocol";
import type { StoredCombineCampaign } from "./combine-campaign.js";
import { reconcileCausalCombineRerun } from "./combine-causal-rerun.js";

function campaign(): StoredCombineCampaign {
  const cell = (cellId: string, testId: string) => ({
    index: cellId === "affected" ? 0 : 1,
    cellId,
    testId,
    world: cellId,
    values: { language: cellId },
    targetProfileId: `profile-${cellId}`,
    childIntentDigest: `old-child-${cellId}`,
    outerIntentDigest: `old-outer-${cellId}`,
    wrapperGraphDigest: `old-wrapper-${cellId}`,
    staticInputDigest: `old-static-${cellId}`,
    phase: "coverage" as const,
    status: "passed" as const,
    jobId: `job-${cellId}`,
  });
  return {
    schemaVersion: 1,
    id: "campaign",
    projectId: "project",
    appMapId: "map",
    combineId: "combine",
    sourceRevision: 4,
    latestRevision: 4,
    status: "completed",
    createdAt: 1,
    updatedAt: 1,
    cases: [cell("affected", "settings"), cell("independent", "smoke")],
    lineage: [{ kind: "created", at: 1, appMapRevision: 4 }],
    execution: {
      selectedCellIds: ["affected", "independent"],
      seed: 1,
    },
  };
}

function repairProposal(): Proposal {
  return {
    organizationId: "local",
    projectId: "project",
    appMapId: "map",
    id: "repair-settings",
    title: "Repair Settings",
    status: "approved",
    baseRevision: 4,
    changes: [],
    repair: {
      kind: "retarget",
      testId: "settings",
      repairTargetIds: ["run:check"],
      sourceRunIds: ["run"],
      sourceCheckIds: ["usage"],
      evidenceFramePaths: ["frames/1.png"],
      equivalentDiffKey: "a".repeat(64),
      inverseChanges: [{ kind: "connection.update", connectionId: "usage", patch: {} }],
      approvedRevision: 5,
    },
    createdAt: 1,
    updatedAt: 2,
  };
}

test("approved repair reopens only causal Test cells and preserves independent results", () => {
  const input = campaign();
  const proposal = repairProposal();
  const map = {
    revision: 5,
    proposals: { [proposal.id]: proposal },
  } as AppMap;
  const result = reconcileCausalCombineRerun(input, map, [
    {
      cellId: "affected",
      testId: "settings",
      childIntentDigest: "new-child",
      outerIntentDigest: "new-outer",
      wrapperGraphDigest: "new-wrapper",
      staticInputDigest: "new-static",
    },
    {
      cellId: "independent",
      testId: "smoke",
      childIntentDigest: "other-child",
      outerIntentDigest: "other-outer",
      wrapperGraphDigest: "other-wrapper",
      staticInputDigest: "other-static",
    },
  ]);

  assert.deepEqual(result.proposalIds, ["repair-settings"]);
  assert.deepEqual(result.affectedCheckIds, ["usage"]);
  assert.deepEqual(result.affectedCellIds, ["affected"]);
  assert.deepEqual(
    result.campaign.cases.map((item) => ({
      id: item.cellId,
      status: item.status,
      jobId: item.jobId,
      outer: item.outerIntentDigest,
    })),
    [
      { id: "affected", status: "pending", jobId: undefined, outer: "new-outer" },
      {
        id: "independent",
        status: "passed",
        jobId: "job-independent",
        outer: "old-outer-independent",
      },
    ],
  );
});

test("unapproved and reverted proposals cannot reopen campaign cells", () => {
  const proposal = repairProposal();
  proposal.status = "pending";
  const pending = reconcileCausalCombineRerun(
    campaign(),
    { revision: 5, proposals: { pending: proposal } } as unknown as AppMap,
    [],
  );
  assert.deepEqual(pending.affectedCellIds, []);

  proposal.status = "approved";
  proposal.repair!.reverted = { actorId: "human", at: 3 };
  const reverted = reconcileCausalCombineRerun(
    campaign(),
    { revision: 6, proposals: { reverted: proposal } } as unknown as AppMap,
    [],
  );
  assert.deepEqual(reverted.affectedCellIds, []);
});
