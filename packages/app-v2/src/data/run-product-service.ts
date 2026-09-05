import { boundedVideoBlob } from "./run-video-loader";
export { runOutcome } from "./run-outcome";
import type {
  ProductRunReport,
  ProductRunStartInput,
  ProductRunState,
  ProductRunWatchInput,
} from "@relay/product/run-journey";
import type { ProductRunBuildOption } from "@relay/product/run-journey";
import type { ProductRunProfileOption } from "@relay/product/run-journey";
import type {
  AuthoringTarget,
  OperationInput,
  OperationOutput,
  OperationRecord,
} from "@relay/protocol";
import type { ProductRunSummary } from "@relay/product/catalog";
import type { Platform } from "../platform/types";
import { productClientForPlatform } from "./product-client";
import { projectTestStep, type ProductTestSummary } from "./run-test-projection";
import { presentReadyTargets, type ProductTargetOption } from "./target-presentation";
import { projectRunReport, resolvedTestTitle } from "./run-report-projection";
export { projectRunReport } from "./run-report-projection";
export { mapDiagnosticEventsToVideo } from "./run-report-media";
export type { ProductTestSummary } from "./run-test-projection";
export { framePathsForTraceStep } from "./run-report-model";
export type {
  ReportEvidenceSection,
  ReportEvidenceItem,
  ReportTimelineItem,
  ProductRunReportOverview,
  ReportVideoMedia,
  ReportDiagnosticEvent,
} from "./run-report-model";
import type { ProductRunReportOverview } from "./run-report-model";
export type ProductRunReview = OperationOutput<"run.review">["review"];
export type ProductVisualReviewResult = Pick<
  OperationOutput<"run.visual.review">,
  "decision" | "baseline"
