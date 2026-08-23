import type { Accessor } from "solid-js";
import { humanError } from "./human-error";
import type {
  AppMapCapturePolicy,
  AppMapCombineCellTargetBinding,
  LocaleMatrixMaterializationInput,
  LocaleRunAnalysisReport,
  LocalCampaignAdmissionRequest,
} from "@relay/protocol";
import { toast } from "../context/toast";
import type { CompatibilityReport, DeviceInfo, JobInfo, LogLine } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";
import {
  enqueueAppMapFlow,
  enqueueAppMapConnection,
  enqueueLocaleMatrix,
  inferLocaleMatrix,
  inferOptionMatrix,
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
  buildLocaleMatrixInput,
  loadMatrixReport,
  loadMatrixAnalysis,
  materializeLocaleMatrix,
  exportRunMatrixPack,
  replayRecordedRun,
  retryJob,
  type ExportedPack,
  type CampaignDurationCohortEstimateRemoteInput,
  type LocalCampaignAdmissionPreflightRemoteInput,
  type LocaleMatrixInput,
} from "./server-run-remote";
import { privateValuesForRun } from "./private-variables";

type RunControllerDependencies = {
  request: ServerRequest;
  health: Accessor<string>;
  devices: Accessor<DeviceInfo[]>;
  selectedDevice: Accessor<string | null>;
  selectedJobId: Accessor<string | null>;
  projectId: () => string;
  projectVariables: Accessor<import("@relay/protocol").TestData[]>;
  captureBeforeRun: (label: string, actionId: string) => Promise<unknown>;
  appendLog: (text: string, level?: LogLine["level"], jobId?: string) => void;
  setSelectedJobId: (id: string) => void;
  setSelectedAction: (id: string) => void;
  setError: (message: string) => void;
  refreshJobs: () => Promise<void>;
  rememberJob: (job: JobInfo) => void;
  notify?: (title: string, body: string) => void | Promise<void>;
};

