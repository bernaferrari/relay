import { Show, createMemo } from "solid-js";
import type { CampaignRepairAction, CampaignRepairTarget } from "@relay/protocol";
import { useServer } from "../context/server";
import type { JobInfo } from "../lib/api-types";
import type { CampaignCheckResult } from "../lib/campaign-check-results";
import type { NavigationTransitionRepairEntry } from "../lib/navigation-transition-health";
import { CampaignCheckResults } from "./campaign-check-results";
import { EvidenceList } from "./run-evidence-panels";

const EVALUATION_KINDS = new Set([
  "response-completion",
  "conversation-turn",
  "content-assertion",
  "semantic-evaluation",
  "judge-consensus",
  "frozen-inputs",
  "app-build",
]);

export function RunChecksPanel(props: {
  job: JobInfo;
  frameSource: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame: (index: number) => void;
  onRetryCheck?: (checkId: string) => void;
  onRepairTest?: (checkId: string) => void;
  onReviewNavigationRepair?: (repair: NavigationTransitionRepairEntry) => void;
  repairTarget?: CampaignRepairTarget;
  loadingRepairCheckId?: string;
  proposingRepairCheckId?: string;
  onLoadRepairOptions?: (checkId: string) => void;
  onProposeRepair?: (action: CampaignRepairAction, reason: string) => void;
  retryingCheckId?: string;
}) {
  const server = useServer();
  const evaluation = createMemo(() =>
    (props.job.artifacts ?? []).filter((item) => EVALUATION_KINDS.has(item.kind)),
  );
  const hasCampaignChecks = () =>
    Boolean(props.job.checks?.length) ||
    Boolean(props.job.artifacts?.some((item) => item.kind === "campaign-check-result"));
  return (
    <div class="grid gap-4">
      <CampaignCheckResults
        job={props.job}
        frameSource={props.frameSource}
        onOpenFrame={props.onOpenFrame}
        onRetryCheck={props.onRetryCheck}
        onRepairTest={props.onRepairTest}
        onReviewNavigationRepair={props.onReviewNavigationRepair}
        repairTarget={props.repairTarget}
        loadingRepairCheckId={props.loadingRepairCheckId}
        proposingRepairCheckId={props.proposingRepairCheckId}
        onLoadRepairOptions={props.onLoadRepairOptions}
        onProposeRepair={props.onProposeRepair}
        onResume={(jobId) => void server.resumeJob(jobId)}
        retryingCheckId={props.retryingCheckId}
      />
      <Show when={evaluation().length > 0 || !hasCampaignChecks()}>
        <EvidenceList
          items={evaluation()}
          empty="No checks on this run. Add a screen or text check when you edit the path, then run again."
        />
      </Show>
    </div>
  );
}
