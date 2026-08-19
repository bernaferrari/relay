import { RunChecksPanel } from "./run-checks-panel";
import { createCampaignRepairActions } from "./runs-campaign-repair";
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
  );
}
