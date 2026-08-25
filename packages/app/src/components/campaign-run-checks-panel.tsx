import { Show } from "solid-js";
import { createCampaignRepairActions } from "./runs-campaign-repair";
import { RunChecksPanel } from "./run-checks-panel";
import { Icon } from "./icon";
import { useServer, type JobInfo } from "../context/server";
import { toast } from "../context/toast";
import type { CampaignCheckResult } from "../lib/campaign-check-results";

export function CampaignRunChecksPanel(props: {
  job: JobInfo;
  frameSource: (frame: CampaignCheckResult["frames"][number]) => string;
  onOpenFrame: (index: number) => void;
  onOpenTest: (testId: string) => void;
}) {
  const server = useServer();
  const repair = createCampaignRepairActions({
    host: {
      runAction: (operationId, input) =>
        server.runAction(operationId as never, input as never) as Promise<unknown>,
      setSelectedJobId: server.setSelectedJobId,
      refreshJobs: server.refreshJobs,
    },
    onOpenTest: props.onOpenTest,
    toast,
  });
  return (
    <div class="grid gap-3">
      <Show when={repair.readyProposalTestId()}>
        {(testId) => (
          <button
            type="button"
            class="flex items-center justify-between gap-2 rounded-xl border border-border-interactive-base bg-surface-interactive-weak px-3.5 py-3 text-left transition-colors hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
            onClick={() => props.onOpenTest(testId())}
          >
            <span class="min-w-0">
              <strong class="block text-caption font-semibold text-text-strong">
                Repair proposal ready
              </strong>
              <span class="mt-0.5 block text-micro/[1.4] text-text-weak">
                Review and approve the proposed fix in the test editor.
              </span>
            </span>
            <Icon name="arrow-right" size={14} class="shrink-0 text-text-interactive-base" />
          </button>
        )}
      </Show>
      <RunChecksPanel
        job={props.job}
        frameSource={props.frameSource}
        onOpenFrame={props.onOpenFrame}
        onRetryCheck={
          props.job.persisted
            ? (checkId) => void repair.retryFailedCheck(props.job.id, checkId)
            : undefined
        }
        onRepairTest={props.job.persisted ? () => repair.repairTestFromRun(props.job) : undefined}
        onReviewNavigationRepair={
          props.job.persisted ? (entry) => void repair.reviewRepair(props.job, entry) : undefined
        }
        repairTarget={repair.repairTarget()}
        loadingRepairCheckId={repair.loadingRepairCheckId()}
        proposingRepairCheckId={repair.proposingRepairCheckId()}
        onLoadRepairOptions={
          props.job.persisted
            ? (checkId) => void repair.loadRepairTarget(props.job.id, checkId)
            : undefined
        }
        onProposeRepair={(action, reason) => void repair.proposeRepair(action, reason)}
        retryingCheckId={repair.repairingCheckId()}
      />
    </div>
  );
}
