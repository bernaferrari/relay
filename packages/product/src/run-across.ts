import type {
  AppMap,
  AppMapVariable,
  AuthoringTarget,
  FailureCategory,
  RepeatFailureKind,
  RepeatFailureClusterReport,
} from "@relay/protocol";
import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RelayOperationPort,
} from "@relay/workflows/operation-port";
import { routeUrls } from "./routes.js";

/** The public name for the saved values applied while running a Test. */
export type ProductDataSetDimension = {
  readonly id: string;
  readonly name: string;
  readonly kind: AppMapVariable["kind"];
  readonly values: readonly ProductDataSetValue[];
};

export type ProductDataSetValue = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
};

export type ProductRunAcrossSetup = {
  readonly appMapId: string;
  readonly appMapRevision: number;
  readonly testId: string;
  readonly testName: string;
  readonly appName: string;
  readonly dataSet: {
    readonly name: string;
    readonly dimensions: readonly ProductDataSetDimension[];
  };
};

export type ProductRunAcrossTarget = AuthoringTarget & {
  readonly label?: string;
};

export type ProductRunAcrossPreview = {
  readonly selected: Readonly<Record<string, readonly string[]>>;
  readonly target: ProductRunAcrossTarget;
  readonly caseCount: number;
  readonly pilot: Readonly<Record<string, string>>;
  readonly scopeLabel: string;
};

export type ProductBatchStatus =
  | "pilot-running"
  | "ready-to-continue"
  | "running"
  | "completed"
  | "completed-with-problems"
  | "needs-review"
  | "cancelled";

export type ProductBatchCase = {
  readonly id: string;
  readonly executionCaseId?: string;
  readonly index: number;
  readonly phase: "pilot" | "coverage";
  readonly status: "pending" | "queued" | "running" | "passed" | "failed" | "blocked" | "cancelled";
  readonly values: Readonly<Record<string, string>>;
  readonly world?: string;
  readonly runId?: string;
  /** Present only when durable execution state identifies both the Test and
   * its bound environment. Legacy campaigns remain readable without an
   * invented identity. */
  readonly identity?: ProductBatchResultIdentity;
  readonly priorRunIds?: readonly string[];
  readonly error?: string;
};

/** Stable product identity for one Test × environment result. The environment
 * id is the saved target profile identity. Legacy records without that binding
 * omit the identity rather than repurposing a provider serial; this is never a
 * credential or readiness claim. */
export type ProductBatchResultIdentity = {
  readonly testId: string;
  readonly environmentId: string;
  readonly environmentPlatform: "android" | "ios" | "browser";
  readonly runId?: string;
};

export type ProductBatchFailureSignature = {
  readonly kind: RepeatFailureKind;
  readonly digest: string;
  readonly summary: string;
  readonly failureCategory?: FailureCategory;
  readonly checkIds: readonly string[];
};

/** Compact, product-safe cluster projection. Raw failure keys and artifact
 * payloads remain behind the evidence routes; members stay addressable by
 * their exact case ids for selective reruns. */
export type ProductBatchFailureCluster = {
  readonly id: string;
  readonly kind: RepeatFailureKind;
  readonly signature: ProductBatchFailureSignature;
  readonly environmentId: string;
  readonly representativeCaseId: string;
  readonly representativeRunId: string;
  readonly caseIds: readonly string[];
};

export type ProductBatchFailureClusterReport = {
  readonly campaignId: string;
  readonly clusters: readonly ProductBatchFailureCluster[];
};

export type ProductBatchSelectionInput = {
  readonly caseIds?: readonly string[];
  readonly executionCaseIds?: readonly string[];
  readonly clusterIds?: readonly string[];
};

export type ProductBatchSelection = {
  readonly caseIds: readonly string[];
  readonly clusterIds: readonly string[];
};

export type ProductRunAcrossBatch = {
  readonly id: string;
  readonly title: string;
  readonly status: ProductBatchStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly totalCases: number;
  readonly completedCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly pendingCases: number;
  readonly targetNames: readonly string[];
  readonly runIds: readonly string[];
  readonly cases: readonly ProductBatchCase[];
  readonly setup?: ProductRunAcrossSetup;
  readonly navigation: { readonly route: string; readonly href: string };
};

export type ProductBatchReport = ProductRunAcrossBatch & {
  readonly report: {
    readonly headline: string;
    readonly detail: string;
  };
  readonly export?: { readonly rootDir: string; readonly jobIds: readonly string[] };
};

