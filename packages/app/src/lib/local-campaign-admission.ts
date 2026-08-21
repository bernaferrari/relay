import type {
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationCohort,
  LocalCampaignAdmissionPreflightResponse,
  LocalCampaignAdmissionRequest,
} from "@relay/protocol";

/** Human-entered deadline/reserves only. Execution timings come exclusively
 * from the server's immutable cohort estimator. */
export type LocalCampaignAdmissionDraft = {
  deadlineMinutes: string;
  setupHeadroomMinutes: string;
  recoveryHeadroomMinutes: string;
};

/** A host-readable name for the shared, generic read-only response. */
export type LocalCampaignAdmissionPreview = LocalCampaignAdmissionPreflightResponse;

export function campaignDurationCohortKey(cohort: CampaignCapacityDurationCohort): string {
  return `${cohort.platform}:${cohort.targetId}:${cohort.testId}:${cohort.action}`;
}

function wholeMinutes(
  value: string,
  label: string,
  required: boolean,
): number | undefined | string {
  const trimmed = value.trim();
  if (!trimmed) return required ? `${label} is required.` : undefined;
  if (!/^\d+$/.test(trimmed)) return `${label} must be a whole number of minutes.`;
  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes) || (required ? minutes <= 0 : minutes < 0)) {
    return required ? `${label} must be at least 1 minute.` : `${label} cannot be negative.`;
  }
  const milliseconds = minutes * 60_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : `${label} is too large.`;
}

/**
 * Make the exact shared protocol payload. Only evidence fetched from the
 * server estimator reaches this function; unknown or incomplete cohorts are
 * rejected instead of being silently pruned or replaced with a platform mean.
 */
export function localAdmissionRequestForCohorts(input: {
  draft: LocalCampaignAdmissionDraft;
  cohorts: readonly CampaignCapacityDurationCohort[];
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
  emptyCohortIssue?: string;
}): { request: LocalCampaignAdmissionRequest } | { issue: string } {
  const deadlineMs = wholeMinutes(input.draft.deadlineMinutes, "Deadline", true);
  if (typeof deadlineMs === "string" || deadlineMs === undefined) {
    return { issue: deadlineMs ?? "Deadline is required." };
  }
  const setupHeadroomMs = wholeMinutes(input.draft.setupHeadroomMinutes, "Setup reserve", false);
  if (typeof setupHeadroomMs === "string") return { issue: setupHeadroomMs };
  const recoveryHeadroomMs = wholeMinutes(
    input.draft.recoveryHeadroomMinutes,
    "Recovery reserve",
    false,
  );
  if (typeof recoveryHeadroomMs === "string") return { issue: recoveryHeadroomMs };

  const expected = new Map(
    input.cohorts.map((cohort) => [campaignDurationCohortKey(cohort), cohort]),
  );
  if (!expected.size) {
    return {
      issue: input.emptyCohortIssue ?? "Bind each selected cell to a local Android or iOS target.",
    };
  }
  const byCohort = new Map<string, CampaignCapacityCohortDurationEvidence>();
  for (const rawEvidence of input.evidence) {
    const evidence = structuredClone(rawEvidence);
    const key = campaignDurationCohortKey(evidence.cohort);
    if (!expected.has(key)) {
      return {
        issue: "Timing evidence no longer matches the selected target bindings. Refresh it.",
      };
    }
    if (byCohort.has(key)) {
      return { issue: "Timing evidence contains a duplicate target/Test cohort. Refresh it." };
    }
    byCohort.set(key, evidence);
  }
  const missing = [...expected.values()].filter(
    (cohort) => !byCohort.has(campaignDurationCohortKey(cohort)),
  );
  if (missing.length) {
    return {
      issue:
        missing.length === 1
          ? `No measured timing evidence is available for ${missing[0]!.targetId} · ${missing[0]!.testId}.`
          : `Measured timing evidence is missing for ${missing.length} target/Test cohorts.`,
    };
  }
  return {
    request: {
      deadlineMs,
      durationEvidence: input.cohorts.map((cohort) =>
        byCohort.get(campaignDurationCohortKey(cohort))!,
      ),
      ...(setupHeadroomMs === undefined ? {} : { setupHeadroomMs }),
      ...(recoveryHeadroomMs === undefined ? {} : { recoveryHeadroomMs }),
    },
  };
}
