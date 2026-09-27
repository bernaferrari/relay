import type { OperationInput } from "@relay/protocol";

type ProfileTargets = NonNullable<OperationInput<"job.combine.start">["profileTargets"]>;

type PairedCampaignCase = {
  executionCaseId?: string;
  testId?: string;
  targetProfileId?: string;
  target?: { targetId?: string };
  engine?: "chromium" | "firefox" | "webkit";
  account?:
    | { kind: "fixture"; accountId: string; accountRevision: string; reference?: string }
    | { kind: "signed-out"; attested: true };
  values?: Readonly<Record<string, string>>;
};

function selectedCases(
  selected: Readonly<Record<string, readonly string[]>>,
): Record<string, string>[] {
  return Object.entries(selected).reduce<Record<string, string>[]>(
    (cases, [id, values]) =>
      cases.flatMap((item) => values.map((value) => ({ ...item, [id]: value }))),
    [{}],
  );
}

export function validatePairedTargets(profileTargets: ProfileTargets): void {
  if (!profileTargets.length || profileTargets.length > 64) {
    throw new TypeError("Choose between 1 and 64 saved Browser and Account pairs.");
  }
  const identities = new Set<string>();
  for (const profile of profileTargets) {
    if (
      !profile.targetProfileId ||
      !profile.engine ||
      !profile.account ||
      !profile.target.browserTargetId
    ) {
      throw new TypeError("Each pair needs a saved Browser profile, engine, and account identity.");
    }
    const identity = JSON.stringify([
      profile.targetProfileId,
      profile.engine,
      profile.account,
      profile.target.browserTargetId,
    ]);
    if (identities.has(identity)) {
      throw new TypeError("The same Browser and Account pair is selected twice.");
    }
    identities.add(identity);
  }
}

/** The saved campaign is the source of truth; every requested pair and value
 * combination must appear once before the UI presents it as a successful start. */
export function assertPairedCampaignScope(
  cases: readonly PairedCampaignCase[],
  testId: string,
  selected: Readonly<Record<string, readonly string[]>>,
  profileTargets: ProfileTargets,
): void {
  const expected = selectedCases(selected).flatMap((values) =>
    profileTargets.map((profile) => ({ values, profile })),
  );
  if (cases.length !== expected.length) {
    throw new TypeError("The Batch case count differs from the selected data and Browser pairs.");
  }
  const remaining = [...cases];
  for (const { values, profile } of expected) {
    const index = remaining.findIndex((item) => {
      if (!item.executionCaseId || item.testId !== testId) return false;
      if (item.targetProfileId !== (profile.targetProfileId ?? profile.profileId)) return false;
      if (item.target?.targetId !== profile.target.browserTargetId) return false;
      if (item.engine !== profile.engine || item.account?.kind !== profile.account?.kind)
        return false;
      if (profile.account?.kind === "fixture") {
        if (item.account?.kind !== "fixture") return false;
        if (
          item.account.accountId !== profile.account.accountId ||
          item.account.accountRevision !== profile.account.accountRevision ||
          item.account.reference !== profile.account.reference
        )
          return false;
      }
      return Object.entries(values).every(([id, value]) => item.values?.[id] === value);
    });
    if (index < 0) {
      throw new TypeError("The Batch did not preserve an exact selected data and Browser pair.");
    }
    remaining.splice(index, 1);
  }
}
