/** @jsxImportSource react */
import type {
  ProductBatchCase,
  ProductBatchFailureCluster,
  ProductBatchReport,
} from "@relay/product/run-across";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  classifyProductResultCell,
  productResultCellLabel,
} from "@relay/product/plan-result-cells";
import {
  batchClusterCopy,
  batchClusterGroupCount,
  formatBatchCaseError,
  formatBatchWorldLabel,
  type BatchTestNames,
} from "./batch-result-view";
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

const reportLinkClass =
  "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-foreground underline underline-offset-4";

export function BatchFailureClusters({
  clusters,
  selected,
  onToggle,
  cases = [],
  onInspect,
}: {
  clusters: readonly ProductBatchFailureCluster[];
  selected: ReadonlySet<string>;
  onToggle(cluster: ProductBatchFailureCluster, checked: boolean): void;
  cases?: readonly ProductBatchCase[];
  onInspect?(runId: string): void;
}) {
  if (!clusters.length) return null;
  return (
    <section className="mt-8" aria-labelledby="batch-clusters-title">
      <div className="grid max-w-prose gap-1">
        <h2
          id="batch-clusters-title"
          className="text-xl font-semibold tracking-tight text-pretty text-foreground"
        >
          Same failure
        </h2>
        <p className="text-sm leading-5 text-muted-foreground">
          <span className="sr-only">{batchClusterGroupCount(clusters.length)}. </span>
          Select a group to rerun the same cases.
        </p>
      </div>
      <ul className="mt-4 grid list-none gap-2.5 p-0">
        {clusters.map((cluster) => {
          const copy = batchClusterCopy(cluster, cases);
          const checked = selected.has(cluster.id);
          const product = copy.lane === "Product";
          return (
            <li
              className={`grid min-h-14 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border border-border bg-card py-3.5 pr-3 pl-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${
                product ? "border-l-4 border-l-destructive" : "border-l-4 border-l-border"
              } ${checked ? "bg-accent" : ""}`}
              key={cluster.id}
            >
              <Checkbox
                className="mt-1 size-5 after:-inset-2"
                checked={checked}
                onCheckedChange={(value) => onToggle(cluster, value === true)}
                aria-label={`Select ${copy.title} to rerun`}
              />
              <div className="grid min-w-0 gap-1">
                <p className="text-xs leading-4 text-muted-foreground">{copy.lane}</p>
                <strong className="text-sm font-semibold leading-5 text-pretty text-foreground">
                  {copy.title}
                </strong>
                <p className="text-sm leading-5 text-muted-foreground">{copy.meta}</p>
                {copy.repair ? (
                  <p className="text-sm leading-5 text-foreground">{copy.repair}</p>
                ) : null}
                {copy.repairTestId ? (
                  <Link
                    to="/tests/$testId"
                    params={{ testId: copy.repairTestId }}
                    className="text-sm font-medium text-primary"
                  >
                    Return to {copy.repairTestId}
                  </Link>
                ) : null}
              </div>
              <Link
                className={`${reportLinkClass} col-start-2 sm:col-start-auto sm:justify-self-end`}
                to="/runs/$runId"
                params={{ runId: cluster.representativeRunId }}
                onClick={(event) => {
                  if (
                    onInspect &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    onInspect(cluster.representativeRunId);
                  }
                }}
                search={{ reportView: "captures" }}
              >
                Report
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
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
  testNames = {},
  onInspect,
}: {
  report: ProductBatchReport;
  selected: ReadonlySet<string>;
  onToggleCase(item: ProductBatchCase, checked: boolean): void;
  onRerun(item: ProductBatchCase): void;
  rerunning: boolean;
  testNames?: BatchTestNames;
  onInspect?(item: ProductBatchCase): void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const matrix = buildBatchMatrix(report.cases, report.setup, testNames);
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
    <section className="mt-8 grid gap-3" aria-labelledby="batch-cases-title">
      <h2 id="batch-cases-title" className="text-xl font-semibold tracking-tight text-foreground">
        Results
      </h2>
      {showMatrix ? (
        <div className="overflow-auto rounded-xl border border-border">
          <table className="min-w-xl w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th
                  className="sticky left-0 z-[1] w-48 min-w-36 border-r border-b border-border bg-background p-3 text-left text-xs"
                  scope="col"
                >
                  Test
                </th>
                {matrix.columns.map((column) => (
                  <th
                    className="min-w-44 border-r border-b border-border p-3 text-left text-xs"
                    scope="col"
                    key={column.id}
                  >
                    <strong className="block truncate font-semibold text-foreground">
                      {column.label}
                    </strong>
                    {column.platform ? (
                      <small className="mt-1 block text-xs text-muted-foreground">
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
                    className="sticky left-0 z-[1] w-48 min-w-36 border-r border-b border-border bg-background p-3 text-left align-top"
                    scope="row"
                  >
                    <strong className="block text-pretty font-semibold text-foreground">
                      {row.label}
                    </strong>
                  </th>
                  {row.visibleCells.map(({ column, visible }) => (
                    <td
                      key={column.id}
                      className="min-w-44 border-r border-b border-border p-3 align-top"
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
                              onInspect={onInspect ? () => onInspect(item) : undefined}
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
                    onInspect={onInspect ? () => onInspect(item) : undefined}
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
        className="flex w-max items-center gap-1.5 border-t border-border pt-3 text-left text-sm text-muted-foreground hover:text-foreground"
        onClick={onOpen}
      >
        {cases.length} passed
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">{cases.length} passed</p>
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
  onInspect,
  quiet = false,
}: {
  item: ProductBatchCase;
  selected: boolean;
  allowSelect: boolean;
  onToggle(checked: boolean): void;
  onRerun(): void;
  rerunning: boolean;
  compact?: boolean;
  onInspect?(): void;
  quiet?: boolean;
}) {
  const rerunnable = isBatchCaseRerunnable(item);
  const label = caseValues(item);
  const problem = isBatchCaseProblem(item);
  const review = batchTriageCaption(item);
  const cellKind = classifyProductResultCell(item);
  const cellLabel = productResultCellLabel(cellKind);
  const title = compact ? cellLabel : label;
  return (
    <div
      className={`grid items-center gap-3 ${
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
          onClick={(event) => {
            if (onInspect && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              onInspect();
            }
          }}
          search={{ reportView: "captures" }}
          className={`grid min-w-0 gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${allowSelect ? "col-start-1 ml-8" : ""}`}
        >
          <strong
            className={`truncate font-medium text-pretty text-foreground ${quiet ? "text-sm" : "text-sm"}`}
          >
            {title}
          </strong>
          {compact ? (
            <small className="text-xs leading-4 text-muted-foreground">{label}</small>
          ) : (
            <small className="text-xs leading-4 text-muted-foreground">{cellLabel}</small>
          )}
          {item.error && problem ? (
            <small className="text-sm leading-5 text-muted-foreground">
              {formatBatchCaseError(item.error)}
            </small>
          ) : null}
          {review ? (
            <small className="text-xs leading-5 text-muted-foreground">{review}</small>
          ) : null}
        </Link>
      ) : (
        <span className="grid min-w-0 gap-1">
          <strong className="truncate text-sm font-medium text-pretty text-foreground">
            {title}
          </strong>
          <small className="text-xs leading-4 text-muted-foreground">{cellLabel}</small>
          {review ? (
            <small className="text-xs leading-5 text-muted-foreground">{review}</small>
          ) : null}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        {rerunnable && !allowSelect ? (
          <button
            type="button"
            className="px-2 text-sm text-muted-foreground hover:text-foreground"
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
  if (item.world?.trim()) return formatBatchWorldLabel(item.world);
  const values = Object.values(item.values).map(humanizeBatchIdentity);
  return values.length ? values.join(" · ") : item.phase === "pilot" ? "One case" : "Default data";
}

function platformLabel(platform: "android" | "ios" | "browser"): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Browser";
}
