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
    <section className="relay-batch-clusters" aria-labelledby="batch-clusters-title">
      <div className="relay-section-heading">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Failure clusters
          </p>
          <h2 id="batch-clusters-title">Review one cause, rerun every matching case</h2>
        </div>
        <span>{clusters.length} groups</span>
      </div>
      <ul>
        {clusters.map((cluster) => (
          <li key={cluster.id}>
            <Checkbox
              checked={selected.has(cluster.id)}
              onCheckedChange={(checked) => onToggle(cluster, checked === true)}
              aria-label={`Select ${cluster.signature.summary}`}
            />
            <span className="relay-batch-cluster-mark">{cluster.caseIds.length}</span>
            <div>
              <strong>{cluster.signature.summary}</strong>
              <p>
                {failureKind(cluster.kind)} · {humanizeBatchIdentity(cluster.environmentId)} ·{" "}
                {cluster.caseIds.length === 1
                  ? "1 affected case"
                  : `${cluster.caseIds.length} affected cases`}
              </p>
            </div>
            <Link to="/runs/$runId" params={{ runId: cluster.representativeRunId }}>
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
    <section className="relay-batch-matrix" aria-labelledby="batch-matrix-title">
      <div className="relay-section-heading">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Test × Environment
          </p>
          <h2 id="batch-matrix-title">Execution matrix</h2>
        </div>
        <span>
          {matrix.completeIdentity
            ? `${matrix.rows.length} Tests · ${matrix.columns.length} Environments`
            : "Legacy Batch · partial identity"}
        </span>
      </div>
      <div className="relay-batch-matrix-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Test</th>
              {matrix.columns.map((column) => (
                <th scope="col" key={column.id}>
                  <strong>{column.label}</strong>
                  <small>{column.platform ? platformLabel(column.platform) : "Environment"}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <strong>{row.label}</strong>
                  <small>{row.hasProblems ? "Needs triage" : "Complete"}</small>
                </th>
                {matrix.columns.map((column) => {
                  const cell = row.cells.get(column.id);
                  return (
                    <td
                      key={column.id}
                      className={
                        cell?.cases.some(isBatchCaseProblem)
                          ? "relay-batch-matrix-cell--problem"
                          : undefined
                      }
                    >
                      {cell ? (
                        <div className="relay-batch-matrix-cell">
                          {cell.cases.map((item) => (
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
    <div className="relay-batch-result">
      {rerunnable ? (
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggle(checked === true)}
          aria-label={`Select ${item.world ?? `case ${item.index + 1}`}`}
        />
      ) : (
        <span className="relay-batch-result-spacer" />
      )}
      <span>
        <Badge
          variant={caseVariant(item.status).variant}
          className={caseVariant(item.status).className}
        >
          {caseStatus(item.status)}
        </Badge>
        <small>{caseValues(item)}</small>
      </span>
      {item.runId ? (
        <Link
          to="/runs/$runId"
          params={{ runId: item.runId }}
          aria-label={`Open Report for ${item.world ?? `case ${item.index + 1}`}`}
        >
          <ExternalLink aria-hidden="true" />
        </Link>
      ) : null}
    </div>
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
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (status === "failed") return { variant: "destructive" };
  if (status === "blocked") {
    return {
      variant: "secondary",
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
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