>;
export type ProductVisualBaselineApproval = OperationOutput<"run.visual-baseline.update">;
export type RunProductService = {
  getTest(testId: string): Promise<ProductTestSummary | undefined>;
  listTestRuns?(testId: string): Promise<readonly ProductRunSummary[]>;
  listTestRunsComplete?(testId: string): Promise<readonly ProductRunSummary[]>;
  listTargets(): Promise<readonly ProductTargetOption[]>;
  listBuilds?(): Promise<readonly ProductRunBuildOption[]>;
  listProfiles?(appMapId: string): Promise<readonly ProductRunProfileOption[]>;
  presentTargets(targets: readonly AuthoringTarget[]): Promise<readonly ProductTargetOption[]>;
  start(input: ProductRunStartInput): Promise<ProductRunState>;
  replay?(
    runId: string,
    mode?: "saved-steps" | "same-configuration",
  ): Promise<{ jobId: string; runId?: string }>;
  getReplayJob?(jobId: string): Promise<{ status: string; runId?: string; error?: string }>;
  cancelReplay?(jobId: string): Promise<void>;
  inspect(workflowId: string): Promise<ProductRunState>;
  inspectExecution?(runId: string): Promise<ProductRunState | undefined>;
  cancelExecution?(runId: string): Promise<ProductRunState | undefined>;
  restore?(runId: string): Promise<ProductRunState | undefined>;
  watch(input?: ProductRunWatchInput): Promise<ProductRunState>;
  cancel(): Promise<ProductRunState>;
  review?(input: OperationInput<"run.review">): Promise<ProductRunReview>;
  getEvidence?(
    runId: string,
    input?: Omit<OperationInput<"run.evidence.get">, "runId">,
  ): Promise<OperationOutput<"run.evidence.get">["evidence"]>;
  compareVisual?(runId: string): Promise<OperationOutput<"run.visual.compare">["comparison"]>;
  reviewVisual?(input: OperationInput<"run.visual.review">): Promise<ProductVisualReviewResult>;
  getVisualPolicy?(runId: string): Promise<OperationOutput<"run.visual-policy.get">["policy"]>;
  updateVisualPolicy?(
    input: OperationInput<"run.visual-policy.update">,
  ): Promise<OperationOutput<"run.visual-policy.update">>;
  approveVisualBaseline?(
    input: OperationInput<"run.visual-baseline.update">,
  ): Promise<ProductVisualBaselineApproval>;
  getReport(runId: string, canonical?: ProductRunReport): Promise<ProductRunReportOverview>;
  getRawEvidence(runId: string): Promise<unknown>;
};
type ProductRuntime = {
  client: Awaited<ReturnType<typeof productClientForPlatform>>["client"];
  journey: ReturnType<
    (typeof import("@relay/product/run-journey"))["createProductRunJourneyFromClient"]
  >;
  targetJourney: ReturnType<
    (typeof import("@relay/product/recording-journey"))["createProductRecordingJourneyFromClient"]
  >;
};
export function createRunProductService(platform: Platform): RunProductService {
  let runtimePromise: Promise<ProductRuntime> | undefined;
  function runtime() {
    runtimePromise ??= Promise.all([
      productClientForPlatform(platform),
      import("@relay/product/run-journey"),
      import("@relay/product/recording-journey"),
    ]).then(
      ([
        { client, actorId },
        { createProductRunJourneyFromClient },
        { createProductRecordingJourneyFromClient },
      ]) => ({
        client,
        journey: createProductRunJourneyFromClient({ client, actorId }),
        targetJourney: createProductRecordingJourneyFromClient({ client, actorId }),
      }),
    );
    return runtimePromise;
  }
  async function evidence(
    runId: string,
    input: Omit<OperationInput<"run.evidence.get">, "runId"> = {},
  ): Promise<OperationOutput<"run.evidence.get">["evidence"]> {
    return (await (await runtime()).client.invoke("run.evidence.get", { runId, ...input }))
      .evidence;
  }
  return {
    async getTest(testId) {
      const { client } = await runtime();
      const { appMaps } = await client.invoke("app-map.list", {});
      const matches = appMaps.flatMap((app) => {
        const test = app.tests[testId];
        return test ? [{ app, test }] : [];
      });
      if (matches.length > 1) {
        throw new TypeError("This Test appears in more than one app and cannot be opened safely.");
      }
      const match = matches[0];
      if (!match) return undefined;
      return {
        id: match.test.id,
        name: match.test.name,
        appMapId: match.app.id,
        appName: match.app.name,
        stepCount: match.test.steps.length,
        steps: match.test.steps.map(projectTestStep),
      };
    },
    async listTestRuns(testId) {
      const { client } = await runtime();
      const { createProductCatalog } = await import("@relay/product/catalog");
      return createProductCatalog(client).listRuns({ testId });
    },
    async listTestRunsComplete(testId) {
      const { client } = await runtime();
      const { createProductCatalog } = await import("@relay/product/catalog");
      const catalog = createProductCatalog(client);
      return catalog.listRunsComplete
        ? catalog.listRunsComplete({ testId })
        : catalog.listRuns({ testId });
    },
    async listTargets() {
      const { client, targetJourney } = await runtime();
      const state = await targetJourney.connect();
      if (state.recovery) {
        throw new Error(`${state.recovery.detail} ${state.recovery.recovery}`.trim());
      }
      return presentReadyTargets(client, state.targets);
    },
    async listBuilds() {
      const { client } = await runtime();
      const { builds } = await client.invoke("build.list", {});
      return builds.map((build) => ({
        id: build.id,
        name: build.name,
        platform: build.platform,
        status: build.status,
        ...(build.sourceSha ? { sourceSha: build.sourceSha } : {}),
      }));
    },
    async listProfiles(appMapId) {
      const { client } = await runtime();
      const { appMap } = await client.invoke("app-map.get", { appMapId });
      const profiles = new Map<string, ProductRunProfileOption>();
      for (const variant of Object.values(appMap.screenVariants)) {
        const profile = variant.targetProfile;
        if (!profile || profiles.has(profile.id)) continue;
        const authenticationFixtureId = profile.browserCaseProfile?.authenticationFixtureId;
        let account: ProductRunProfileOption["account"];
        if (authenticationFixtureId && profile.platform === "browser") {
          const { fixtures } = await client.invoke("target.browser-auth.list", {
            targetId: profile.targetId,
          });
          const fixture = fixtures.find((item) => item.reference === authenticationFixtureId);
          if (fixture) account = { id: fixture.reference, name: fixture.name };
        }
        profiles.set(profile.id, {
          id: profile.id,
          name: profile.name,
          targetId: profile.targetId,
          platform: profile.platform,
          ...(account ? { account } : {}),
        });
      }
      return [...profiles.values()];
    },
    async presentTargets(targets) {
      return presentReadyTargets((await runtime()).client, targets);
    },
    async start(input) {
      return (await runtime()).journey.start(input);
    },
    async replay(runId, mode) {
      const { job } = await (
        await runtime()
      ).client.invoke("run.replay", {
        runId,
        ...(mode ? { mode } : {}),
      });
      return {
        jobId: job.id,
        ...(typeof job.runId === "string" ? { runId: job.runId } : {}),
      };
    },
    async getReplayJob(jobId) {
      const { job } = await (await runtime()).client.invoke("job.get", { jobId });
      return {
        status: String(job.status),
        ...(typeof job.runId === "string" ? { runId: job.runId } : {}),
        ...(typeof job.error === "string" ? { error: job.error } : {}),
      };
    },
    async cancelReplay(jobId) {
      await (await runtime()).client.invoke("job.cancel", { jobId });
    },
    async inspect(workflowId) {
      return (await runtime()).journey.inspect(workflowId);
    },
    async inspectExecution(runId) {
      const { client } = await runtime();
      try {
        const { job } = await client.invoke("job.get", { jobId: runId });
        return projectWorkflowlessExecution(job, runId);
      } catch {
        return undefined;
      }
    },
    async cancelExecution(runId) {
      const { client } = await runtime();
      try {
        const { job } = await client.invoke("job.cancel", { jobId: runId });
        return projectWorkflowlessExecution(job, runId);
      } catch {
        return undefined;
      }
    },
    async restore(runId) {
      const { client, journey } = await runtime();
      const workflowId = await findPersistedRunWorkflowId(client, runId);
      if (!workflowId?.trim()) return undefined;
      return journey.inspect(workflowId);
    },
    async watch(input) {
      return (await runtime()).journey.watch(input);
    },
    async cancel() {
      return (await runtime()).journey.cancel();
    },
    async review(input) {
      return (await (await runtime()).client.invoke("run.review", input)).review;
    },
    getEvidence: evidence,
    async compareVisual(runId) {
      return (await (await runtime()).client.invoke("run.visual.compare", { runId })).comparison;
    },
    async reviewVisual(input) {
      const { decision, baseline } = await (
        await runtime()
      ).client.invoke("run.visual.review", input);
      return { decision, baseline };
    },
    async getVisualPolicy(runId) {
      return (await (await runtime()).client.invoke("run.visual-policy.get", { runId })).policy;
    },
    async updateVisualPolicy(input) {
      return (await runtime()).client.invoke("run.visual-policy.update", input);
    },
    async approveVisualBaseline(input) {
      return (await runtime()).client.invoke("run.visual-baseline.update", input);
    },
    async getReport(runId, canonical) {
      const { client } = await runtime();
      const [{ run }, evidenceResult, appsResult] = await Promise.all([
        client.invoke("run.get", { runId }),
        client.invoke("run.evidence.get", { runId, includeBodies: false }).catch(() => undefined),
        client.invoke("app-map.list", {}).catch(() => undefined),
      ]);
      const report = projectRunReport(
        runId,
        run,
        evidenceResult?.evidence,
        canonical,
        evidenceResult === undefined,
        resolvedTestTitle(run, appsResult?.appMaps),
      );
      if (report.video) {
        const path = report.video.src;
        return {
          ...report,
          video: {
            ...report.video,
            ...(path
              ? {
                  load: async (signal?: AbortSignal) => {
                    const response = await client.download(path, signal);
                    return boundedVideoBlob(response);
                  },
                }
              : {}),
            src: undefined,
          },
        };
      }
      return report;
    },
    async getRawEvidence(runId) {
      return evidence(runId, { includeBodies: true });
    },
  };
}
const MAX_RESTORE_RUN_LIST_PAGES = 100;
export async function findPersistedRunWorkflowId(
  client: Pick<Awaited<ReturnType<typeof productClientForPlatform>>["client"], "invoke">,
  runId: string,
): Promise<string | undefined> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_RESTORE_RUN_LIST_PAGES; page += 1) {
    const result = await client.invoke("run.list", cursor ? { cursor } : {});
    const candidate = result.runs.find((run) => run.id === runId);
    if (typeof candidate?.workflowId === "string" && candidate.workflowId.trim()) {
      return candidate.workflowId;
    }
    if (!result.nextCursor || result.nextCursor === cursor) return undefined;
    cursor = result.nextCursor;
  }
  return undefined;
}

