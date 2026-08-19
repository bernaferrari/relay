import { createSignal } from "solid-js";
import type { JobInfo } from "../lib/api-types";
import type { NavigationTransitionRepairEntry } from "../lib/navigation-transition-health";
import { humanError } from "../lib/human-error";

type RunCampaignRepairHost = {
  runAction: (operationId: string, input: unknown) => Promise<{ job?: { id?: unknown } }>;
  setSelectedJobId: (id: string | null) => void;
  refreshJobs: () => unknown;
};

export function createCampaignRepairActions(options: {
  host: RunCampaignRepairHost;
  onOpenTest: (testId: string) => void;
  toast: (message: string, tone: "success" | "error" | "warning") => void;
}) {
  const [repairingCheckId, setRepairingCheckId] = createSignal<string | undefined>();

  async function retryFailedCheck(runId: string, checkId: string): Promise<void> {
    if (repairingCheckId()) return;
    setRepairingCheckId(checkId);
    try {
      const result = await options.host.runAction("run.repair.retry", { runId, checkId });
      const jobId = typeof result.job?.id === "string" ? result.job.id : undefined;
      if (jobId) {
        options.host.setSelectedJobId(jobId);
      }
      await options.host.refreshJobs();
      options.toast("Retrying only this check", "success");
    } catch (error) {
      options.toast(humanError(error, "Could not retry this check"), "error");
    } finally {
      setRepairingCheckId(undefined);
    }
  }

  function repairTestFromRun(job: JobInfo): void {
    const plan = [...(job.artifacts ?? [])]
      .reverse()
      .find((artifact) => artifact.kind === "app-map-test-plan")?.data as
      | { test?: { id?: unknown } }
      | undefined;
    const testId = typeof plan?.test?.id === "string" ? plan.test.id : undefined;
    if (!testId) {
      options.toast("This run does not identify a saved Test to repair", "warning");
      return;
    }
    options.onOpenTest(testId);
  }

  async function reviewRepair(
    job: JobInfo,
    repair: NavigationTransitionRepairEntry,
  ): Promise<void> {
    if (!job.persisted) return;
    try {
      await options.host.runAction(repair.operationId, repair.fixedInput);
      repairTestFromRun(job);
    } catch (error) {
      options.toast(humanError(error, "Could not record this repair decision"), "error");
    }
  }

  return { repairingCheckId, retryFailedCheck, repairTestFromRun, reviewRepair };
}
