import type { CampaignCapacityCohortDurationEvidence } from "@relay/protocol";
import type {
  LocalCombineAdmissionDraft,
  LocalCombineAdmissionPreview,
} from "../lib/app-map-combine-admission";
import { LocalCampaignAdmission } from "./local-campaign-admission";

export type {
  LocalCombineAdmissionDraft,
  LocalCombineAdmissionPreview,
} from "../lib/app-map-combine-admission";

/** Combine's vocabulary wrapper around the shared evidence-only admission UI. */
export function AppMapCombineLocalAdmission(props: {
  bindingCount: number;
  cohortCount: number;
  cellCount: number;
  draft: LocalCombineAdmissionDraft;
  evidence: readonly CampaignCapacityCohortDurationEvidence[];
  preview?: LocalCombineAdmissionPreview;
  feedback?: string;
  busy?: boolean;
  loadingEvidence?: boolean;
  checking?: boolean;
  onDraftChange: (patch: Partial<LocalCombineAdmissionDraft>) => void;
  onRefreshEvidence: () => void;
  onPreflight: () => void;
}) {
  return (
    <LocalCampaignAdmission
      bindingCount={props.bindingCount}
      cohortCount={props.cohortCount}
      workItemCount={props.cellCount}
      workItemNoun={{ singular: "cell", plural: "cells" }}
      draft={props.draft}
      evidence={props.evidence}
      preview={props.preview}
      feedback={props.feedback}
      busy={props.busy}
      loadingEvidence={props.loadingEvidence}
      checking={props.checking}
      onDraftChange={props.onDraftChange}
      onRefreshEvidence={props.onRefreshEvidence}
      onPreflight={props.onPreflight}
    />
  );
}