export function createServerRunController(deps: RunControllerDependencies) {
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
      const { job, jobs } = await enqueueAppMapConnection(deps.request, {
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
      deps.rememberJob(job);
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
      const { job, jobs } = await enqueueAppMapFlow(deps.request, {
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
      deps.rememberJob(job);
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

  async function inferLocaleOptionsFromDevice(
    nodes: unknown[],
    examples: Array<{ locale: string; identifier?: string; label?: string; text?: string }>,
    options?: {
      locales?: string[];
      app?: string;
      screenshotEachLocale?: boolean;
      appMapId?: string;
      bodyFlowId?: string;
      entryPath?: unknown[];
      languagePath?: unknown[];
    },
  ) {
    return inferLocaleMatrix(deps.request, {
      nodes,
      examples,
      locales: options?.locales,
      app: options?.app,
      screenshotEachLocale: options?.screenshotEachLocale ?? true,
      appMapId: options?.appMapId,
      bodyFlowId: options?.bodyFlowId,
      entryPath: options?.entryPath,
      languagePath: options?.languagePath,
    });
  }

  async function inferVariableFromDevice(
    nodes: unknown[],
    examples: Array<{ id: string; identifier?: string; label?: string; text?: string }>,
    options?: {
      kind?: string;
      name?: string;
      appMapId?: string;
      inConnectionId?: string;
      outConnectionId?: string;
      listScreenId?: string;
      entryPath?: unknown[];
      pickerPath?: unknown[];
    },
  ) {
    return inferOptionMatrix(deps.request, {
      nodes,
      examples,
      kind: options?.kind,
      name: options?.name,
      appMapId: options?.appMapId,
      inConnectionId: options?.inConnectionId,
      outConnectionId: options?.outConnectionId,
      listScreenId: options?.listScreenId,
      entryPath: options?.entryPath,
      pickerPath: options?.pickerPath,
    });
  }

  async function runPathAcrossVariables(input: {
    appMapId: string;
    flowId?: string;
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
      const data = await enqueueOptionMatrix(deps.request, {
        appMapId: input.appMapId,
        flowId: input.flowId,
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
        projectId: deps.projectId(),
        executionMode: input.executionMode,
        selectedCellIds: input.selectedCellIds,
        cellRuntimeProfiles: input.cellRuntimeProfiles,
      });
      for (const job of data.jobs.toReversed()) deps.rememberJob(job);
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
    return saveVariableRemote(deps.request, input);
  }

  async function removeVariable(input: Parameters<typeof removeVariableRemote>[1]) {
    return removeVariableRemote(deps.request, input);
  }

  async function saveTest(input: Parameters<typeof saveTestRemote>[1]) {
    return saveTestRemote(deps.request, input);
  }

  async function editTest(input: Parameters<typeof editTestRemote>[1]) {
    return editTestRemote(deps.request, input);
  }

  async function saveCombine(input: Parameters<typeof saveCombineRemote>[1]) {
    return saveCombineRemote(deps.request, input);
  }

  async function preflightCombine(input: Parameters<typeof preflightCombineRemote>[1]) {
    return preflightCombineRemote(deps.request, input);
  }

  /** These two reads deliberately bypass run-start to let the Combine surface
   * show measured evidence and a non-mutating local capacity result first. */
  async function estimateCampaignDurationCohorts(input: CampaignDurationCohortEstimateRemoteInput) {
    if (deps.health() !== "online") {
      throw new Error("Relay is not connected to read local timing evidence");
    }
    return estimateCampaignDurationCohortsRemote(deps.request, input);
  }

  async function preflightLocalCampaignAdmission(
    input: LocalCampaignAdmissionPreflightRemoteInput,
  ) {
    if (deps.health() !== "online") {
      throw new Error("Relay is not connected to inspect local campaign capacity");
    }
    return preflightLocalCampaignAdmissionRemote(deps.request, input);
  }

  /** Get the target-free, frozen locale cases before rendering or submitting
   * any per-case local-device assignment. Active device selection is never an
   * input to this read path. */
  async function materializeLocaleMatrixPlan(input: LocaleMatrixMaterializationInput) {
    if (deps.health() !== "online") {
      throw new Error("Relay is not connected to materialize a locale matrix");
    }
    const { projectId: _ignoredProjectId, ...source } = input;
    return materializeLocaleMatrix(deps.request, {
      ...source,
      projectId: deps.projectId(),
    });
  }

  async function removeCombine(input: Parameters<typeof removeCombineRemote>[1]) {
    return removeCombineRemote(deps.request, input);
  }

  async function getCombineCampaign(batchId: string) {
    return getCombineCampaignRemote(deps.request, batchId);
  }

  async function resumeCombineCampaign(batchId: string, reviewed = false) {
    const result = await resumeCombineCampaignRemote(deps.request, batchId, reviewed);
    for (const job of result.jobs.toReversed()) deps.rememberJob(job);
    if (result.jobs[0]) deps.setSelectedJobId(result.jobs[0].id);
    void deps.refreshJobs();
    return result.campaign;
  }

  async function cancelCombineCampaign(batchId: string) {
    const campaign = await cancelCombineCampaignRemote(deps.request, batchId);
    void deps.refreshJobs();
    return campaign;
  }

  async function runRecipeAcrossLocales(
    id: string,
    locales: string[],
    options?: {
      preset?: "grok";
      profileId?: string;
      title?: string;
      appMapId?: string;
      flowId?: string;
      testId?: string;
      variableId?: string;
      expectedAppMapRevision?: number;
      scope?: LocaleMatrixInput["scope"];
      /** Presence chooses target-affine local campaign mode, even when the
       * list is empty. That prevents a missing row from falling back to the
       * globally selected serial. */
      caseTargetBindings?: LocaleMatrixInput["caseTargetBindings"];
      localAdmission?: LocalCampaignAdmissionRequest;
    },
  ): Promise<{ batchId: string; jobIds: string[] } | null> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return null;
    }
    const usesExplicitCaseTargets = options?.caseTargetBindings !== undefined;
    const serial = usesExplicitCaseTargets ? undefined : (deps.selectedDevice() ?? undefined);
    if (!usesExplicitCaseTargets && !serial) {
      toast("Choose a ready device first", "warning");
      return null;
    }
    const targetPlatform = serial
      ? (deps.devices().find((device) => device.serial === serial)?.platform ?? "android")
      : undefined;
    const title = options?.title ?? id;
    const targetLabel = usesExplicitCaseTargets
      ? `${options?.caseTargetBindings?.length ?? 0} explicit local case targets`
      : serial!;
    deps.appendLog(
      `enqueue locale matrix ${id} × ${locales.join(", ")} on ${targetLabel}…`,
      "info",
    );
    try {
      if (!usesExplicitCaseTargets) {
        await deps.captureBeforeRun(`before · locales · ${id}`, id).catch(() => undefined);
      }
      const data = await enqueueLocaleMatrix(
        deps.request,
        buildLocaleMatrixInput({
          recipe: options?.appMapId ? undefined : id,
          appMapId: options?.appMapId,
          flowId: options?.flowId,
          testId: options?.testId,
          variableId: options?.variableId,
          expectedAppMapRevision: options?.expectedAppMapRevision,
          ...(usesExplicitCaseTargets
            ? {
                caseTargetBindings: options?.caseTargetBindings,
                ...(options?.localAdmission ? { localAdmission: options.localAdmission } : {}),
              }
            : {
                serial,
                targetKind: targetPlatform === "browser" ? "browser" : "device",
                platform: targetPlatform === "browser" ? undefined : targetPlatform,
              }),
          locales,
          scope: options?.scope,
          preset: options?.preset,
          profileId: options?.profileId,
          title,
          projectId: deps.projectId(),
        }),
      );
      if (data.jobs[0]) deps.setSelectedJobId(data.jobs[0].id);
      toast(`Running ${title} across ${data.batch.locales.length} locales`, "success");
      void deps.notify?.("Relay", `Running ${title} across ${data.batch.locales.length} locales`);
      void deps.refreshJobs();
      return { batchId: data.batch.id, jobIds: data.jobs.map((job) => job.id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const readable = humanError(error, "Could not run this Test across locales");
      deps.appendLog(message, "error");
      toast(readable, "error");
      deps.setError(readable);
      return null;
    }
  }

  async function loadCompatibilityReport(batchId: string): Promise<CompatibilityReport | null> {
    try {
      return await loadMatrixReport(deps.request, batchId);
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
  const matrixEvidence = {
    export: (batchId: string): Promise<ExportedPack> => exportRunMatrixPack(deps.request, batchId),
    analyze: async (batchId: string): Promise<LocaleRunAnalysisReport | null> => {
      try {
        return await loadMatrixAnalysis(deps.request, batchId);
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
      const job = await retryJob(deps.request, id);
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
      const job = await replayRecordedRun(deps.request, runId);
      deps.setSelectedJobId(job.id);
      deps.setSelectedAction(job.action);
      deps.rememberJob(job);
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
    inferLocaleOptionsFromDevice,
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
    localeMatrix: {
      materialize: materializeLocaleMatrixPlan,
      run: runRecipeAcrossLocales,
    },
    runAppMapConnection,
    runAppMapFlow,
    loadCompatibilityReport,
    matrixEvidence,
    retrySelectedJob,
    replayRecordedRunFromHistory,
  };
}
