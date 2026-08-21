import type {
  AppMapCombineCellTargetBinding,
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationCohort,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionPreflightResponse,
  LocalCampaignAdmissionWorkItem,
} from "@relay/protocol";
import { LOCAL_AGENT_DEVICE_PROVIDER_KEY } from "@relay/protocol";
import { combineCellTargetBindingFor } from "./app-map-combine-targets";

export type LocalCombineAdmissionDraft = {
  deadlineMinutes: string;
  setupHeadroomMinutes: string;
  recoveryHeadroomMinutes: string;
};

/** A host-readable name for the shared, generic read-only response. */
export type LocalCombineAdmissionPreview = LocalCampaignAdmissionPreflightResponse;

export type CombineAdmissionCell = {
  testId: string;
  values: Record<string, string>;
};

/** Exact protocol work item for the generic read-only admission endpoint. */
export type LocalCombineAdmissionWorkItem = LocalCampaignAdmissionWorkItem;

function cohortKey(cohort: CampaignCapacityDurationCohort): string {
  return `${cohort.platform}:${cohort.targetId}:${cohort.testId}:${cohort.action}`;
}

function localTargetForBinding(
  binding: AppMapCombineCellTargetBinding | undefined,
): LocalAgentDeviceExecutionTargetRef | undefined {
  const target = binding?.target;
  if (
    !target ||
    target.kind !== "local-device" ||
    (target.platform !== "android" && target.platform !== "ios") ||
    target.provider.key !== LOCAL_AGENT_DEVICE_PROVIDER_KEY ||
    target.provider.scope !== "local" ||
    target.identity.kind !== "device-serial" ||
    target.identity.value !== target.targetId
  ) {
    return undefined;
  }
  return structuredClone(target);
}

function workItemId(cell: CombineAdmissionCell): string {
  return `${cell.testId}:${JSON.stringify(
    Object.fromEntries(
      Object.entries(cell.values).sort(([left], [right]) => left.localeCompare(right)),
    ),
  )}`;
}

/** Stable action identity deliberately excludes an ephemeral wrapper/recipe
 * id, so an estimator follows a reviewed Test across a new Combine compile. */
export function combineAdmissionAction(appMapId: string, testId: string): string {
  return `app-map:${appMapId}:test:${testId}`;
}

/** Build exact target × Test/action timing cohorts from visible, explicitly
 * bound cells. It intentionally never fills a target from the selected device
 * or a runtime evidence profile. */
export function combineAdmissionCohorts(input: {
  appMapId: string;
  cells: readonly CombineAdmissionCell[];
  bindings: readonly AppMapCombineCellTargetBinding[];
}): CampaignCapacityDurationCohort[] {
  const cohorts = new Map<string, CampaignCapacityDurationCohort>();
  for (const cell of input.cells) {
    const binding = combineCellTargetBindingFor(input.bindings, cell);
    const target = localTargetForBinding(binding);
    if (!target) continue;
    const cohort: CampaignCapacityDurationCohort = {
      targetId: target.targetId,
      platform: target.platform,
      testId: cell.testId,
      action: combineAdmissionAction(input.appMapId, cell.testId),
    };
    cohorts.set(cohortKey(cohort), cohort);
  }
  return [...cohorts.values()].sort((left, right) =>
    cohortKey(left).localeCompare(cohortKey(right)),
  );
}

/** No partial preview: a missing/unsupported binding must be repaired before
 * a read-only check can look green for only a subset of selected cells. */
export function combineAdmissionWorkItems(input: {
  appMapId: string;
  cells: readonly CombineAdmissionCell[];
  bindings: readonly AppMapCombineCellTargetBinding[];
}): LocalCombineAdmissionWorkItem[] | undefined {
  const items: LocalCombineAdmissionWorkItem[] = [];
  const seen = new Set<string>();
  for (const cell of input.cells) {
    const target = localTargetForBinding(combineCellTargetBindingFor(input.bindings, cell));
    if (!target) return undefined;
    const id = workItemId(cell);
    if (seen.has(id)) return undefined;
    seen.add(id);
    items.push({
      id,
      target,
      testId: cell.testId,
      action: combineAdmissionAction(input.appMapId, cell.testId),
    });
  }
  return items;
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
export function localAdmissionRequestForCombine(input: {
  draft: LocalCombineAdmissionDraft;
  cohorts: readonly CampaignCapacityDurationCohort[];
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
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

  const expected = new Map(input.cohorts.map((cohort) => [cohortKey(cohort), cohort]));
  if (!expected.size) return { issue: "Bind each selected cell to a local Android or iOS target." };
  const byCohort = new Map<string, CampaignCapacityCohortDurationEvidence>();
  for (const rawEvidence of input.evidence) {
    const evidence = structuredClone(rawEvidence);
    const key = cohortKey(evidence.cohort);
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
  const missing = [...expected.values()].filter((cohort) => !byCohort.has(cohortKey(cohort)));
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
      durationEvidence: input.cohorts.map((cohort) => byCohort.get(cohortKey(cohort))!),
      ...(setupHeadroomMs === undefined ? {} : { setupHeadroomMs }),
      ...(recoveryHeadroomMs === undefined ? {} : { recoveryHeadroomMs }),
    },
  };
}
