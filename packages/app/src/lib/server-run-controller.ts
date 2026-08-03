import type { Accessor } from "solid-js";
import type { CompatibilityMatrix } from "@relay/protocol";
import { toast } from "../context/toast";
import type { CompatibilityReport, DeviceInfo, JobInfo, LogLine, RecipeInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";
import {
  enqueueAppMapFlow,
  enqueueMatrix,
  enqueueRecipe,
  loadMatrixReport,
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
  projectVariables: Accessor<import("@relay/protocol").TestVariable[]>;
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
  async function runAppMapFlow(appMapId: string, flowId: string, title: string): Promise<void> {
    if (deps.health() !== "online") {
      toast("Relay isn’t connected — can’t run yet", "warning");
      return;
    }
    const serial = deps.selectedDevice() ?? undefined;
    if (!serial) {
      toast("Choose a device before running this flow", "info");
      return;
    }
    const targetPlatform =
      deps.devices().find((device) => device.serial === serial)?.platform ?? "android";
    try {
      await deps.captureBeforeRun(`before · ${title}`, appMapId).catch(() => undefined);
      const { job, jobs } = await enqueueAppMapFlow(deps.request, {
        appMapId,
        flowId,
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
        jobs.length > 1 ? `Running ${jobs.length} cases for ${title}` : `Running ${title}`,
        "success",
      );
      void deps.refreshJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.appendLog(message, "error");
      toast(message, "warning");
      deps.setError(message);
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
        void deps.notify?.("Stage", `Queued ${repetitions} trials for ${title}`);
      } else if (willQueue) {
        toast(`Queued ${title} — position ${queuedBefore + 1}`, "info");
        void deps.notify?.("Stage", `Queued ${title} — position ${queuedBefore + 1}`);
      } else {
        toast(`Running ${title}`, "success");
        void deps.notify?.("Stage", `Running ${title}`);
      }
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

  return {
    runRecipe,
    runAppMapFlow,
    runCompatibilityMatrix,
    loadCompatibilityReport,
    retrySelectedJob,
  };
}