export type ProductRunAcrossStartInput = {
  readonly setup: ProductRunAcrossSetup;
  readonly selected: Readonly<Record<string, readonly string[]>>;
  readonly target: ProductRunAcrossTarget;
  readonly pilot?: Readonly<Record<string, string>>;
  readonly executionMode?: "pilot" | "all";
};

export type ProductRunAcrossService = {
  getSetup(appMapId: string, testId: string): Promise<ProductRunAcrossSetup>;
  preview(input: {
    setup: ProductRunAcrossSetup;
    selected: Readonly<Record<string, readonly string[]>>;
    target: ProductRunAcrossTarget;
    pilot?: Readonly<Record<string, string>>;
  }): ProductRunAcrossPreview;
  startPilot(input: ProductRunAcrossStartInput): Promise<ProductRunAcrossBatch>;
  continue(batchId: string): Promise<ProductRunAcrossBatch>;
  inspect(batchId: string): Promise<ProductRunAcrossBatch>;
  getFailureClusters(
    batchId: string,
    filters?: { failureKind?: RepeatFailureKind; environmentId?: string },
  ): Promise<ProductBatchFailureClusterReport>;
  select(batchId: string, input: ProductBatchSelectionInput): Promise<ProductBatchSelection>;
  rerun(batchId: string, input: ProductBatchSelectionInput): Promise<ProductRunAcrossBatch>;
  cancel(batchId: string): Promise<ProductRunAcrossBatch>;
  getReport(batchId: string): Promise<ProductBatchReport>;
  exportReport(batchId: string): Promise<ProductBatchReport>;
  /** Authenticated binary export for UI consumers. */
  downloadExport?(batchId: string): Promise<Blob>;
};

type CampaignCase = {
  index?: number;
  cellId?: string;
  executionCaseId?: string;
  values?: Record<string, string>;
  world?: string;
  phase?: "pilot" | "coverage";
  status?: string;
  runId?: string;
  priorRunIds?: string[];
  error?: string;
  testId?: string;
  targetProfileId?: string;
  target?: { targetId?: string; platform?: string };
};

type Campaign = {
  id: string;
  title?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  appMapId: string;
  cases: readonly CampaignCase[];
  target?: { targetId?: string; platform?: string };
  execution?: { selected?: Record<string, string[]> };
};

type CampaignResponse = { campaign: Campaign };

type ProductTargetPlatform = "android" | "ios" | "browser";

function targetPlatform(value: string | undefined): ProductTargetPlatform | undefined {
  return value === "android" || value === "ios" || value === "browser" ? value : undefined;
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 8_192) : fallback;
}

function valueLabel(value: {
  id: string;
  label?: string;
  text?: string;
  identifier?: string;
}): string {
  return nonEmpty(value.label ?? value.text ?? value.identifier, value.id);
}

function projectDimension(variable: AppMapVariable): ProductDataSetDimension {
  return {
    id: variable.id,
    name: nonEmpty(variable.name, variable.id),
    kind: variable.kind,
    values: variable.options.map((option) => ({
      id: option.id,
      label: valueLabel(option),
      ...(option.identifier && option.identifier !== option.label
        ? { detail: option.identifier }
        : {}),
    })),
  };
}

function mapForTest(map: AppMap, testId: string): ProductRunAcrossSetup {
  const test = map.tests[testId];
  if (!test) throw new TypeError(`Test ${testId} is not available in this app.`);
  const dimensions = Object.values(map.variables ?? {}).map(projectDimension);
  return {
    appMapId: map.id,
    appMapRevision: map.revision,
    testId: test.id,
    testName: nonEmpty(test.name, "Saved Test"),
    appName: nonEmpty(map.name, "App"),
    dataSet: {
      name: dimensions.length ? "Saved data" : "Default data",
      dimensions,
    },
  };
}

function normalizedSelection(
  setup: ProductRunAcrossSetup,
  selected: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const known = new Set(setup.dataSet.dimensions.map((dimension) => dimension.id));
  const unknown = Object.keys(selected).find((id) => !known.has(id));
  if (unknown) throw new TypeError(`The selected data dimension ${unknown} is not available.`);
  for (const dimension of setup.dataSet.dimensions) {
    const allowed = new Set(dimension.values.map((value) => value.id));
    const requested = selected[dimension.id];
    if (requested === undefined) continue;
    const values = [...new Set(requested)].filter((value) => allowed.has(value));
    if (!values.length) throw new TypeError(`Choose at least one value for ${dimension.name}.`);
    result[dimension.id] = values;
  }
  if (!Object.keys(result).length) throw new TypeError("Choose at least one data value.");
  return result;
}

