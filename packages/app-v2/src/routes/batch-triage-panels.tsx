/** @jsxImportSource react */
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ExternalLink } from "lucide-react";
import {
  buildBatchMatrix,
  humanizeBatchIdentity,
  isBatchCaseProblem,
  isBatchCaseRerunnable,
  shouldShowBatchMatrix,
  sortBatchCases,
  visibleBatchCases,
} from "./batch-triage";

export function BatchFailureClusters({
  clusters,
  selected,
  onToggle,
}: {
  clusters: readonly ProductBatchFailureCluster[];
  selected: ReadonlySet<string>;
  onToggle(cluster: ProductBatchFailureCluster, checked: boolean): void;
}) {
  if (!clusters.length) return null;
  return (
    <section className="relay-batch-clusters mt-8" aria-labelledby="batch-clusters-title">
      <div className="flex items-end justify-between gap-5 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-2">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Failure clusters
          </p>
          <h2 id="batch-clusters-title">Same failure</h2>
        </div>
        <span>{clusters.length} groups</span>
      </div>
      <ul className="mt-3 grid list-none gap-2 p-0">
        {clusters.map((cluster) => (
          <li
            className="grid min-h-[66px] grid-cols-[auto_30px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3 max-[780px]:grid-cols-[auto_30px_minmax(0,1fr)]"
            key={cluster.id}
          >
            <Checkbox
              className="size-6 after:inset-0"
              checked={selected.has(cluster.id)}
              onCheckedChange={(checked) => onToggle(cluster, checked === true)}
              aria-label={`Select ${cluster.signature.summary}`}
            />
            <span className="relay-batch-cluster-mark">{cluster.caseIds.length}</span>
            <div className="grid min-w-0 gap-0.5">
              <strong>{cluster.signature.summary}</strong>
              <p>
                {failureKind(cluster.kind)} · {humanizeBatchIdentity(cluster.environmentId)} ·{" "}
                {cluster.caseIds.length === 1
                  ? "1 affected case"
                  : `${cluster.caseIds.length} affected cases`}
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-[var(--text-interactive-base)] max-[780px]:col-start-3"
              to="/runs/$runId"
              params={{ runId: cluster.representativeRunId }}
            >
              Evidence <ExternalLink aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BatchResultMatrix({
  report,
  failuresOnly,
  selected,
  onToggleCase,
}: {
  report: ProductBatchReport;
  failuresOnly: boolean;
  selected: ReadonlySet<string>;
  onToggleCase(item: ProductBatchCase, checked: boolean): void;
}) {
  const matrix = buildBatchMatrix(report.cases, report.setup);
  const cases = visibleBatchCases(report.cases, failuresOnly);
  const showMatrix = shouldShowBatchMatrix(matrix);
  const rows = showMatrix
    ? matrix.rows
        .map((row) => ({
          ...row,
          visibleCells: matrix.columns.map((column) => {
            const cell = row.cells.get(column.id);
            const visible = cell ? visibleBatchCases(cell.cases, failuresOnly) : [];
            return { column, cell, visible };
          }),
        }))
        .filter((row) => row.visibleCells.some((entry) => entry.visible.length))
    : [];
  return (
    <section className="relay-batch-matrix" aria-label={failuresOnly ? "Failed cases" : "Results"}>
      {showMatrix ? (
        <div className="relay-batch-matrix-scroll overflow-auto rounded-xl border border-border bg-card">
          <table className="min-w-[560px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-[1] w-[190px] min-w-[140px] border-r border-b border-border bg-background p-3 text-left text-xs"
                  scope="col"
                >
                  Test
                </th>
                {matrix.columns.map((column) => (
                  <th
                    className="min-w-[184px] border-r border-b border-border bg-muted p-3 text-left text-xs"
                    scope="col"
                    key={column.id}
                  >
                    <strong className="block truncate font-semibold text-foreground">
                      {column.label}
                    </strong>
                    {column.platform ? (
                      <small className="mt-1 block text-[10px] text-muted-foreground">
                        {platformLabel(column.platform)}
                      </small>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th
                    className="sticky left-0 z-[1] w-[190px] min-w-[140px] border-r border-b border-border bg-background p-3 text-left align-top"
                    scope="row"
                  >
                    <strong className="block truncate font-semibold text-foreground">
                      {row.label}
                    </strong>
                  </th>
                  {row.visibleCells.map(({ column, visible }) => (
                    <td
                      key={column.id}
                      className="min-w-[184px] border-r border-b border-border p-3 align-top"
                    >
                      {visible.length ? (
                        <div className="relay-batch-matrix-cell grid gap-2">
                          {visible.map((item) => (
                            <BatchCaseResult
                              key={item.id}
                              item={item}
                              selected={selected.has(item.id)}
                              compact
                              onToggle={(checked) => onToggleCase(item, checked)}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="m-0 list-none divide-y divide-border border-y border-border p-0">
          {cases.map((item) => (
            <li key={item.id}>
              <BatchCaseResult
                item={item}
                selected={selected.has(item.id)}
                onToggle={(checked) => onToggleCase(item, checked)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BatchCaseResult({
  item,
  selected,
  onToggle,
  compact = false,
}: {
  item: ProductBatchCase;
  selected: boolean;
  onToggle(checked: boolean): void;
  compact?: boolean;
}) {
  const rerunnable = isBatchCaseRerunnable(item);
  const label = caseValues(item);
  const problem = isBatchCaseProblem(item);
  return (
    <div
      className={`relay-batch-result group grid items-center gap-2 ${
        compact
          ? "grid-cols-[minmax(0,1fr)_auto] rounded-md px-1 py-1"
          : "grid-cols-[minmax(0,1fr)_auto] px-3 py-3 transition-colors hover:bg-muted/40"
      }`}
    >
      {item.runId ? (
        <Link
          to="/runs/$runId"
          params={{ runId: item.runId }}
          className="grid min-w-0 gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={`shrink-0 text-xs font-medium ${
                item.status === "failed"
                  ? "text-red-600 dark:text-red-400"
                  : item.status === "passed"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-muted-foreground"
              }`}
            >
              {caseStatus(item.status)}
            </span>
            <strong className="truncate text-sm font-medium text-foreground">{label}</strong>
          </span>
          {item.error && problem ? (
            <small className="truncate text-xs text-muted-foreground">{item.error}</small>
          ) : null}
        </Link>
      ) : (
        <span className="grid min-w-0 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {caseStatus(item.status)}
            </span>
            <strong className="truncate text-sm font-medium text-foreground">{label}</strong>
          </span>
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        {rerunnable ? (
          <Checkbox
            className="size-5 after:inset-0"
            checked={selected}
            onCheckedChange={(checked) => onToggle(checked === true)}
            aria-label={`Select ${label}`}
          />
        ) : null}
        {item.runId ? (
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </span>
    </div>
  );
}

export function sortBatchCasesForDisplay(
  cases: readonly ProductBatchCase[],
  failuresFirst: boolean,
): readonly ProductBatchCase[] {
  return sortBatchCases(cases, failuresFirst);
}

function caseValues(item: ProductBatchCase): string {
  if (item.world?.trim()) return item.world;
  const values = Object.values(item.values).map(humanizeBatchIdentity);
  return values.length ? values.join(" · ") : item.phase === "pilot" ? "Pilot" : "Default data";
}

function caseStatus(status: ProductBatchCase["status"]): string {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  if (status === "blocked") return "Blocked";
  if (status === "cancelled") return "Cancelled";
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  return "Pending";
}

function failureKind(kind: ProductBatchFailureCluster["kind"]): string {
  if (kind === "causal") return "Product behavior";
  if (kind === "visual") return "Visual difference";
  if (kind === "localization") return "Localization";
  if (kind === "network") return "Network";
  return "Crash";
}

function platformLabel(platform: "android" | "ios" | "browser"): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Browser";
}
