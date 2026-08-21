import type {
  AppMapCombineCellTargetBinding,
  CampaignCapacityCohortDurationEvidence,
  CampaignCapacityDurationCohort,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionWorkItem,
} from "@relay/protocol";
import { LOCAL_AGENT_DEVICE_PROVIDER_KEY } from "@relay/protocol";
import { combineCellTargetBindingFor } from "./app-map-combine-targets";
import {
  campaignDurationCohortKey,
  localAdmissionRequestForCohorts,
  type LocalCampaignAdmissionDraft,
  type LocalCampaignAdmissionPreview,
} from "./local-campaign-admission";

export {
  localAdmissionRequestForCohorts,
  type LocalCampaignAdmissionDraft,
  type LocalCampaignAdmissionPreview,
} from "./local-campaign-admission";

export type LocalCombineAdmissionDraft = LocalCampaignAdmissionDraft;

/** A host-readable name for the shared, generic read-only response. */
export type LocalCombineAdmissionPreview = LocalCampaignAdmissionPreview;

export type CombineAdmissionCell = {
  testId: string;
  values: Record<string, string>;
};

/** Exact protocol work item for the generic read-only admission endpoint. */
export type LocalCombineAdmissionWorkItem = LocalCampaignAdmissionWorkItem;

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
    cohorts.set(campaignDurationCohortKey(cohort), cohort);
  }
  return [...cohorts.values()].sort((left, right) =>
    campaignDurationCohortKey(left).localeCompare(campaignDurationCohortKey(right)),
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

/** Combine keeps its established vocabulary while locale matrices and future
 * target-affine workflows reuse the same evidence-only request builder. */
export function localAdmissionRequestForCombine(input: {
  draft: LocalCombineAdmissionDraft;
  cohorts: readonly CampaignCapacityDurationCohort[];
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
}): { request: LocalCampaignAdmissionRequest } | { issue: string } {
  return localAdmissionRequestForCohorts(input);
}
