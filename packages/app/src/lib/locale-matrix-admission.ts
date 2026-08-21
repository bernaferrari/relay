import type {
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationCohort,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionWorkItem,
  LocaleMatrixCase,
  LocaleMatrixDurationCohort,
} from "@relay/protocol";
import { LOCAL_AGENT_DEVICE_PROVIDER_KEY } from "@relay/protocol";
import {
  campaignDurationCohortKey,
  localAdmissionRequestForCohorts,
  type LocalCampaignAdmissionDraft,
} from "./local-campaign-admission";

/** One target assignment for one frozen generated case. `caseIndex`, rather
 * than locale text, is authoritative because a final restore may repeat a
 * locale that appeared earlier in the matrix. */
export type LocaleMatrixCaseTargetBinding = {
  caseIndex: number;
  locale: string;
  executionTarget: LocalAgentDeviceExecutionTargetRef;
};

export type LocaleMatrixAdmissionSelection = {
  cohorts: CampaignCapacityDurationCohort[];
  workItems: LocalCampaignAdmissionWorkItem[];
  bindings: LocaleMatrixCaseTargetBinding[];
};

export type LocaleMatrixAdmissionRequestSelection = LocaleMatrixAdmissionSelection & {
  request: LocalCampaignAdmissionRequest;
};

function localTargetForBinding(
  binding: LocaleMatrixCaseTargetBinding | undefined,
): LocalAgentDeviceExecutionTargetRef | undefined {
  const target = binding?.executionTarget;
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

/** A case lookup is intentionally strict: stale locale text or duplicate rows
 * makes the binding unusable instead of picking the first target. */
export function localeMatrixCaseTargetBindingFor(
  bindings: readonly LocaleMatrixCaseTargetBinding[],
  item: LocaleMatrixCase,
): LocaleMatrixCaseTargetBinding | undefined {
  const matches = bindings.filter((binding) => binding.caseIndex === item.caseIndex);
  const binding = matches.length === 1 ? matches[0] : undefined;
  return binding?.locale === item.locale ? binding : undefined;
}

/** Selecting an empty row removes only that row. It never fills sibling cases,
 * including same-language restore rows, from a selected device or nearby case. */
export function upsertLocaleMatrixCaseTargetBinding(
  bindings: readonly LocaleMatrixCaseTargetBinding[],
  item: LocaleMatrixCase,
  executionTarget?: LocalAgentDeviceExecutionTargetRef,
): LocaleMatrixCaseTargetBinding[] {
  const remaining = bindings.filter((binding) => binding.caseIndex !== item.caseIndex);
  if (!executionTarget) return remaining;
  return [
    ...remaining,
    {
      caseIndex: item.caseIndex,
      locale: item.locale,
      executionTarget: structuredClone(executionTarget),
    },
  ];
}

/** Retain only valid bindings for the current materialized plan, preserving
 * canonical case order so transport output is deterministic and reviewable. */
export function bindingsForLocaleMatrixCases(
  bindings: readonly LocaleMatrixCaseTargetBinding[],
  cases: readonly LocaleMatrixCase[],
): LocaleMatrixCaseTargetBinding[] {
  return cases.flatMap((item) => {
    const binding = localeMatrixCaseTargetBindingFor(bindings, item);
    return binding ? [structuredClone(binding)] : [];
  });
}

export function localeMatrixAdmissionCohorts(input: {
  cases: readonly LocaleMatrixCase[];
  bindings: readonly LocaleMatrixCaseTargetBinding[];
  durationCohort: LocaleMatrixDurationCohort;
}): CampaignCapacityDurationCohort[] {
  const cohorts = new Map<string, CampaignCapacityDurationCohort>();
  for (const item of input.cases) {
    const target = localTargetForBinding(localeMatrixCaseTargetBindingFor(input.bindings, item));
    if (!target) continue;
    const cohort: CampaignCapacityDurationCohort = {
      targetId: target.targetId,
      platform: target.platform,
      testId: input.durationCohort.testId,
      action: input.durationCohort.action,
    };
    cohorts.set(campaignDurationCohortKey(cohort), cohort);
  }
  return [...cohorts.values()].sort((left, right) =>
    campaignDurationCohortKey(left).localeCompare(campaignDurationCohortKey(right)),
  );
}

/** No partial preflight: every exact materialized case needs its own valid
 * target assignment even when some cases share a locale or device. */
export function localeMatrixAdmissionWorkItems(input: {
  cases: readonly LocaleMatrixCase[];
  bindings: readonly LocaleMatrixCaseTargetBinding[];
  durationCohort: LocaleMatrixDurationCohort;
}): LocalCampaignAdmissionWorkItem[] | undefined {
  const workItems: LocalCampaignAdmissionWorkItem[] = [];
  const seen = new Set<number>();
  for (const item of input.cases) {
    const target = localTargetForBinding(localeMatrixCaseTargetBindingFor(input.bindings, item));
    if (!target || seen.has(item.caseIndex)) return undefined;
    seen.add(item.caseIndex);
    workItems.push({
      id: `locale:${item.caseIndex}`,
      target,
      testId: input.durationCohort.testId,
      action: input.durationCohort.action,
    });
  }
  return workItems.length === input.cases.length ? workItems : undefined;
}

export function localeMatrixAdmissionSelection(input: {
  cases: readonly LocaleMatrixCase[];
  bindings: readonly LocaleMatrixCaseTargetBinding[];
  durationCohort: LocaleMatrixDurationCohort;
}): LocaleMatrixAdmissionSelection | { issue: string } {
  if (!input.cases.length) return { issue: "The materialized locale plan has no cases." };
  const bindings = bindingsForLocaleMatrixCases(input.bindings, input.cases);
  const workItems = localeMatrixAdmissionWorkItems({ ...input, bindings });
  if (!workItems) {
    return {
      issue:
        "Bind every materialized locale case, including any final restore, to an attached local Android or iOS target.",
    };
  }
  const cohorts = localeMatrixAdmissionCohorts({ ...input, bindings });
  if (!cohorts.length)
    return { issue: "No coherent local Android or iOS target cohorts are selected." };
  return { cohorts, workItems, bindings };
}

/** Build a deadline request only from server-derived evidence for exactly the
 * frozen materialized cases and their target bindings. */
export function localAdmissionRequestForLocaleMatrix(input: {
  draft: LocalCampaignAdmissionDraft;
  cohorts: readonly CampaignCapacityDurationCohort[];
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
}): { request: LocalCampaignAdmissionRequest } | { issue: string } {
  return localAdmissionRequestForCohorts({
    ...input,
    emptyCohortIssue: "Bind each materialized locale case to a local Android or iOS target.",
  });
}
