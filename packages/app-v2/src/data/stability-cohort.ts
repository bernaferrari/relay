/** Fields that must be known and equal before mixed outcomes can be called flaky. */
export const STABILITY_COHORT_FIELDS = [
  "testId",
  "testRevision",
  "buildId",
  "targetProfileId",
  "accountId",
  "dataSetId",
  "startupMode",
] as const;

export type StabilityCohortField = (typeof STABILITY_COHORT_FIELDS)[number];

export type StabilityCohortSample = {
  readonly testId?: string;
  readonly testRevision?: string | number;
  readonly buildId?: string;
  readonly targetProfileId?: string;
  readonly accountId?: string;
  readonly dataSetId?: string;
  readonly startupMode?: string;
};

export function stabilityCohortKey(sample: StabilityCohortSample): string | undefined {
  const values = STABILITY_COHORT_FIELDS.map((field) => sample[field]);
  if (values.some((value) => value === undefined || value === "")) return undefined;
  return values.join("\u0000");
}

export function groupComparableStabilitySamples<T extends StabilityCohortSample>(
  samples: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const sample of samples) {
    const key = stabilityCohortKey(sample);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return groups;
}
