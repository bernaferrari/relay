import type { AppMap, AppMapVariable, AuthoringTarget } from "@relay/protocol";
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
  cancel(batchId: string): Promise<ProductRunAcrossBatch>;
  getReport(batchId: string): Promise<ProductBatchReport>;
  exportReport(batchId: string): Promise<ProductBatchReport>;
};

type CampaignCase = {
  status?: string;
  runId?: string;
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
  execution?: { selected?: Record<string, string[]> };
};

type CampaignResponse = { campaign: Campaign };

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
    ["passed", "failed", "cancelled"].includes(item.status ?? ""),
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
    ...(setup ? { setup } : {}),
    navigation: { route: routeUrls.batch(campaign.id), href: routeUrls.batch(campaign.id) },
  };
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
  const headline =
    batch.status === "completed" && batch.failedCases === 0
      ? "All selected cases passed"
      : batch.failedCases
        ? `${batch.failedCases} selected ${batch.failedCases === 1 ? "case needs" : "cases need"} attention`
        : "Batch is still in progress";
  return {
    ...batch,
    report: {
      headline,
      detail: `${batch.passedCases} passed · ${batch.failedCases} failed · ${batch.pendingCases} remaining`,
    },
    ...(exported ? { export: exported } : {}),
  };
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
