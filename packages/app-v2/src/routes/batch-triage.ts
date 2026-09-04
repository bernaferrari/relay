import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductRunAcrossSetup,
} from "@relay/product/run-across";

export type BatchMatrixColumn = {
  id: string;
  label: string;
  platform?: "android" | "ios" | "browser";
};

export type BatchMatrixCell = {
  id: string;
  testId: string;
  environmentId: string;
  cases: readonly ProductBatchCase[];
};

export type BatchMatrixRow = {
  id: string;
  label: string;
  cells: ReadonlyMap<string, BatchMatrixCell>;
  hasProblems: boolean;
};

export type BatchMatrix = {
  columns: readonly BatchMatrixColumn[];
  rows: readonly BatchMatrixRow[];
  completeIdentity: boolean;
};

export function humanizeBatchIdentity(value: string): string {
  return value
    .replaceAll(/[-_.:]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(/^./u, (character) => character.toUpperCase());
}

export function isBatchCaseProblem(item: ProductBatchCase): boolean {
  return item.status === "failed" || item.status === "blocked" || item.status === "cancelled";
}

export function isBatchCaseRerunnable(item: ProductBatchCase): boolean {
  return isBatchCaseProblem(item) && Boolean(item.runId);
}

function testLabel(testId: string, setup?: ProductRunAcrossSetup): string {
  return setup?.testId === testId ? setup.testName : humanizeBatchIdentity(testId);
}

export function buildBatchMatrix(
  cases: readonly ProductBatchCase[],
  setup?: ProductRunAcrossSetup,
): BatchMatrix {
  const completeIdentity = cases.length > 0 && cases.every((item) => item.identity);
  const fallbackTest = setup?.testId ?? "selected-test";
  const fallbackEnvironment = "selected-environment";
  const columns = new Map<string, BatchMatrixColumn>();
  const grouped = new Map<string, Map<string, ProductBatchCase[]>>();

  for (const item of cases) {
    const testId = item.identity?.testId ?? fallbackTest;
    const environmentId = item.identity?.environmentId ?? fallbackEnvironment;
    const column = columns.get(environmentId);
    if (!column) {
      columns.set(environmentId, {
        id: environmentId,
        label:
          environmentId === fallbackEnvironment
            ? "Selected environment"
            : humanizeBatchIdentity(environmentId),
        ...(item.identity?.environmentPlatform
          ? { platform: item.identity.environmentPlatform }
          : {}),
      });
    }
    const row = grouped.get(testId) ?? new Map<string, ProductBatchCase[]>();
    const cell = row.get(environmentId) ?? [];
    cell.push(item);
    row.set(environmentId, cell);
    grouped.set(testId, row);
  }

  const rows = [...grouped.entries()]
    .map(([testId, environments]) => {
      const cells = new Map<string, BatchMatrixCell>();
      for (const [environmentId, items] of environments) {
        cells.set(environmentId, {
          id: `${testId}:${environmentId}`,
          testId,
          environmentId,
          cases: [...items].sort((left, right) => left.index - right.index),
        });
      }
      return {
        id: testId,
        label: testLabel(testId, setup),
        cells,
        hasProblems: [...cells.values()].some((cell) => cell.cases.some(isBatchCaseProblem)),
      } satisfies BatchMatrixRow;
    })
    .sort(
      (left, right) =>
        Number(right.hasProblems) - Number(left.hasProblems) ||
        left.label.localeCompare(right.label),
    );

  return {
    columns: [...columns.values()].sort((left, right) => left.label.localeCompare(right.label)),
    rows,
    completeIdentity,
  };
}

export function selectedClusterCaseIds(
  clusters: readonly ProductBatchFailureCluster[],
  clusterIds: ReadonlySet<string>,
): readonly string[] {
  return [
    ...new Set(
      clusters
        .filter((cluster) => clusterIds.has(cluster.id))
        .flatMap((cluster) => cluster.caseIds),
    ),
  ].sort();
}