function cartesianCount(selected: Readonly<Record<string, readonly string[]>>): number {
  return Object.values(selected).reduce((total, values) => total * values.length, 1);
}

function representativeCase(
  setup: ProductRunAcrossSetup,
  selected: Readonly<Record<string, readonly string[]>>,
  explicit?: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const dimension of setup.dataSet.dimensions) {
    const values = selected[dimension.id];
    if (!values?.length) continue;
    const value = explicit?.[dimension.id] ?? values[0];
    if (!value || !values.includes(value)) {
      throw new TypeError(`${dimension.name} is not included in the selected data scope.`);
    }
    result[dimension.id] = value;
  }
  return result;
}

function mapStatus(status: string): ProductBatchStatus {
  if (status === "pilot-running") return "pilot-running";
  if (status === "ready-to-resume") return "ready-to-continue";
  if (status === "completed-with-problems") return "completed-with-problems";
  if (status === "needs-review") return "needs-review";
  if (status === "cancelled") return "cancelled";
  if (status === "completed") return "completed";
  return "running";
}

function batchFromCampaign(
  campaign: Campaign,
  setup?: ProductRunAcrossSetup,
): ProductRunAcrossBatch {
  const cases = campaign.cases ?? [];
  const passedCases = cases.filter((item) => item.status === "passed").length;
  const failedCases = cases.filter((item) => item.status === "failed").length;
  const completedCases = cases.filter((item) =>
    ["passed", "failed", "blocked", "cancelled"].includes(item.status ?? ""),
  ).length;
  const runIds = cases.flatMap((item) => (item.runId ? [item.runId] : []));
  const targetNames = [
    ...new Set(
      cases.flatMap((item) => {
        const target = item.target?.targetId;
        if (!target) return [];
        if (setup?.dataSet && setup) {
          // A campaign stores the canonical target id. The product boundary
          // must not turn that machine identity into user-facing copy.
          return ["Selected environment"];
        }
        return [
          /^(?:emulator[-_:]|browser[-_:]|[0-9a-f]{16,})/iu.test(target)
            ? "Selected environment"
            : target,
        ];
      }),
    ),
  ];
  return {
    id: campaign.id,
    title: nonEmpty(campaign.title, setup?.testName ?? "Run Across"),
    status: mapStatus(campaign.status),
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    totalCases: cases.length,
    completedCases,
    passedCases,
    failedCases,
    pendingCases: Math.max(0, cases.length - completedCases),
    targetNames,
    runIds,
    cases: cases.map((item, index) => {
      const target = item.target ?? campaign.target;
      const platform = targetPlatform(target?.platform);
      return {
        id: item.executionCaseId ?? item.cellId ?? `case-${index + 1}`,
        ...(item.executionCaseId ? { executionCaseId: item.executionCaseId } : {}),
        index: item.index ?? index,
        phase: item.phase ?? (index === 0 ? "pilot" : "coverage"),
        status: productCaseStatus(item.status),
        values: { ...item.values },
        ...(item.world ? { world: item.world } : {}),
        ...(item.runId ? { runId: item.runId } : {}),
        ...(item.priorRunIds?.length ? { priorRunIds: [...item.priorRunIds] } : {}),
        ...(item.testId && item.targetProfileId && platform
          ? {
              identity: {
                testId: item.testId,
                environmentId: item.targetProfileId,
                environmentPlatform: platform,
                ...(item.runId ? { runId: item.runId } : {}),
              },
            }
          : {}),
        ...(item.error ? { error: item.error } : {}),
      };
    }),
    ...(setup ? { setup } : {}),
    navigation: { route: routeUrls.batch(campaign.id), href: routeUrls.batch(campaign.id) },
  };
}

function productFailureClusters(
  report: RepeatFailureClusterReport,
): ProductBatchFailureClusterReport {
  return {
    campaignId: report.campaignId,
    clusters: report.clusters.map((cluster) => ({
      id: cluster.id,
      kind: cluster.kind,
      signature: {
        kind: cluster.signature.kind,
        digest: cluster.signature.digest,
        summary: cluster.signature.summary,
        ...(cluster.signature.failureCategory
          ? { failureCategory: cluster.signature.failureCategory }
          : {}),
        checkIds: [...cluster.signature.checkIds],
      },
      environmentId: cluster.cohort,
      representativeCaseId: cluster.representativeCellId,
      representativeRunId: cluster.representativeRunId,
      caseIds: cluster.cases.map(
        (item) => (item as { executionCaseId?: string }).executionCaseId ?? item.cellId,
      ),
    })),
  };
}