export function projectWorkflowlessExecution(job: OperationRecord, runId: string): ProductRunState {
  const value = workflowRecord(job) ?? {};
  const status = workflowText(value.status)?.toLowerCase() ?? "unknown";
  const phase =
    status === "cancelled" || status === "canceled"
      ? "cancelled"
      : ["ok", "healed", "succeeded", "completed"].includes(status)
        ? "succeeded"
        : ["error", "failed"].includes(status)
          ? "failed"
          : "running";
  const progress = workflowRecord(value.progress);
  return {
    status: phase,
    run: { jobId: runId, runId },
    snapshot: {
      schemaVersion: 1,
      kind: "run-test",
      title: workflowText(value.title) ?? "Run",
      phase,
      version: `${runId}:${status}`,
      progress: {
        label: workflowText(progress?.label) ?? (phase === "running" ? "Running" : status),
        ...(workflowNumber(progress?.completed) === undefined
          ? {}
          : { completed: workflowNumber(progress?.completed) }),
        ...(workflowNumber(progress?.total) === undefined
          ? {}
          : { total: workflowNumber(progress?.total) }),
      },
      allowedNextActions: phase === "running" ? ["inspect", "cancel"] : ["inspect"],
      problems: [],
      evidenceRefs: [],
    },
  };
}

function workflowRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function workflowText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 8_192) : undefined;
}

function workflowNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export type { ProductRunRecovery, ProductRunState } from "@relay/product/run-journey";
