import type { RelayClient } from "@relay/client";
import type {
  AppMapCapturePolicy,
  AppMapCombineCellTargetBinding,
  CampaignCapacityCohortDurationEstimateRequest,
  CampaignCapacityCohortDurationEstimateResponse,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
  OperationInput,
  OperationOutput,
} from "@relay/protocol";

export async function enqueueAppMapFlow(
  client: RelayClient,
  input: OperationInput<"app-map.flow.run">,
): Promise<OperationOutput<"app-map.flow.run">> {
  return client.invoke("app-map.flow.run", input);
}

export async function enqueueAppMapConnection(
  client: RelayClient,
  input: OperationInput<"app-map.connection.run">,
): Promise<OperationOutput<"app-map.connection.run">> {
  return client.invoke("app-map.connection.run", input);
}

export async function inferVariableRemote(
  client: RelayClient,
  input: OperationInput<"app-map.variable.infer">,
): Promise<OperationOutput<"app-map.variable.infer">> {
  return client.invoke("app-map.variable.infer", input);
}

export async function enqueueOptionMatrix(
  client: RelayClient,
  input: {
    appMapId: string;
    testId?: string;
    combineId?: string;
    capture?: AppMapCapturePolicy;
    /** Legacy one-target execution. Omit only when `cellTargetBindings` is
     * present: a bound local campaign must never fall back to this target. */
    serial?: string;
    targetKind?: "browser" | "device";
    platform?: "android" | "ios";
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
    /** Explicit target ownership for every selected cell. An empty array is
     * intentionally still serialized so the server can reject it explicitly. */
    cellTargetBindings?: AppMapCombineCellTargetBinding[];
    /** Generic, provenance-backed local deadline request for a Combine campaign. */
    localAdmission?: LocalCampaignAdmissionRequest;
  },
): Promise<OperationOutput<"job.combine.start">> {
  const usesExplicitBindings = input.cellTargetBindings !== undefined;
  if (!usesExplicitBindings && (!input.serial?.trim() || !input.targetKind)) {
    throw new Error("A legacy Combine start needs a selected serial and target kind");
  }
  const target = usesExplicitBindings
    ? {}
    : input.targetKind === "browser"
      ? { targetKind: "browser" as const, browserTargetId: input.serial!.trim() }
      : {
          targetKind: "device" as const,
          platform: input.platform,
          serial: input.serial!.trim(),
        };
  return client.invoke(
    "job.combine.start",
    {
      appMapId: input.appMapId,
      testId: input.testId,
      combineId: input.combineId,
      capture: input.capture,
      variableIds: input.variableIds,
      selected: input.selected,
      strategy: input.strategy,
      title: input.title,
      executionMode: input.executionMode,
      selectedCellIds: input.selectedCellIds,
      cellRuntimeProfiles: input.cellRuntimeProfiles,
      ...(input.cellTargetBindings === undefined
        ? {}
        : { cellTargetBindings: structuredClone(input.cellTargetBindings) }),
      ...(input.localAdmission === undefined
        ? {}
        : { localAdmission: structuredClone(input.localAdmission) }),
      ...target,
    } satisfies OperationInput<"job.combine.start">,
  );
}

/** Exact public estimator input/output for concrete target/Test/action cohorts,
 * never a platform average, provider promise, or Combine-specific variant. */
export type CampaignDurationCohortEstimateRemoteInput =
  CampaignCapacityCohortDurationEstimateRequest;
export type CampaignDurationCohortEstimateRemoteResult =
  CampaignCapacityCohortDurationEstimateResponse;

/** Ask the server to derive measured evidence from immutable persisted runs.
 * This endpoint neither takes a target lease nor writes a scheduling record. */
export async function estimateCampaignDurationCohortsRemote(
  client: RelayClient,
  input: CampaignDurationCohortEstimateRemoteInput,
): Promise<CampaignDurationCohortEstimateRemoteResult> {
  return client.invoke("campaign.duration.cohorts.estimate", input);
}

/** Exact public, read-only admission input/output, reusable by locale and future
 * farms. Start repeats this check under its admission lock before reservation. */
export type LocalCampaignAdmissionPreflightRemoteInput = LocalCampaignAdmissionPreflightRequest;
export type LocalCampaignAdmissionPreflightRemoteResult = LocalCampaignAdmissionPreflightResponse;

