import { canonicalSha256 } from "./canonical-json.js";

/** Stable identity for one authored cell under one execution profile. */
export function combineExecutionCaseId(input: { cellId: string; targetProfileId: string }): string {
  return `case:${canonicalSha256({
    cellId: input.cellId,
    targetProfileId: input.targetProfileId,
  }).slice("sha256:".length)}`;
}

/** Legacy campaigns use authored cell ids as their execution identity. */
export function combineCampaignCaseIdentity(caseItem: {
  cellId: string;
  executionCaseId?: string;
}): string {
  return caseItem.executionCaseId ?? caseItem.cellId;
}
