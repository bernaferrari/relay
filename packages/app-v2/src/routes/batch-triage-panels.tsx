/** @jsxImportSource react */
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import {
  classifyProductResultCell,
  productResultCellLabel,
} from "@relay/product/plan-result-cells";
import {
  batchTriageCaption,
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
              search={{ reportView: "captures" }}
            >
              Report <ExternalLink aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BatchResultMatrix({
  report,
  selected,
  onToggleCase,
  onRerun,
  rerunning,
}: {
  report: ProductBatchReport;
  selected: ReadonlySet<string>;
  onToggleCase(item: ProductBatchCase, checked: boolean): void;
  onRerun(item: ProductBatchCase): void;
  rerunning: boolean;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const matrix = buildBatchMatrix(report.cases, report.setup);
  const problems = visibleBatchCases(report.cases, true);
  const passed = report.cases.filter((item) => item.status === "passed");
  const allowSelect = problems.filter(isBatchCaseRerunnable).length > 1;
  const showMatrix = shouldShowBatchMatrix(matrix);
  const rows = showMatrix
    ? matrix.rows
        .map((row) => ({
          ...row,
          visibleCells: matrix.columns.map((column) => {
            const cell = row.cells.get(column.id);
            const visible = cell ? visibleBatchCases(cell.cases, !showPassed) : [];
            return { column, visible };
          }),
        }))
        .filter((row) => row.visibleCells.some((entry) => entry.visible.length))
    : [];

  return (
    <section className="relay-batch-matrix grid gap-1" aria-label="Results">
      {showMatrix ? (
        <div className="relay-batch-matrix-scroll overflow-auto rounded-xl border border-border">
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
                    className="min-w-[184px] border-r border-b border-border p-3 text-left text-xs"
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
                        <div className="grid gap-2">
                          {visible.map((item) => (
                            <BatchCaseResult
                              key={item.id}
                              item={item}
                              selected={selected.has(item.id)}
                              allowSelect={allowSelect}
                              compact
                              onToggle={(checked) => onToggleCase(item, checked)}
                              onRerun={() => onRerun(item)}
                              rerunning={rerunning}
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
        <>
          {problems.length ? (
            <ul className="m-0 list-none p-0">
              {problems.map((item) => (
                <li key={item.id}>
                  <BatchCaseResult
                    item={item}
                    selected={selected.has(item.id)}
                    allowSelect={allowSelect}
                    onToggle={(checked) => onToggleCase(item, checked)}
                    onRerun={() => onRerun(item)}
                    rerunning={rerunning}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <PassedCases cases={passed} open={showPassed} onOpen={() => setShowPassed(true)} />
        </>
      )}
      {showMatrix && !showPassed ? (
        <PassedCases cases={passed} open={false} onOpen={() => setShowPassed(true)} />
      ) : null}
    </section>
  );
}

function PassedCases({
  cases,
  open,
  onOpen,
}: {
  cases: readonly ProductBatchCase[];
  open: boolean;
  onOpen(): void;
}) {
  if (!cases.length) return null;
  if (!open) {
    return (
      <button
        type="button"
        className="flex w-max items-center gap-1.5 border-t border-border pt-3 text-left text-[13px] text-muted-foreground hover:text-foreground"
        onClick={onOpen}
      >
        {cases.length} passed
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="text-[11px] text-muted-foreground">{cases.length} passed</p>
      <ul className="m-0 list-none p-0">
        {cases.map((item) => (
          <li key={item.id}>
            <BatchCaseResult
              item={item}
              selected={false}
              allowSelect={false}
              quiet
              onToggle={() => undefined}
              onRerun={() => undefined}
              rerunning={false}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BatchCaseResult({
  item,
  selected,
  allowSelect,
  onToggle,
  onRerun,
  rerunning,
  compact = false,
  quiet = false,
}: {
  item: ProductBatchCase;
  selected: boolean;
  allowSelect: boolean;
  onToggle(checked: boolean): void;
  onRerun(): void;
  rerunning: boolean;
  compact?: boolean;
  quiet?: boolean;
}) {
  const rerunnable = isBatchCaseRerunnable(item);
  const label = caseValues(item);
  const problem = isBatchCaseProblem(item);
  const review = batchTriageCaption(item);
  const cellKind = classifyProductResultCell(item);
  const cellLabel = productResultCellLabel(cellKind);
  return (
    <div
      className={`relay-batch-result grid items-center gap-3 ${
        compact
          ? "grid-cols-[minmax(0,1fr)_auto] px-1 py-1"
          : quiet
            ? "grid-cols-[minmax(0,1fr)_auto] py-2"
            : "grid-cols-[minmax(0,1fr)_auto] py-4"
      }`}
    >
      {allowSelect ? (
        <Checkbox
          className="col-start-1 row-start-1 size-5 after:inset-0"
          checked={selected}
          onCheckedChange={(checked) => onToggle(checked === true)}
          aria-label={`Select ${label}`}
        />
      ) : null}
      {item.runId ? (
        <Link
          to="/runs/$runId"
          params={{ runId: item.runId }}
          search={{ reportView: "captures" }}
          className={`grid min-w-0 gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${allowSelect ? "col-start-1 ml-8" : ""}`}
        >
          <strong
            className={`truncate font-medium text-foreground ${quiet ? "text-[13px]" : "text-[15px]"}`}
          >
            {label}
          </strong>
          <small className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {cellLabel}
          </small>
          {item.error && problem ? (
            <small className="text-[13px] leading-5 text-muted-foreground">{item.error}</small>
          ) : null}
          {review ? (
            <small className="text-[12px] leading-5 text-muted-foreground">{review}</small>
          ) : null}
        </Link>
      ) : (
        <span className="grid min-w-0 gap-1">
          <strong className="truncate text-[15px] font-medium text-foreground">{label}</strong>
          <small className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            {cellLabel}
          </small>
          {review ? (
            <small className="text-[12px] leading-5 text-muted-foreground">{review}</small>
          ) : null}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        {rerunnable && !allowSelect ? (
          <button
            type="button"
            className="px-2 text-[13px] text-muted-foreground hover:text-foreground"
            disabled={rerunning}
            onClick={onRerun}
          >
            {rerunning ? "Rerunning…" : "Rerun"}
          </button>
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
  return values.length ? values.join(" · ") : item.phase === "pilot" ? "One case" : "Default data";
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