export async function preflightLocalCampaignAdmissionRemote(
  client: RelayClient,
  input: LocalCampaignAdmissionPreflightRemoteInput,
): Promise<LocalCampaignAdmissionPreflightRemoteResult> {
  return client.invoke("campaign.local-admission.preflight", input);
}

export async function getCombineCampaignRemote(
  client: RelayClient,
  batchId: string,
): Promise<OperationOutput<"job.combine.campaign.get">["campaign"]> {
  return (await client.invoke("job.combine.campaign.get", { batchId })).campaign;
}

export async function resumeCombineCampaignRemote(
  client: RelayClient,
  batchId: string,
  reviewed = false,
): Promise<OperationOutput<"job.combine.campaign.resume">> {
  return client.invoke("job.combine.campaign.resume", { batchId, reviewed });
}

export async function cancelCombineCampaignRemote(
  client: RelayClient,
  batchId: string,
): Promise<OperationOutput<"job.combine.campaign.cancel">["campaign"]> {
  return (await client.invoke("job.combine.campaign.cancel", { batchId })).campaign;
}

export async function saveTestRemote(
  client: RelayClient,
  input: Omit<OperationInput<"app-map.test.save">, "testId">,
): Promise<OperationOutput<"app-map.test.save">> {
  return client.invoke("app-map.test.save", { ...input, testId: input.test.id });
}

export async function editTestRemote(
  client: RelayClient,
  input: OperationInput<"app-map.test.edit">,
): Promise<OperationOutput<"app-map.test.edit">> {
  return client.invoke("app-map.test.edit", input);
}

export async function saveCombineRemote(
  client: RelayClient,
  input: Omit<OperationInput<"app-map.combine.save">, "combineId">,
): Promise<OperationOutput<"app-map.combine.save">> {
  return client.invoke("app-map.combine.save", { ...input, combineId: input.combine.id });
}

export async function preflightCombineRemote(
  client: RelayClient,
  input: OperationInput<"app-map.combine.preflight">,
): Promise<OperationOutput<"app-map.combine.preflight">["preflight"]> {
  return (await client.invoke("app-map.combine.preflight", input)).preflight;
}

export async function removeCombineRemote(
  client: RelayClient,
  input: OperationInput<"app-map.combine.remove">,
): Promise<OperationOutput<"app-map.combine.remove">> {
  return client.invoke("app-map.combine.remove", input);
}

export async function saveVariableRemote(
  client: RelayClient,
  input: Omit<OperationInput<"app-map.variable.save">, "variableId">,
): Promise<OperationOutput<"app-map.variable.save">> {
  return client.invoke("app-map.variable.save", { ...input, variableId: input.variable.id });
}

export async function removeVariableRemote(
  client: RelayClient,
  input: OperationInput<"app-map.variable.remove">,
): Promise<OperationOutput<"app-map.variable.remove">> {
  return client.invoke("app-map.variable.remove", input);
}

export type ExportedPack = OperationOutput<"job.combine.export">;

export async function exportCombinePack(
  client: RelayClient,
  batchId: string,
): Promise<ExportedPack> {
  return client.invoke("job.combine.export", { batchId });
}

/**
 * The findings for a batch without exporting it. The grid asks for these while
 * the sweep is still running, so it must not write a pack to answer.
 */
export async function loadMatrixAnalysis(
  client: RelayClient,
  batchId: string,
): Promise<OperationOutput<"job.combine.analysis">> {
  return client.invoke("job.combine.analysis", { batchId });
}

export async function loadMatrixReport(
  client: RelayClient,
  batchId: string,
): Promise<import("./api-types").CompatibilityReport> {
  const data = await client.resource<{ report: import("./api-types").CompatibilityReport }>(
    `/reports/matrix/${encodeURIComponent(batchId)}`,
  );
  return data.report;
}

export async function retryJob(
  client: RelayClient,
  jobId: string,
): Promise<OperationOutput<"job.retry">["job"]> {
  return (await client.invoke("job.retry", { jobId })).job;
}

/** Re-run the immutable plan saved with a completed run, even after restart. */
export async function replayRecordedRun(
  client: RelayClient,
  runId: string,
): Promise<OperationOutput<"run.replay">["job"]> {
  return (await client.invoke("run.replay", { runId })).job;
}
