import { LocalCampaignAdmission } from "./local-campaign-admission";
import type { LocaleMatrixLocalAdmissionState } from "../lib/use-locale-matrix-local-admission";

/** Locale vocabulary wrapper around the shared read-only evidence/preflight UI. */
export function LocaleMatrixLocalAdmission(props: {
  admission: LocaleMatrixLocalAdmissionState;
  caseCount: number;
  busy?: boolean;
}) {
  return (
    <LocalCampaignAdmission
      bindingCount={props.admission.caseTargetBindings().length}
      cohortCount={props.admission.cohorts().length}
      workItemCount={props.caseCount}
      workItemNoun={{ singular: "locale case", plural: "locale cases" }}
      draft={props.admission.draft()}
      evidence={props.admission.evidence()}
      preview={props.admission.preview()}
      feedback={props.admission.feedback()}
      busy={props.busy}
      loadingEvidence={props.admission.loadingEvidence()}
      checking={props.admission.checking()}
      onDraftChange={props.admission.updateDraft}
      onRefreshEvidence={() => void props.admission.refreshEvidence()}
      onPreflight={() => void props.admission.checkCapacity()}
    />
  );
}
