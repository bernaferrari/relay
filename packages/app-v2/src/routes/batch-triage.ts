import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchTriageInput,
  ProductRunAcrossSetup,
} from "@relay/product/run-across";
import type { CombineTriageStatus } from "@relay/protocol";

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
          item.identity?.environmentLabel ??
          (environmentId === fallbackEnvironment ? "Device" : humanizeBatchIdentity(environmentId)),
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

export function shouldShowBatchMatrix(matrix: BatchMatrix): boolean {
  return matrix.completeIdentity && (matrix.rows.length > 1 || matrix.columns.length > 1);
}

export function visibleBatchCases(
  cases: readonly ProductBatchCase[],
  failuresOnly: boolean,
): readonly ProductBatchCase[] {
  const visible = failuresOnly ? cases.filter(isBatchCaseProblem) : cases;
  return sortBatchCases(visible, true);
}

export function sortBatchCases(
  cases: readonly ProductBatchCase[],
  failuresFirst: boolean,
): readonly ProductBatchCase[] {
  if (!failuresFirst) return cases;
  return [...cases].sort(
    (left, right) => Number(isBatchCaseProblem(right)) - Number(isBatchCaseProblem(left)),
  );
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

const TRIAGE_STATUS_KEYS: Record<string, CombineTriageStatus> = {
  i: "investigating",
  r: "resolved",
  w: "wont-fix",
  u: "unreviewed",
};

function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const element = target as { tagName?: string; isContentEditable?: boolean };
  const tag = element.tagName?.toLowerCase();
  return (
    tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable === true
  );
}

/** Authenticated actor only. The placeholder "me" is never a review owner. */
export function resolveTriageActor(actorId: string | undefined): string | undefined {
  const value = actorId?.trim();
  if (!value || value === "me") return undefined;
  return value;
}

export type BatchTriageCommand =
  | { kind: "status"; input: ProductBatchTriageInput }
  | { kind: "assignee"; input: ProductBatchTriageInput }
  | { kind: "note"; caseIds: readonly string[] };

/** Map a Batch keyboard event to a review command. Execution status is unchanged. */
export function batchTriageKeyboardCommand(input: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  overlayOpen?: boolean;
  pending?: boolean;
  target?: unknown;
  selectedCaseIds: readonly string[];
  actorId?: string;
}): BatchTriageCommand | null {
  if (input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return null;
  if (input.repeat || input.defaultPrevented || input.isComposing) return null;
  if (input.overlayOpen || input.pending) return null;
  if (isTypingTarget(input.target)) return null;
  const caseIds = [...new Set(input.selectedCaseIds.map((id) => id.trim()).filter(Boolean))];
  if (!caseIds.length) return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (key === "n") return { kind: "note", caseIds };
  if (key === "a") {
    const assignee = resolveTriageActor(input.actorId);
    if (!assignee) return null;
    return { kind: "assignee", input: { caseIds, assignee } };
  }
  const triageStatus = TRIAGE_STATUS_KEYS[key];
  if (!triageStatus) return null;
  return { kind: "status", input: { caseIds, triageStatus } };
}

export function batchTriageMutation(
  command: BatchTriageCommand | null,
): ProductBatchTriageInput | null {
  if (command?.kind === "status" || command?.kind === "assignee") return command.input;
  return null;
}

export function batchTriageCaption(item: ProductBatchCase): string | undefined {
  const status =
    item.triageStatus && item.triageStatus !== "unreviewed"
      ? batchTriageStatusLabel(item.triageStatus)
      : undefined;
  const owner = item.assignee?.trim() ? humanizeBatchIdentity(item.assignee) : undefined;
  const parts = [status, owner].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export function batchTriageStatusLabel(status: CombineTriageStatus): string {
  if (status === "investigating") return "Investigating";
  if (status === "resolved") return "Resolved";
  if (status === "wont-fix") return "Won't fix";
  return "Unreviewed";
}

export function batchRerunRequest(input: {
  explicitCaseIds?: readonly string[];
  selectedCaseIds?: readonly string[];
  selectedClusterIds?: readonly string[];
}): { caseIds?: string[]; clusterIds?: string[] } {
  if (input.explicitCaseIds?.length) {
    return { caseIds: [...input.explicitCaseIds] };
  }
  const caseIds = [...(input.selectedCaseIds ?? [])];
  const clusterIds = [...(input.selectedClusterIds ?? [])];
  return {
    ...(caseIds.length ? { caseIds } : {}),
    ...(clusterIds.length ? { clusterIds } : {}),
  };
}
