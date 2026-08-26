import type { Accessor } from "solid-js";
import type { RelayClient } from "@relay/client";
import { humanError } from "./human-error";
import type {
  AppMapCapturePolicy,
  AppMapCombineCellTargetBinding,
  CombineEvidenceAnalysisReport,
  LocalCampaignAdmissionRequest,
  OperationInput,
} from "@relay/protocol";
import { toast } from "../context/toast";
import type { CompatibilityReport, DeviceInfo, LogLine } from "./api-types";
import {
  enqueueAppMapFlow,
  enqueueAppMapConnection,
  inferVariableRemote,
  enqueueOptionMatrix,
  estimateCampaignDurationCohortsRemote,
  preflightLocalCampaignAdmissionRemote,
  saveVariableRemote,
  removeVariableRemote,
  saveTestRemote,
  editTestRemote,
  saveCombineRemote,
  preflightCombineRemote,
  removeCombineRemote,
  getCombineCampaignRemote,
  resumeCombineCampaignRemote,
  cancelCombineCampaignRemote,
  loadMatrixReport,
  loadMatrixAnalysis,
  exportCombinePack,
  replayRecordedRun,
  retryJob,
  type ExportedPack,
  type CampaignDurationCohortEstimateRemoteInput,
  type LocalCampaignAdmissionPreflightRemoteInput,
} from "./server-combine-remote";
import { privateValuesForRun } from "./private-variables";

type CombineControllerDependencies = {
  client: () => Promise<RelayClient>;
  health: Accessor<string>;
  devices: Accessor<DeviceInfo[]>;
  selectedDevice: Accessor<string | null>;
  selectedLeaseId: Accessor<string | null>;
  selectedJobId: Accessor<string | null>;
  projectId: () => string;
  projectVariables: Accessor<import("@relay/protocol").TestData[]>;
  captureBeforeRun: (label: string, actionId: string) => Promise<unknown>;
  appendLog: (text: string, level?: LogLine["level"], jobId?: string) => void;
  setSelectedJobId: (id: string) => void;
  setSelectedAction: (id: string) => void;
  setError: (message: string) => void;
  refreshJobs: () => Promise<void>;
  notify?: (title: string, body: string) => void | Promise<void>;
};

