import { describe, expect, it } from "vitest";
import {
  groupComparableStabilitySamples,
  stabilityCohortKey,
  type StabilityCohortSample,
} from "./stability-cohort";

function sample(
  id: string,
  extra: Partial<StabilityCohortSample> = {},
): StabilityCohortSample & {
  id: string;
} {
  return {
    id,
    testId: "checkout",
    testRevision: "12",
    buildId: "build-92",
    targetProfileId: "chrome-admin",
    accountId: "acct-admin",
    dataSetId: "default",
    startupMode: "warm",
    ...extra,
  };
}

describe("stability cohorts", () => {
  it("refuses a cohort key when revision, build, target, account, data, or start state is missing", () => {
    expect(stabilityCohortKey(sample("run-1", { buildId: undefined }))).toBeUndefined();
    expect(stabilityCohortKey(sample("run-1", { accountId: undefined }))).toBeUndefined();
    expect(stabilityCohortKey(sample("run-1"))).toContain("checkout");
  });

  it("groups only samples that share the full comparable identity", () => {
    const groups = groupComparableStabilitySamples([
      sample("run-1"),
      sample("run-2"),
      sample("run-3", { buildId: "build-93" }),
    ]);
    expect([...groups.values()].map((group) => group.map((item) => item.id))).toEqual([
      ["run-1", "run-2"],
      ["run-3"],
    ]);
  });
});