function uniqueIds(values: readonly string[] | undefined, label: string): string[] {
  if (values === undefined) return [];
  const ids = values.map((value) => value.trim());
  if (ids.some((value) => !value) || new Set(ids).size !== ids.length) {
    throw new TypeError(`${label} must contain unique non-empty ids.`);
  }
  return ids;
}

/** Resolve a bulk case/cluster selection against one current product batch.
 * Only terminal non-passing results with immutable Run evidence are eligible;
 * pending, active, and passed cases can never be silently rerun. */
export function selectProductBatchCases(
  batch: Pick<ProductRunAcrossBatch, "id" | "cases">,
  input: ProductBatchSelectionInput,
  clusters?: ProductBatchFailureClusterReport,
): ProductBatchSelection {
  const requestedCaseIds = uniqueIds(input.caseIds, "caseIds");
  const requestedExecutionCaseIds = uniqueIds(input.executionCaseIds, "executionCaseIds");
  const requestedClusterIds = uniqueIds(input.clusterIds, "clusterIds");
  if (
    !requestedCaseIds.length &&
    !requestedExecutionCaseIds.length &&
    !requestedClusterIds.length
  ) {
    throw new TypeError("Choose at least one failed Batch case or failure cluster.");
  }
  if (requestedClusterIds.length) {
    if (!clusters || clusters.campaignId !== batch.id) {
      throw new TypeError("Current failure clusters are required for cluster selection.");
    }
    const known = new Set(clusters.clusters.map((cluster) => cluster.id));
    const unknown = requestedClusterIds.find((id) => !known.has(id));
    if (unknown) throw new TypeError(`Failure cluster ${unknown} is not in this Batch.`);
  }
  const selected = new Set([...requestedCaseIds, ...requestedExecutionCaseIds]);
  for (const cluster of clusters?.clusters ?? []) {
    if (requestedClusterIds.includes(cluster.id)) {
      for (const caseId of cluster.caseIds) selected.add(caseId);
    }
  }
  const byId = new Map(batch.cases.map((item) => [item.id, item]));
  for (const caseId of selected) {
    const item = byId.get(caseId);
    if (!item) throw new TypeError(`Batch case ${caseId} is not present.`);
    if (item.status !== "failed" && item.status !== "blocked" && item.status !== "cancelled") {
      throw new TypeError(`Batch case ${caseId} is ${item.status} and cannot be rerun.`);
    }
    if (!item.runId) {
      throw new TypeError(`Batch case ${caseId} has no immutable Run evidence.`);
    }
  }
  return {
    caseIds: [...selected].sort(),
    clusterIds: [...requestedClusterIds].sort(),
  };
}

function productCaseStatus(value: string | undefined): ProductBatchCase["status"] {
  if (
    value === "pending" ||
    value === "queued" ||
    value === "running" ||
    value === "passed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "cancelled"
  )
    return value;
  return "pending";
}

export function previewProductRunAcross(input: {
  setup: ProductRunAcrossSetup;
  selected: Readonly<Record<string, readonly string[]>>;
  target: ProductRunAcrossTarget;
  pilot?: Readonly<Record<string, string>>;
}): ProductRunAcrossPreview {
  const selected = normalizedSelection(input.setup, input.selected);
  const pilot = representativeCase(input.setup, selected, input.pilot);
  const caseCount = cartesianCount(selected);
  return {
    selected,
    target: input.target,
    caseCount,
    pilot,
    scopeLabel: `${caseCount} ${caseCount === 1 ? "case" : "cases"} on ${input.target.label ?? input.target.targetId}`,
  };
}

function reportFor(
  batch: ProductRunAcrossBatch,
  exported?: ProductBatchReport["export"],
): ProductBatchReport {
  const summary = summarizeProductBatch(batch);
  return {
    ...batch,
    report: {
      headline: summary.headline,
      detail: summary.detail,
    },
    ...(exported ? { export: exported } : {}),
  };
}

export function summarizeProductBatch(batch: ProductRunAcrossBatch): {
  readonly headline: string;
  readonly detail: string;
} {
  const counts = batch.cases.reduce(
    (result, item) => {
      result[item.status] += 1;
      return result;
    },
    { passed: 0, failed: 0, blocked: 0, cancelled: 0, pending: 0, queued: 0, running: 0 },
  );
  const total = batch.cases.length;
  const terminal = counts.passed + counts.failed + counts.blocked + counts.cancelled;
  const unresolved = counts.pending + counts.queued + counts.running;
  const detail = `${counts.passed} passed · ${counts.failed} failed · ${counts.blocked} blocked · ${counts.cancelled} cancelled · ${unresolved} remaining`;
  let headline: string;
  if (batch.status === "cancelled" || (counts.cancelled === total && total > 0))
    headline = "Batch was cancelled";
  else if (total === 0 && batch.status === "completed") headline = "No cases were run";
  else if (counts.blocked === total && total > 0) headline = "All selected cases are blocked";
  else if (counts.passed === total && total > 0) headline = "All selected cases passed";
  else if (counts.cancelled || counts.blocked || counts.failed) {
    headline = `${terminal === total ? "Batch completed with" : "Batch has"} ${counts.failed + counts.blocked + counts.cancelled} cases needing attention`;
  } else headline = "Batch is still in progress";
  return { headline, detail };
}