export function createServerCombineController(deps: CombineControllerDependencies) {
  async function runAppMapConnection(
    appMapId: string,
    connectionId: string,
    title: string,
  ): Promise<string | null> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t replay yet", "warning");
      return null;
    }
    const serial = deps.selectedDevice() ?? undefined;
    if (!serial) {
      toast("Choose a device before trying this path", "info");
      return null;
    }
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    try {
      await deps.captureBeforeRun(`before · ${title}`, connectionId).catch(() => undefined);
      const { job, jobs } = await enqueueAppMapConnection(await deps.client(), {
        appMapId,
        connectionId,
        serial,
        ...(targetPlatform === "browser"
          ? { targetKind: "browser" as const, browserTargetId: serial }
          : { targetKind: "device" as const, platform: targetPlatform }),
        variables: privateValuesForRun(deps.projectId(), deps.projectVariables()),
      });
      deps.setSelectedJobId(job.id);
      deps.setSelectedAction(connectionId);
      toast(
        jobs.length > 1 ? `Replaying ${jobs.length} runs for ${title}` : `Replaying ${title}`,
        "success",
      );
      void deps.refreshJobs();
      return job.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this connection");
      deps.appendLog(message, "error");
      toast(readable, "warning");
      deps.setError(readable);
      return null;
    }
  }

  async function runAppMapFlow(
    appMapId: string,
    flowId: string,
    title: string,
    throughConnectionId?: string,
  ): Promise<string | null> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return null;
    }
    const serial = deps.selectedDevice() ?? undefined;
    if (!serial) {
      toast("Choose a device before running this path", "info");
      return null;
    }
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    try {
      await deps.captureBeforeRun(`before · ${title}`, appMapId).catch(() => undefined);
      const { job, jobs } = await enqueueAppMapFlow(await deps.client(), {
        appMapId,
        flowId,
        ...(throughConnectionId ? { throughConnectionId } : {}),
        serial,
        ...(targetPlatform === "browser"
          ? { targetKind: "browser" as const, browserTargetId: serial }
          : { targetKind: "device" as const, platform: targetPlatform }),
        variables: privateValuesForRun(deps.projectId(), deps.projectVariables()),
      });
      deps.setSelectedJobId(job.id);
      deps.setSelectedAction(appMapId);
      toast(
        jobs.length > 1 ? `Running ${jobs.length} runs` : `Running “${title}” on the device`,
        "success",
      );
      void deps.refreshJobs();
      return job.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this path");
      deps.appendLog(message, "error");
      toast(readable, "warning");
      deps.setError(readable);
      return null;
    }
  }

  async function inferVariableFromDevice(
    input: Omit<OperationInput<"app-map.variable.infer">, "target" | "leaseId">,
  ) {
    const targetId = deps.selectedDevice();
    const leaseId = deps.selectedLeaseId();
    const device = deps.devices().find((item) => item.serial === targetId);
    if (!targetId || !device) throw new Error("Choose a ready target before teaching a Variable");
    if (!leaseId) throw new Error("Take control of the selected target before teaching a Variable");
    if (
      device.platform !== "browser" &&
      device.platform !== "android" &&
      device.platform !== "ios"
    ) {
      throw new Error("The selected target does not expose a supported platform");
    }
    return inferVariableRemote(await deps.client(), {
      ...input,
      leaseId,
      target:
        device.platform === "browser"
          ? { kind: "browser", platform: "browser", targetId }
          : { kind: "device", platform: device.platform, targetId },
    });
  }

  async function runPathAcrossVariables(input: {
    appMapId: string;
    testId?: string;
    combineId?: string;
    capture?: AppMapCapturePolicy;
    variableIds?: string[];
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    title?: string;
    executionMode?: "all" | "pilot";
    selectedCellIds?: string[];
    cellRuntimeProfiles?: Array<{
      testId: string;
      values: Record<string, string>;
      targetProfileId: string;
    }>;
    /** Presence selects the explicit local-campaign transport path, even if
     * the array is empty. That lets the server return a precise binding error
     * instead of silently selecting the current device. */
    cellTargetBindings?: AppMapCombineCellTargetBinding[];
    localAdmission?: LocalCampaignAdmissionRequest;
  }): Promise<{ jobId: string | null; campaignId?: string } | null> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return null;
    }
    const usesExplicitBindings = input.cellTargetBindings !== undefined;
    const serial = deps.selectedDevice() ?? undefined;
    if (!usesExplicitBindings && !serial) {
      toast("Choose a ready device first", "warning");
      return null;
    }
    const targetPlatform = serial
      ? (deps.devices().find((device) => device.serial === serial)?.platform ?? "android")
      : undefined;
    try {
      const data = await enqueueOptionMatrix(await deps.client(), {
        appMapId: input.appMapId,
        testId: input.testId,
        combineId: input.combineId,
        capture: input.capture,
        ...(usesExplicitBindings
          ? {
              cellTargetBindings: input.cellTargetBindings,
              ...(input.localAdmission ? { localAdmission: input.localAdmission } : {}),
            }
          : {
              serial,
              targetKind: targetPlatform === "browser" ? "browser" : "device",
              platform: targetPlatform === "browser" ? undefined : targetPlatform,
            }),
        variableIds: input.variableIds,
        selected: input.selected,
        strategy: input.strategy,
        title: input.title,
        executionMode: input.executionMode,
        selectedCellIds: input.selectedCellIds,
        cellRuntimeProfiles: input.cellRuntimeProfiles,
      });
      if (data.jobs[0]) {
        deps.setSelectedJobId(data.jobs[0].id);
        deps.setSelectedAction(data.jobs[0].action);
      }
      const worlds = data.batch.worlds.length;
      toast(
        data.campaign
          ? `Pilot started · ${worlds - 1} untouched ${worlds - 1 === 1 ? "case" : "cases"} held`
          : worlds <= 1
            ? `Running ${data.batch.title}`
            : `Running ${data.batch.title} · ${worlds} runs`,
        "success",
      );
      void deps.refreshJobs();
      return {
        jobId: data.jobs[0]?.id ?? null,
        ...(data.campaign ? { campaignId: data.campaign.id } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this path across your Variables");
      deps.appendLog(message, "error");
      toast(readable, "error");
      deps.setError(readable);
      return null;
    }
  }

  async function saveVariable(input: Parameters<typeof saveVariableRemote>[1]) {
    return saveVariableRemote(await deps.client(), input);
  }

  async function removeVariable(input: Parameters<typeof removeVariableRemote>[1]) {
    return removeVariableRemote(await deps.client(), input);
  }

  async function saveTest(input: Parameters<typeof saveTestRemote>[1]) {
    return saveTestRemote(await deps.client(), input);
  }

  async function editTest(input: Parameters<typeof editTestRemote>[1]) {
    return editTestRemote(await deps.client(), input);
  }

  async function saveCombine(input: Parameters<typeof saveCombineRemote>[1]) {
    return saveCombineRemote(await deps.client(), input);
  }

  async function preflightCombine(input: Parameters<typeof preflightCombineRemote>[1]) {
    return preflightCombineRemote(await deps.client(), input);
  }

  /** These two reads deliberately bypass run-start to let the Combine surface
   * show measured evidence and a non-mutating local capacity result first. */
  async function estimateCampaignDurationCohorts(input: CampaignDurationCohortEstimateRemoteInput) {
    if (deps.health() !== "online") {
      throw new Error("Relay is not connected to read local timing evidence");
    }
    return estimateCampaignDurationCohortsRemote(await deps.client(), input);
  }

  async function preflightLocalCampaignAdmission(
    input: LocalCampaignAdmissionPreflightRemoteInput,
  ) {
    if (deps.health() !== "online") {
      throw new Error("Relay is not connected to inspect local campaign capacity");
    }
    return preflightLocalCampaignAdmissionRemote(await deps.client(), input);
  }

  async function removeCombine(input: Parameters<typeof removeCombineRemote>[1]) {
    return removeCombineRemote(await deps.client(), input);
  }

  async function getCombineCampaign(batchId: string) {
    return getCombineCampaignRemote(await deps.client(), batchId);
  }

  async function resumeCombineCampaign(batchId: string, reviewed = false) {
    const result = await resumeCombineCampaignRemote(await deps.client(), batchId, reviewed);
    if (result.jobs[0]) deps.setSelectedJobId(result.jobs[0].id);
    void deps.refreshJobs();
    return result.campaign;
  }

  async function cancelCombineCampaign(batchId: string) {
    const campaign = await cancelCombineCampaignRemote(await deps.client(), batchId);
    void deps.refreshJobs();
    return campaign;
  }

  async function loadCompatibilityReport(batchId: string): Promise<CompatibilityReport | null> {
    try {
      return await loadMatrixReport(await deps.client(), batchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/not found/i.test(message)) deps.appendLog(message, "error");
      return null;
    }
  }

  /**
   * A batch's evidence: the pack folder a person opens, and the findings the
   * grid needs before anyone has asked for a folder. A batch too old to still
   * be in memory has no analysis, and a grid that cannot be judged is a quieter
   * failure than a red toast.
   */
  const combineEvidence = {
    export: async (batchId: string): Promise<ExportedPack> =>
      exportCombinePack(await deps.client(), batchId),
    analyze: async (batchId: string): Promise<CombineEvidenceAnalysisReport | null> => {
      try {
        return await loadMatrixAnalysis(await deps.client(), batchId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not found|no jobs/i.test(message)) deps.appendLog(message, "error");
        return null;
      }
    },
  };

  async function retrySelectedJob(jobId?: string): Promise<void> {
    const id = jobId ?? deps.selectedJobId();
    if (!id) {
      deps.appendLog("No job to retry", "error");
      return;
    }
    deps.appendLog(`retry / heal ${id.slice(0, 8)}…`, "info");
    try {
      const job = await retryJob(await deps.client(), id);
      deps.setSelectedJobId(job.id);
      deps.setSelectedAction(job.action);
      void deps.refreshJobs();
    } catch (error) {
      deps.appendLog(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function replayRecordedRunFromHistory(runId: string): Promise<void> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t replay this recorded run", "warning");
      return;
    }
    deps.appendLog(`replay recorded run ${runId.slice(0, 8)}…`, "info");
    try {
      const job = await replayRecordedRun(await deps.client(), runId);
      deps.setSelectedJobId(job.id);
      deps.setSelectedAction(job.action);
      toast("Replaying the recorded plan", "success");
      void deps.refreshJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not replay this run");
      deps.appendLog(message, "error");
      toast(readable, "warning");
      deps.setError(readable);
    }
  }

  return {
    inferVariableFromDevice,
    runPathAcrossVariables,
    saveVariable,
    removeVariable,
    saveTest,
    editTest,
    saveCombine,
    preflightCombine,
    estimateCampaignDurationCohorts,
    preflightLocalCampaignAdmission,
    removeCombine,
    combineCampaign: {
      get: getCombineCampaign,
      resume: resumeCombineCampaign,
      cancel: cancelCombineCampaign,
    },
    runAppMapConnection,
    runAppMapFlow,
    loadCompatibilityReport,
    combineEvidence,
    retrySelectedJob,
    replayRecordedRunFromHistory,
  };
}
