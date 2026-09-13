import { canonicalSha256 } from "./canonical-json.js";

export type CombineExecutionAccount =
  | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
  | { kind: "signed-out"; attested: true };

/** Stable identity for one authored cell under one execution profile. */
export function combineExecutionCaseId(input: {
  cellId: string;
  targetProfileId: string;
  engine?: string;
  account?: CombineExecutionAccount;
}): string {
  return `case:${canonicalSha256({
    cellId: input.cellId,
    targetProfileId: input.targetProfileId,
    ...(input.engine ? { engine: input.engine } : {}),
    ...(input.account ? { account: input.account } : {}),
  }).slice("sha256:".length)}`;
}

/** Same cell on the same environment with different accounts must not collide. */
export function combineProfileTargetExecutionCaseId(
  cellId: string,
  profileTarget: {
    profileId: string;
    engine?: string;
    account?: CombineExecutionAccount;
  },
): string {
  return combineExecutionCaseId({
    cellId,
    targetProfileId: profileTarget.profileId,
    ...(profileTarget.engine ? { engine: profileTarget.engine } : {}),
    ...(profileTarget.account ? { account: profileTarget.account } : {}),
  });
}

/** Legacy campaigns use authored cell ids as their execution identity. */
export function combineCampaignCaseIdentity(caseItem: {
  cellId: string;
  executionCaseId?: string;
}): string {
  return caseItem.executionCaseId ?? caseItem.cellId;
}
