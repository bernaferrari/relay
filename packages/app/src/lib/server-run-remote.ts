import type {
  AppMapCapturePolicy,
  AppMapCombineCellTargetBinding,
  AppMapCombinePreflight,
  AppMapTest,
  AppMapScenarioTestEdit,
  CampaignCapacityCohortDurationEstimateRequest,
  CampaignCapacityCohortDurationEstimateResponse,
  CombineCampaign,
  LocalAgentDeviceExecutionTargetRef,
  LocalCampaignAdmissionRequest,
  LocalCampaignAdmissionPreflightRequest,
  LocalCampaignAdmissionPreflightResponse,
  LocaleMatrixMaterialization,
  LocaleMatrixMaterializationInput,
  LocaleMatrixMaterializedScope,
  LocaleRunAnalysisReport,
  LocaleRunPackManifest,
  MatrixExpansion,
} from "@relay/protocol";
import type { CompatibilityReport, JobInfo } from "./api-types";
import type { ServerRequest } from "./server-matrix-remote";

export type RunRecipeInput = {
  recipe: string;
  serial?: string;
  targetKind: "browser" | "device";
  browserTargetId?: string;
  platform?: string;
  repetitions: number;
  projectId: string;
  prodAccountMatch?: string;
};

export async function enqueueRecipe(
  request: ServerRequest,
  input: RunRecipeInput,
): Promise<{ jobs: JobInfo[]; matrix: { id: string } }> {
  return request<{ jobs: JobInfo[]; matrix: { id: string } }>("/jobs/matrix", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function enqueueAppMapFlow(
  request: ServerRequest,
  input: {
    appMapId: string;
    flowId: string;
    throughConnectionId?: string;
    serial?: string;
    targetKind: "browser" | "device";
    browserTargetId?: string;
    platform?: "android" | "ios";
    variables?: Record<string, string | string[]>;
  },
): Promise<{ job: JobInfo; jobs: JobInfo[] }> {
  const { appMapId, flowId, ...body } = input;
  return request<{ job: JobInfo; jobs: JobInfo[] }>(
    `/app-maps/${encodeURIComponent(appMapId)}/flows/${encodeURIComponent(flowId)}/run`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function enqueueAppMapConnection(
  request: ServerRequest,
  input: {
    appMapId: string;
    connectionId: string;
    serial?: string;
    targetKind: "browser" | "device";
    browserTargetId?: string;
    platform?: "android" | "ios";
    variables?: Record<string, string | string[]>;
  },
): Promise<{ job: JobInfo; jobs: JobInfo[] }> {
  const { appMapId, connectionId, ...body } = input;
  return request<{ job: JobInfo; jobs: JobInfo[] }>(
    `/app-maps/${encodeURIComponent(appMapId)}/connections/${encodeURIComponent(connectionId)}/run`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function enqueueMatrix(
  request: ServerRequest,
  input: {
    recipe: string;
    matrixId: string;
    repetitions: number;
    prodAccountMatch?: string;
  },
): Promise<{ jobs: JobInfo[]; matrix: MatrixExpansion }> {
  return request<{ jobs: JobInfo[]; matrix: MatrixExpansion }>("/jobs/compatibility-matrix", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type LocaleMatrixInput = LocaleMatrixMaterializationInput & {
  serial?: string;
  platform?: string;
  targetKind?: "browser" | "device";
  browserTargetId?: string;
  title?: string;
  /** Optional explicit local execution lane for each locale case. This is
   * transport-only: the caller must provide the matching shared admission. */
  caseTargetBindings?: Array<{
    caseIndex: number;
    locale: string;
    executionTarget: LocalAgentDeviceExecutionTargetRef;
  }>;
  /** Same target/Test cohort deadline evidence used by Combine. */
  localAdmission?: LocalCampaignAdmissionRequest;
};

/**
 * Taught a11y rows name picker options only. Without entry/language paths each
 * locale job would tap those rows on the launch screen. Fill the Grok iOS
 * picker prelude (same seed as core defaultGrokLocaleScope) when the UI/infer
 * scope omitted nav.
 */
export function withLocalePickerNav<
  T extends {
    locales: string[];
    app?: string;
    entryPath?: unknown[];
    languagePath?: unknown[];
    languageOptions?: Record<
      string,
      string | { label?: string; identifier?: string; text?: string }
    >;
  },
>(scope: T): T {
  if ((scope.entryPath?.length ?? 0) > 0 || (scope.languagePath?.length ?? 0) > 0) return scope;
  return {
    ...scope,
    app: scope.app?.trim() || "ai.x.GrokApp",
    entryPath: [
      { kind: "tap", target: { identifier: "navigation.tab.ask" } },
      { kind: "wait", ms: 400 },
      { kind: "tap", target: { identifier: "sidebar.open.button" } },
      { kind: "wait", ms: 500 },
      { kind: "tap", target: { identifier: "sidebar.settings.button" } },
      { kind: "wait", ms: 700 },
    ],
    languagePath: [
      { kind: "tap", target: { text: "App Language" } },
      { kind: "wait", ms: 1200 },
      { kind: "openApp", app: "com.apple.Preferences", relaunch: false },
      { kind: "wait", ms: 900 },
      { kind: "tap", target: { text: "Language" } },
      { kind: "wait", ms: 700 },
    ],
  };
}

/** Build the locale-matrix POST body. An explicit taught/inferred scope wins over Grok presets. */
export function buildLocaleMatrixInput(input: {
  recipe?: string;
  appMapId?: string;
  flowId?: string;
  testId?: string;
  variableId?: string;
  expectedAppMapRevision?: number;
  serial?: string;
  targetKind?: "browser" | "device";
  platform?: string;
  locales: string[];
  scope?: LocaleMatrixMaterializedScope;
  title?: string;
  projectId: string;
  preset?: "grok";
  profileId?: string;
  caseTargetBindings?: LocaleMatrixInput["caseTargetBindings"];
  localAdmission?: LocalCampaignAdmissionRequest;
}): LocaleMatrixInput {
  const hasExplicitCaseTargets = input.caseTargetBindings !== undefined;
  if (!hasExplicitCaseTargets && (!input.serial?.trim() || !input.targetKind)) {
    throw new Error("A legacy locale matrix start needs a selected serial and target kind");
  }
  const target = hasExplicitCaseTargets
    ? {}
    : input.targetKind === "browser"
      ? { targetKind: "browser" as const, browserTargetId: input.serial!.trim() }
      : {
          targetKind: "device" as const,
          platform: input.platform,
          serial: input.serial!.trim(),
        };
  const source =
    input.appMapId?.trim() && input.testId?.trim() && input.variableId?.trim()
      ? {
          appMapId: input.appMapId.trim(),
          testId: input.testId.trim(),
          variableId: input.variableId.trim(),
          ...(input.expectedAppMapRevision !== undefined
            ? { expectedAppMapRevision: input.expectedAppMapRevision }
            : {}),
        }
      : input.appMapId?.trim() && input.flowId?.trim()
        ? {
            appMapId: input.appMapId.trim(),
            flowId: input.flowId.trim(),
            ...(input.expectedAppMapRevision !== undefined
              ? { expectedAppMapRevision: input.expectedAppMapRevision }
              : {}),
          }
        : { recipe: input.recipe?.trim() || "" };
  if (input.scope) {
    const locales = input.scope.locales.length ? input.scope.locales : input.locales;
    return {
      ...source,
      ...target,
      locales,
      scope: { ...input.scope, locales },
      title: input.title,
      projectId: input.projectId,
      ...(input.preset ? { preset: input.preset } : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.caseTargetBindings === undefined
        ? {}
        : { caseTargetBindings: structuredClone(input.caseTargetBindings) }),
      ...(input.localAdmission === undefined
        ? {}
        : { localAdmission: structuredClone(input.localAdmission) }),
    };
  }
  return {
    ...source,
    ...target,
    locales: input.locales,
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    title: input.title,
    projectId: input.projectId,
    ...(input.caseTargetBindings === undefined
      ? {}
      : { caseTargetBindings: structuredClone(input.caseTargetBindings) }),
    ...(input.localAdmission === undefined
      ? {}
      : { localAdmission: structuredClone(input.localAdmission) }),
  };
}

/** Resolve the complete, frozen locale case list before any target is bound.
 * This is deliberately separate from enqueue: it cannot inspect a device,
 * reserve capacity, or turn an active UI selection into an implicit target. */
export async function materializeLocaleMatrix(
  request: ServerRequest,
  input: LocaleMatrixMaterializationInput,
): Promise<LocaleMatrixMaterialization> {
  return request("/jobs/locale-matrix/materialize", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function inferLocaleMatrix(
  request: ServerRequest,
  input: {
    nodes: unknown[];
    examples: Array<{ locale: string; identifier?: string; label?: string; text?: string }>;
    locales?: string[];
    app?: string;
    appMapId?: string;
    bodyFlowId?: string;
    flowId?: string;
    selectedConnectionId?: string;
    liveScreenId?: string;
    entryPath?: unknown[];
    languagePath?: unknown[];
    screenshotEachLocale?: boolean;
    restoreLocale?: string;
  },
): Promise<{
  inferred: {
    locales: string[];
    options: Array<{ locale: string; identifier?: string; label?: string; text?: string }>;
    languageOptions: Record<string, { identifier?: string; label?: string; text?: string }>;
  };
  scope: LocaleMatrixInput["scope"];
}> {
  return request("/jobs/locale-matrix/infer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function inferOptionMatrix(
  request: ServerRequest,
  input: {
    nodes: unknown[];
    examples: Array<{ id: string; identifier?: string; label?: string; text?: string }>;
    kind?: string;
    name?: string;
    appMapId?: string;
    inConnectionId?: string;
    outConnectionId?: string;
    listScreenId?: string;
    entryPath?: unknown[];
    pickerPath?: unknown[];
  },
): Promise<{
  inferred: {
    locales: string[];
    options: Array<{ locale: string; identifier?: string; label?: string; text?: string }>;
  };
  variable: {
    id: string;
    name: string;
    kind: string;
    apply: { kind: string; entryPath?: unknown[]; pickerPath?: unknown[] };
    options: Array<{ id: string; identifier?: string; label?: string; text?: string }>;
  };
}> {
  return request("/jobs/combine/infer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function enqueueOptionMatrix(
  request: ServerRequest,
  input: {
    appMapId: string;
    flowId?: string;
    testId?: string;
    combineId?: string;
    capture?: AppMapCapturePolicy;
    /** Legacy one-target execution. Omit only when `cellTargetBindings` is
     * present: a bound local campaign must never fall back to this target. */
    serial?: string;
    targetKind?: "browser" | "device";
    platform?: string;
    variableIds?: string[];
    selected?: Record<string, string[]>;
    strategy?: "zip" | "cartesian" | "pairwise";
    title?: string;
    projectId: string;
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
    /** Generic, provenance-backed local deadline request. This is the same
     * protocol value used by Combine campaigns and locale matrix callers. */
    localAdmission?: LocalCampaignAdmissionRequest;
  },
): Promise<{
  batch: {
    id: string;
    title: string;
    worlds: string[];
    recipeId: string;
    expectedScreenshotsPerWorld?: number;
    expectedScreenshots?: number;
  };
  jobs: JobInfo[];
  matrix: { id: string };
  campaign?: CombineCampaign;
}> {
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
  return request("/jobs/combine", {
    method: "POST",
    body: JSON.stringify({
      appMapId: input.appMapId,
      flowId: input.flowId,
      testId: input.testId,
      combineId: input.combineId,
      capture: input.capture,
      variableIds: input.variableIds,
      selected: input.selected,
      strategy: input.strategy,
      title: input.title,
      projectId: input.projectId,
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
    }),
  });
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
  request: ServerRequest,
  input: CampaignDurationCohortEstimateRemoteInput,
): Promise<CampaignDurationCohortEstimateRemoteResult> {
  return request("/campaign-duration/cohorts/estimate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Exact public, read-only admission input/output, reusable by locale and future
 * farms. Start repeats this check under its admission lock before reservation. */
export type LocalCampaignAdmissionPreflightRemoteInput = LocalCampaignAdmissionPreflightRequest;
export type LocalCampaignAdmissionPreflightRemoteResult = LocalCampaignAdmissionPreflightResponse;

export async function preflightLocalCampaignAdmissionRemote(
  request: ServerRequest,
  input: LocalCampaignAdmissionPreflightRemoteInput,
): Promise<LocalCampaignAdmissionPreflightRemoteResult> {
  return request("/jobs/local-admission/preflight", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getCombineCampaignRemote(
  request: ServerRequest,
  batchId: string,
): Promise<CombineCampaign> {
  const result = await request<{ campaign: CombineCampaign }>(
    `/jobs/combine/${encodeURIComponent(batchId)}/campaign`,
  );
  return result.campaign;
}

export async function resumeCombineCampaignRemote(
  request: ServerRequest,
  batchId: string,
  reviewed = false,
): Promise<{ campaign: CombineCampaign; jobs: JobInfo[] }> {
  return request(`/jobs/combine/${encodeURIComponent(batchId)}/resume`, {
    method: "POST",
    body: JSON.stringify({ reviewed }),
  });
}

export async function cancelCombineCampaignRemote(
  request: ServerRequest,
  batchId: string,
): Promise<CombineCampaign> {
  const result = await request<{ campaign: CombineCampaign }>(
    `/jobs/combine/${encodeURIComponent(batchId)}/cancel`,
    { method: "POST", body: "{}" },
  );
  return result.campaign;
}

export async function saveTestRemote(
  request: ServerRequest,
  input: {
    appMapId: string;
    expectedRevision: number;
    test: AppMapTest;
  },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/tests/${encodeURIComponent(input.test.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision: input.expectedRevision, test: input.test }),
    },
  );
}

export async function editTestRemote(
  request: ServerRequest,
  input: {
    appMapId: string;
    testId: string;
    expectedRevision: number;
    eventId?: string;
    edits: AppMapScenarioTestEdit[];
  },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/tests/${encodeURIComponent(input.testId)}/edit`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        ...(input.eventId ? { eventId: input.eventId } : {}),
        edits: input.edits,
      }),
    },
  );
}

export async function saveCombineRemote(
  request: ServerRequest,
  input: {
    appMapId: string;
    expectedRevision: number;
    combine: {
      id: string;
      organizationId: string;
      projectId: string;
      appMapId: string;
      name: string;
      variableIds: string[];
      testIds: string[];
      selected?: Record<string, string[]>;
      captures?: Record<string, AppMapCapturePolicy>;
      cellRuntimeProfiles?: Array<{
        testId: string;
        values: Record<string, string>;
        targetProfileId: string;
      }>;
      strategy?: "zip" | "cartesian" | "pairwise";
      createdAt: number;
      updatedAt: number;
    };
  },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/combines/${encodeURIComponent(input.combine.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ expectedRevision: input.expectedRevision, combine: input.combine }),
    },
  );
}

export async function preflightCombineRemote(
  request: ServerRequest,
  input: { appMapId: string; combineId: string; serial?: string },
): Promise<AppMapCombinePreflight> {
  const { appMapId, combineId, ...body } = input;
  const result = await request<{ preflight: AppMapCombinePreflight }>(
    `/app-maps/${encodeURIComponent(appMapId)}/combines/${encodeURIComponent(combineId)}/preflight`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return result.preflight;
}

export async function removeCombineRemote(
  request: ServerRequest,
  input: { appMapId: string; combineId: string; expectedRevision: number },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/combines/${encodeURIComponent(input.combineId)}/remove`,
    {
      method: "POST",
      body: JSON.stringify({ expectedRevision: input.expectedRevision }),
    },
  );
}

export async function saveVariableRemote(
  request: ServerRequest,
  input: {
    appMapId: string;
    variable: {
      id: string;
      organizationId: string;
      projectId: string;
      appMapId: string;
      name: string;
      kind: string;
      apply: unknown;
      options: unknown[];
      createdAt: number;
      updatedAt: number;
    };
    expectedRevision: number;
  },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/variables/${encodeURIComponent(input.variable.id)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        variable: input.variable,
      }),
    },
  );
}

export async function removeVariableRemote(
  request: ServerRequest,
  input: { appMapId: string; variableId: string; expectedRevision: number },
): Promise<{ appMap: { revision: number } }> {
  return request(
    `/app-maps/${encodeURIComponent(input.appMapId)}/variables/${encodeURIComponent(input.variableId)}/remove`,
    {
      method: "POST",
      body: JSON.stringify({ expectedRevision: input.expectedRevision }),
    },
  );
}

export async function enqueueLocaleMatrix(
  request: ServerRequest,
  input: LocaleMatrixInput,
): Promise<{
  batch: { id: string; title: string; locales: string[]; recipeId: string };
  jobs: JobInfo[];
  matrix: { id: string };
}> {
  return request("/jobs/locale-matrix", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type ExportedPack = {
  rootDir: string;
  manifest: LocaleRunPackManifest;
  jobIds: string[];
};

export async function exportLocaleMatrixPack(
  request: ServerRequest,
  batchId: string,
): Promise<ExportedPack> {
  return request(`/jobs/locale-matrix/${encodeURIComponent(batchId)}/export`);
}

export async function exportRunMatrixPack(
  request: ServerRequest,
  batchId: string,
): Promise<ExportedPack> {
  return request(`/jobs/combine/${encodeURIComponent(batchId)}/export`);
}

/**
 * The findings for a batch without exporting it. The grid asks for these while
 * the sweep is still running, so it must not write a pack to answer.
 */
export async function loadMatrixAnalysis(
  request: ServerRequest,
  batchId: string,
): Promise<LocaleRunAnalysisReport> {
  return request(`/jobs/locale-matrix/${encodeURIComponent(batchId)}/analysis`);
}

export async function loadMatrixReport(
  request: ServerRequest,
  batchId: string,
): Promise<CompatibilityReport> {
  const data = await request<{ report: CompatibilityReport }>(
    `/reports/matrix/${encodeURIComponent(batchId)}`,
  );
  return data.report;
}

export async function retryJob(request: ServerRequest, jobId: string): Promise<JobInfo> {
  const data = await request<{ job: JobInfo }>(`/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: "{}",
  });
  return data.job;
}

/** Re-run the immutable plan saved with a completed run, even after restart. */
export async function replayRecordedRun(request: ServerRequest, runId: string): Promise<JobInfo> {
  const data = await request<{ job: JobInfo }>(`/runs/${encodeURIComponent(runId)}/replay`, {
    method: "POST",
    body: "{}",
  });
  return data.job;
}
