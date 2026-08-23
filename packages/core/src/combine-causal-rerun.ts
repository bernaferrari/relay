import type { AppMap } from "@relay/protocol";
import type { StoredCombineCampaign } from "./combine-campaign.js";

export type PreparedCombineCellContract = {
  cellId: string;
  testId: string;
  childIntentDigest: string;
  outerIntentDigest: string;
  wrapperGraphDigest: string;
  staticInputDigest: string;
};

export type CausalCombineRerun = {
  campaign: StoredCombineCampaign;
  proposalIds: string[];
  affectedCheckIds: string[];
  affectedCellIds: string[];
};

/** Reopen only cells whose saved Test was changed by an approved, unreverted
 * repair proposal after this campaign's last compiled revision. The proposal
 * already carries exact Test/check lineage from immutable failure evidence;
 * unrelated revisions and direct edits receive no exemption from the normal
 * digest mismatch guard. */
export function reconcileCausalCombineRerun(
  campaign: StoredCombineCampaign,
  map: AppMap,
  preparedCells: readonly PreparedCombineCellContract[],
): CausalCombineRerun {
  const repairs = Object.values(map.proposals)
    .filter(
      (proposal) =>
        proposal.status === "approved" &&
        proposal.repair?.approvedRevision !== undefined &&
        proposal.repair.approvedRevision > campaign.latestRevision &&
        proposal.repair.approvedRevision <= map.revision &&
        proposal.repair.reverted === undefined,
    )
    .sort(
      (left, right) =>
        left.repair!.approvedRevision! - right.repair!.approvedRevision! ||
        left.id.localeCompare(right.id),
    );
  const affectedTestIds = new Set(repairs.map((proposal) => proposal.repair!.testId));
  const preparedById = new Map(preparedCells.map((cell) => [cell.cellId, cell]));
  const selected = new Set(campaign.execution.selectedCellIds);
  const affectedCellIds: string[] = [];
  const changedTestIds = new Set<string>();
  const cases = campaign.cases.map((item) => {
    if (!affectedTestIds.has(item.testId)) return item;
    const prepared = preparedById.get(item.cellId);
    if (!prepared || prepared.testId !== item.testId) return item;
    if (
      prepared.childIntentDigest === item.childIntentDigest &&
      prepared.outerIntentDigest === item.outerIntentDigest &&
      prepared.wrapperGraphDigest === item.wrapperGraphDigest &&
      prepared.staticInputDigest === item.staticInputDigest
    ) {
      return item;
    }
    affectedCellIds.push(item.cellId);
    changedTestIds.add(item.testId);
    const { jobId: _jobId, error: _error, ...stable } = item;
    return {
      ...stable,
      childIntentDigest: prepared.childIntentDigest,
      outerIntentDigest: prepared.outerIntentDigest,
      wrapperGraphDigest: prepared.wrapperGraphDigest,
      staticInputDigest: prepared.staticInputDigest,
      status: selected.has(item.cellId) ? ("pending" as const) : item.status,
    };
  });
  const contributingRepairs = repairs.filter((proposal) =>
    changedTestIds.has(proposal.repair!.testId),
  );
  return {
    campaign: { ...campaign, cases },
    proposalIds: contributingRepairs.map((proposal) => proposal.id),
    affectedCheckIds: [
      ...new Set(contributingRepairs.flatMap((proposal) => proposal.repair!.sourceCheckIds)),
    ].sort(),
    affectedCellIds: affectedCellIds.sort(),
  };
}
