import { Show } from "solid-js";
import type { AppMapCombinePreflight, CombineCampaign } from "@relay/protocol";
import type { AppMapCombineLocalAdmissionState } from "../lib/use-app-map-combine-local-admission";
import { AppMapCombineCampaign } from "./app-map-combine-campaign";
import { AppMapCombineLocalAdmission } from "./app-map-combine-local-admission";
import { AppMapCombinePreflightSummary } from "./app-map-combine-preflight";
import { Icon } from "./icon";

/** Fixed, related execution feedback kept out of the editor so target binding,
 * read-only admission, and durable campaign controls remain readable together. */
export function AppMapCombineRunStatus(props: {
  admission: AppMapCombineLocalAdmissionState;
  cellCount: number;
  issue?: string;
  preflight?: AppMapCombinePreflight;
  campaign?: CombineCampaign;
  reviewed: boolean;
  busy: boolean;
  onReviewed: (reviewed: boolean) => void;
  onOpenPilot: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <Show when={props.admission.localCampaignMode()}>
        <AppMapCombineLocalAdmission
          bindingCount={props.admission.cellTargetBindings().length}
          cohortCount={props.admission.cohorts().length}
          cellCount={props.cellCount}
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
      </Show>
      <Show when={props.issue}>
        <p class="m-0 flex items-start gap-2 rounded-lg bg-[var(--surface-base)] px-2.5 py-2 text-micro/[1.4] text-[var(--text-base)]">
          <Icon name="info" size={12} class="mt-0.5 shrink-0" /> {props.issue}
        </p>
      </Show>
      <Show when={props.preflight}>
        {(value) => <AppMapCombinePreflightSummary preflight={value()} />}
      </Show>
      <Show when={props.campaign}>
        {(campaign) => (
          <AppMapCombineCampaign
            campaign={campaign()}
            reviewed={props.reviewed}
            busy={props.busy}
            onReviewed={props.onReviewed}
            onOpenPilot={props.onOpenPilot}
            onResume={props.onResume}
            onCancel={props.onCancel}
          />
        )}
      </Show>
    </>
  );
}
