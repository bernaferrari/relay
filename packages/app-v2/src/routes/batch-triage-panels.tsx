/** @jsxImportSource react */
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";
import { Badge } from "@relay/ui-react/components/badge";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import {
  buildBatchMatrix,
  humanizeBatchIdentity,
  isBatchCaseProblem,
  isBatchCaseRerunnable,
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
          <h2 id="batch-clusters-title">Review one cause, rerun every matching case</h2>
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
  const rows = failuresOnly
    ? [...matrix.rows].sort((left, right) => Number(right.hasProblems) - Number(left.hasProblems))
    : matrix.rows;
  return (
    <section className="relay-batch-matrix mt-8" aria-labelledby="batch-matrix-title">
      <div className="flex items-end justify-between gap-5 max-[620px]:flex-col max-[620px]:items-start max-[620px]:gap-2">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Test × Environment
          </p>
          <h2 id="batch-matrix-title" className="text-sm font-semibold">
            Execution matrix
          </h2>
        </div>
        <span className="max-w-[48ch] text-xs leading-relaxed text-muted-foreground">
          {matrix.completeIdentity
            ? `${matrix.rows.length} Tests · ${matrix.columns.length} Environments`
            : "Some cases have no saved Test or environment identity"}
        </span>
      </div>
      <div className="relay-batch-matrix-scroll mt-3 overflow-auto rounded-xl border border-border bg-card">
        <table className="min-w-[560px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-[1] w-[190px] min-w-[140px] max-[620px]:w-[140px] border-r border-b border-border bg-background p-3 text-left text-xs"
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
                  <small className="mt-1 block text-[10px] text-muted-foreground">
                    {column.platform ? platformLabel(column.platform) : "Environment"}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th
                  className="sticky left-0 z-[1] w-[190px] min-w-[140px] max-[620px]:w-[140px] border-r border-b border-border bg-background p-3 text-left align-top"
                  scope="row"
                >
                  <strong className="block truncate font-semibold text-foreground">
                    {row.label}
                  </strong>
                  <small className="mt-1 block text-[10px] text-muted-foreground">
                    {row.hasProblems ? "Needs triage" : "Complete"}
                  </small>
                </th>
                {matrix.columns.map((column) => {
                  const cell = row.cells.get(column.id);
                  return (
                    <td
                      key={column.id}
                      className="min-w-[184px] border-r border-b border-border p-3 align-top"
                    >
                      {cell ? (
                        <div className="relay-batch-matrix-cell grid gap-2">
                          {sortBatchCasesForDisplay(cell.cases, failuresOnly).map((item) => (
                            <BatchCaseResult
                              key={item.id}
                              item={item}
                              selected={selected.has(item.id)}
                              onToggle={(checked) => onToggleCase(item, checked)}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="relay-batch-matrix-empty">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BatchCaseResult({
  item,
  selected,
  onToggle,
}: {
  item: ProductBatchCase;
  selected: boolean;
  onToggle(checked: boolean): void;
}) {
  const rerunnable = isBatchCaseRerunnable(item);
  return (
    <div
      className={`relay-batch-result grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md p-1 ${isBatchCaseProblem(item) ? "bg-red-500/5" : ""}`}
    >
      {rerunnable ? (
        <Checkbox
          className="size-6 after:inset-0"
          checked={selected}
          onCheckedChange={(checked) => onToggle(checked === true)}
          aria-label={`Select ${item.world ?? `case ${item.index + 1}`}`}
        />
      ) : (
        <span className="relay-batch-result-spacer" />
      )}
      <span className="grid min-w-0 justify-items-start gap-1">
        <Badge
          variant={caseVariant(item.status).variant}
          className={caseVariant(item.status).className}
        >
          {caseStatus(item.status)}
        </Badge>
        <small className="max-w-[22ch] overflow-hidden text-[10px] text-muted-foreground text-ellipsis whitespace-nowrap">
          {caseValues(item)}
        </small>
      </span>
      {item.runId ? (
        <Link
          to="/runs/$runId"
          params={{ runId: item.runId }}
          aria-label={`Open Report for ${item.world ?? `case ${item.index + 1}`}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:size-4"
        >
          <ExternalLink aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

export function sortBatchCasesForDisplay(
  cases: readonly ProductBatchCase[],
  failuresFirst: boolean,
): readonly ProductBatchCase[] {
  if (!failuresFirst) return cases;
  return [...cases].sort(
    (left, right) => Number(isBatchCaseProblem(right)) - Number(isBatchCaseProblem(left)),
  );
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

function caseVariant(status: ProductBatchCase["status"]): {
  variant: "default" | "destructive" | "secondary";
  className?: string;
} {
  if (status === "passed") {
    return {
      variant: "default",
      className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
    };
  }
  if (status === "failed") return { variant: "destructive" };
  if (status === "blocked") {
    return {
      variant: "secondary",
      className: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    };
  }
  return { variant: "secondary" };
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