export function createProductRunAcrossService(
  client: RelayInvokeClient,
  injectedOperations?: RelayOperationPort,
): ProductRunAcrossService {
  const operations = injectedOperations ?? createRelayOperationPort(client);
  async function getSetup(appMapId: string, testId: string): Promise<ProductRunAcrossSetup> {
    const { appMap } = await operations.invoke("app-map.get", { appMapId });
    return mapForTest(appMap, testId);
  }

  async function campaign(batchId: string, setup?: ProductRunAcrossSetup) {
    const response = (await operations.invoke("job.combine.campaign.get", {
      batchId,
    })) as CampaignResponse;
    return batchFromCampaign(response.campaign, setup);
  }

  async function failureClusters(
    batchId: string,
    filters?: { failureKind?: RepeatFailureKind; environmentId?: string },
  ): Promise<ProductBatchFailureClusterReport> {
    const report = await operations.invoke("job.combine.campaign.repeat.clusters", {
      batchId,
      ...(filters?.failureKind ? { failureKind: filters.failureKind } : {}),
      ...(filters?.environmentId ? { cohort: filters.environmentId } : {}),
    });
    if (report.campaignId !== batchId) {
      throw new TypeError("Relay returned failure clusters for a different Batch.");
    }
    return productFailureClusters(report);
  }

  return {
    getSetup,
    preview: previewProductRunAcross,
    async startPilot(input) {
      const selected = normalizedSelection(input.setup, input.selected);
      const pilot = representativeCase(input.setup, selected, input.pilot);
      const target = input.target;
      const output = await operations.invoke("app-map.test.run", {
        appMapId: input.setup.appMapId,
        testId: input.setup.testId,
        expectedRevision: input.setup.appMapRevision,
        target,
        in: selected,
        strategy: "cartesian",
        pilotCase: pilot,
        lens: "visual",
        executionMode: input.executionMode ?? "pilot",
      });
      const batchId = output.campaign?.id;
      if (!batchId) throw new TypeError("Relay did not create a durable Batch Report.");
      const batch = await campaign(batchId, input.setup);
      return {
        ...batch,
        targetNames: [input.target.label ?? "Selected environment"],
      };
    },
    async continue(batchId) {
      await operations.invoke("job.combine.campaign.resume", { batchId, reviewed: true });
      return campaign(batchId);
    },
    async inspect(batchId) {
      return campaign(batchId);
    },
    async getFailureClusters(batchId, filters) {
      return failureClusters(batchId, filters);
    },
    async select(batchId, input) {
      const clusterIds = uniqueIds(input.clusterIds, "clusterIds");
      const batch = await campaign(batchId);
      const clusters = clusterIds.length ? await failureClusters(batchId) : undefined;
      return selectProductBatchCases(batch, input, clusters);
    },
    async rerun(batchId, input) {
      const clusterIds = uniqueIds(input.clusterIds, "clusterIds");
      const batch = await campaign(batchId);
      const clusters = clusterIds.length ? await failureClusters(batchId) : undefined;
      const selection = selectProductBatchCases(batch, input, clusters);
      const selectedCases = batch.cases.filter((item) => selection.caseIds.includes(item.id));
      await operations.invoke("job.combine.campaign.resume", {
        batchId,
        reviewed: true,
        ...(selectedCases.some((item) => item.executionCaseId)
          ? { executionCaseIds: [...selection.caseIds] }
          : { cellIds: [...selection.caseIds] }),
      });
      return campaign(batchId);
    },
    async cancel(batchId) {
      await operations.invoke("job.combine.campaign.cancel", { batchId });
      return campaign(batchId);
    },
    async getReport(batchId) {
      return reportFor(await campaign(batchId));
    },
    async exportReport(batchId) {
      const batch = await campaign(batchId);
      const exported = await operations.invoke("job.combine.export", { batchId });
      return reportFor(batch, { rootDir: exported.rootDir, jobIds: exported.jobIds });
    },
  };
}
