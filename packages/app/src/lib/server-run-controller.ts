import type { Accessor } from "solid-js";
import type { AppMapCapturePolicy, CompatibilityMatrix } from "@relay/protocol";
import { toast } from "../context/toast";
import type { CompatibilityReport, DeviceInfo, JobInfo, LogLine, RecipeInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";
import {
  enqueueAppMapFlow,
  enqueueAppMapConnection,
  enqueueLocaleMatrix,
  inferLocaleMatrix,
  inferOptionMatrix,
  enqueueOptionMatrix,
  saveVariableRemote,
  removeVariableRemote,
  saveTestRemote,
  editTestRemote,
  saveCombineRemote,
  preflightCombineRemote,
  removeCombineRemote,
  buildLocaleMatrixInput,
  enqueueMatrix,
  enqueueRecipe,
  loadMatrixReport,
  exportRunMatrixPack,
  replayRecordedRun,
  retryJob,
} from "./server-run-remote";
import { privateValuesForRun } from "./private-variables";

type RunControllerDependencies = {
  request: ServerRequest;
  health: Accessor<string>;
  devices: Accessor<DeviceInfo[]>;
  recipes: Accessor<RecipeInfo[]>;
  matrices: Accessor<CompatibilityMatrix[]>;
  selectedDevice: Accessor<string | null>;
  selectedJobId: Accessor<string | null>;
  prodAccountMatch: Accessor<string>;
  projectId: () => string;
  projectVariables: Accessor<import("@relay/protocol").TestData[]>;
  activeJob: Accessor<JobInfo | null>;
  queuedJobs: Accessor<JobInfo[]>;
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
      deps.appendLog(message, "error");
      toast(message, "warning");
      deps.setError(message);
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
      deps.appendLog(message, "error");
      toast(message, "warning");
      deps.setError(message);
      return null;
    }
  }

  async function runRecipe(id: string, repetitions = 1): Promise<void> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return;
    }
    const serial = deps.selectedDevice() ?? undefined;
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    const queuedBefore = deps.queuedJobs().length;
    const willQueue = Boolean(deps.activeJob()) || queuedBefore > 0;
    deps.appendLog(`enqueue recipe ${id}${serial ? ` on ${serial}` : ""}…`, "info");
    try {
      await deps.captureBeforeRun(`before · ${id}`, id).catch(() => undefined);
      const data = await enqueueRecipe(deps.request, {
        recipe: id,
        ...(serial ? { serial } : {}),
        ...(targetPlatform === "browser"
          ? { targetKind: "browser" as const, browserTargetId: serial }
          : { targetKind: "device" as const, platform: targetPlatform }),
        repetitions,
        projectId: deps.projectId(),
        ...(deps.prodAccountMatch() ? { prodAccountMatch: deps.prodAccountMatch() } : {}),
      });
      if (data.jobs[0]) deps.setSelectedJobId(data.jobs[0].id);
      const title = deps.recipes().find((recipe) => recipe.id === id)?.title ?? id;
      if (repetitions > 1) {
        toast(`Queued ${repetitions} frozen trials for ${title}`, "success");
        void deps.notify?.("Relay", `Queued ${repetitions} trials for ${title}`);
      } else if (willQueue) {
        toast(`Queued ${title} — position ${queuedBefore + 1}`, "info");
        void deps.notify?.("Relay", `Queued ${title} — position ${queuedBefore + 1}`);
      } else {
        toast(`Running ${title}`, "success");
        void deps.notify?.("Relay", `Running ${title}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
      deps.setError(message);
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
    sets?: unknown[];
    variableIds?: string[];
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    title?: string;
  }): Promise<string | null> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return null;
    }
    const serial = deps.selectedDevice() ?? undefined;
    if (!serial) {
      toast("Choose a ready device first", "warning");
      return null;
    }
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    try {
      const data = await enqueueOptionMatrix(deps.request, {
        appMapId: input.appMapId,
        flowId: input.flowId,
        testId: input.testId,
        combineId: input.combineId,
        capture: input.capture,
        serial,
        targetKind: targetPlatform === "browser" ? "browser" : "device",
        platform: targetPlatform === "browser" ? undefined : targetPlatform,
        variableIds: input.variableIds,
        sets: input.sets,
        selected: input.selected,
        strategy: input.strategy,
        title: input.title,
        projectId: deps.projectId(),
      });
      for (const job of data.jobs.toReversed()) deps.rememberJob(job);
      if (data.jobs[0]) {
        deps.setSelectedJobId(data.jobs[0].id);
        deps.setSelectedAction(data.jobs[0].action);
      }
      const worlds = data.batch.worlds.length;
      toast(
        worlds <= 1
          ? `Running ${data.batch.title}`
          : `Running ${data.batch.title} · ${worlds} runs`,
        "success",
      );
      void deps.refreshJobs();
      return data.jobs[0]?.id ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
      deps.setError(message);
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

  async function removeCombine(input: Parameters<typeof removeCombineRemote>[1]) {
    return removeCombineRemote(deps.request, input);
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
      scope?: import("./server-run-remote").LocaleMatrixInput["scope"];
    },
  ): Promise<void> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return;
    }
    const serial = deps.selectedDevice() ?? undefined;
    if (!serial) {
      toast("Choose a ready device first", "warning");
      return;
    }
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    const title = options?.title ?? deps.recipes().find((recipe) => recipe.id === id)?.title ?? id;
    deps.appendLog(`enqueue locale matrix ${id} × ${locales.join(", ")} on ${serial}…`, "info");
    try {
      await deps.captureBeforeRun(`before · locales · ${id}`, id).catch(() => undefined);
      const data = await enqueueLocaleMatrix(
        deps.request,
        buildLocaleMatrixInput({
          recipe: options?.appMapId ? undefined : id,
          appMapId: options?.appMapId,
          flowId: options?.flowId,
          serial,
          targetKind: targetPlatform === "browser" ? "browser" : "device",
          platform: targetPlatform === "browser" ? undefined : targetPlatform,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
      deps.setError(message);
    }
  }

  async function runCompatibilityMatrix(
    recipeId: string,
    matrixId: string,
    repetitions = 1,
  ): Promise<void> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return;
    }
    const matrix = deps.matrices().find((item) => item.id === matrixId);
    try {
      const data = await enqueueMatrix(deps.request, {
        recipe: recipeId,
        matrixId,
        repetitions,
        ...(deps.prodAccountMatch() ? { prodAccountMatch: deps.prodAccountMatch() } : {}),
      });
      if (data.jobs[0]) deps.setSelectedJobId(data.jobs[0].id);
      toast(
        `Queued ${data.jobs.length} ${data.jobs.length === 1 ? "run" : "runs"} across ${data.matrix.profiles.length} target${data.matrix.profiles.length === 1 ? "" : "s"}${matrix ? ` · ${matrix.name}` : ""}`,
        "success",
      );
      await deps.refreshJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "error");
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

  async function exportMatrixEvidence(batchId: string): Promise<{ rootDir: string }> {
    const exported = await exportRunMatrixPack(deps.request, batchId);
    return { rootDir: exported.rootDir };
  }

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
      deps.appendLog(message, "error");
      toast(message, "warning");
      deps.setError(message);
    }
  }

  return {
    runRecipe,
    inferLocaleOptionsFromDevice,
    inferVariableFromDevice,
    runPathAcrossVariables,
    saveVariable,
    removeVariable,
    saveTest,
    editTest,
    saveCombine,
    preflightCombine,
    removeCombine,
    runRecipeAcrossLocales,
    runAppMapConnection,
    runAppMapFlow,
    runCompatibilityMatrix,
    loadCompatibilityReport,
    exportMatrixEvidence,
    retrySelectedJob,
    replayRecordedRunFromHistory,
  };
}
