/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import type { ProductBatchCase, ProductBatchReport } from "@relay/product/run-across";
import { Button } from "@relay/ui-react/components/button";
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
} from "lucide-react";
import { plainFailureReason } from "../components/run-report-formatters";
import { ResultsBar } from "../components/results-bar";
import { RunThumb } from "../components/run-thumb";
import { StatusPill, type RunState } from "../components/run-status";
import { batchCaseInspectionReference } from "./batch-case-inspection";
import { formatBatchWorldLabel } from "./batch-result-view";
import { humanizeBatchIdentity } from "./batch-triage";

/** What a person wants from a plan run: how far along it is and how each test did. */
export function PlanRunChecklist({
  report,
  testNames,
  active,
  onStop,
  stopping,
}: {
  report: ProductBatchReport;
  testNames: Readonly<Record<string, string>>;
  active: boolean;
  onStop(): void;
  stopping: boolean;
}) {
  const cases = [...report.cases].sort((left, right) => left.index - right.index);
  const caseLabels = planCaseLabels(cases, testNames);
  const testCounts = new Map<string, number>();
  for (const item of cases) {
    const testId = item.identity?.testId;
    if (testId) testCounts.set(testId, (testCounts.get(testId) ?? 0) + 1);
  }
  const states = cases.map(caseState);
  const done = cases.filter((item) => isFinished(item.status)).length;
  // Several devices or accounts: say which one each row ran on.
  const environments = new Set(cases.map((item) => item.identity?.environmentId ?? ""));
  // Prefer the names people gave their browsers and devices over target ids.
  const labels = [
    ...new Set(
      cases.flatMap((item) => {
        const label = item.identity?.targetLabel ?? item.identity?.environmentLabel;
        return label ? [label] : [];
      }),
    ),
  ];
  // Content hashes are identities, not names; never show them as "where".
  const where = (labels.length ? labels : report.targetNames)
    .filter((label) => !/^[0-9a-f]{16,}$/iu.test(label))
    .join(", ");
  return (
    <section aria-label="Plan run" className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span role="status">
          <StatusPill state={batchState(report)} size="md" />
        </span>
        <span className="text-sm text-muted-foreground">
          {[
            where,
            active
              ? `${done} of ${cases.length} done`
              : `${cases.length} ${cases.length === 1 ? "test run" : "test runs"}`,
            `started ${new Date(report.createdAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {active ? (
          <Button variant="outline" size="sm" onClick={onStop} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
      </div>
      <ResultsBar states={states} />
      <ol className="m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0">
        {cases.map((item) => {
          const inspection = batchCaseInspectionReference(item);
          // Name the case by what makes it different (account, language…), not its position.
          const variant = caseLabels[item.id];
          const knownTest = item.identity?.testId && testNames[item.identity.testId];
          const repeated =
            !item.identity?.testId || (testCounts.get(item.identity.testId) ?? 0) > 1;
          const name =
            knownTest && !repeated
              ? knownTest
              : knownTest && !variant?.startsWith(knownTest)
                ? `${knownTest} · ${variant}`
                : (variant ?? `Test ${item.index + 1}`);
          const detail = [
            caseDetail(item),
            environments.size > 1
              ? (item.identity?.environmentLabel ?? item.identity?.targetLabel)
              : undefined,
          ]
            .filter(Boolean)
            .join(" · ");
          const body = (
            <>
              <CaseMark status={item.status} />
              <RunThumb runId={item.runId} label={name} />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground" title={item.error}>
                  {detail}
                </span>
              </span>
              {inspection ? (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
            </>
          );
          const row = "flex min-h-16 items-center gap-3.5 px-3.5 py-2.5";
          return (
            <li key={item.id}>
              {inspection ? (
                <Link
                  to="/runs/$runId"
                  params={{ runId: inspection.id }}
                  aria-label={`${name} · ${inspection.kind === "live" ? "Open live run" : "Open run report"}`}
                  className={`${row} transition-colors duration-150 outline-none hover:bg-accent focus-visible:bg-accent`}
                >
                  {body}
                </Link>
              ) : (
                <div className={row}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CaseMark({ status }: { status: ProductBatchCase["status"] }) {
  const size = "size-5 shrink-0";
  if (status === "passed")
    return <CircleCheck className={`${size} text-success`} aria-label="Passed" />;
  if (status === "failed")
    return <CircleX className={`${size} text-destructive`} aria-label="Failed" />;
  if (status === "blocked")
    return <CircleX className={`${size} text-destructive`} aria-label="Could not run" />;
  if (status === "cancelled")
    return <CircleSlash className={`${size} text-muted-foreground`} aria-label="Cancelled" />;
  if (status === "running")
    return (
      <LoaderCircle
        className={`${size} animate-spin text-brand motion-reduce:animate-none`}
        aria-label="Running"
      />
    );
  return <Circle className={`${size} text-muted-foreground/50`} aria-label="Waiting" />;
}

function caseDetail(item: ProductBatchCase): string {
  if (item.status === "running") return "Running…";
  if (item.status === "queued" || item.status === "pending") return "Waiting to start";
  if (item.status === "passed") return "Passed";
  if (item.status === "cancelled") return "Cancelled";
  const reason = item.error ? plainFailureReason(item.error) : undefined;
  if (item.status === "blocked") return reason ? `Could not run: ${reason}` : "Could not run";
  return reason || "Failed";
}

function isFinished(status: ProductBatchCase["status"]): boolean {
  return (
    status === "passed" || status === "failed" || status === "blocked" || status === "cancelled"
  );
}

function caseState(item: ProductBatchCase): RunState {
  if (item.status === "passed") return "passed";
  if (item.status === "failed" || item.status === "blocked") return "failed";
  if (item.status === "running") return "running";
  if (item.status === "cancelled") return "cancelled";
  return "not-run";
}

export function batchState(report: Pick<ProductBatchReport, "status">): RunState {
  switch (report.status) {
    case "running":
    case "pilot-running":
      return "running";
    case "completed":
      return "passed";
    case "completed-with-problems":
      return "failed";
    case "needs-review":
    case "ready-to-continue":
      return "review";
    case "cancelled":
      return "cancelled";
  }
}

/** What sets each case apart, keyed by case id and Run id: data values first, then its Test. */
export function planCaseLabels(
  cases: readonly ProductBatchCase[],
  testNames: Readonly<Record<string, string>>,
): Record<string, string> {
  const tests = new Set(cases.map((item) => item.identity?.testId ?? ""));
  const environments = new Set(cases.map((item) => item.identity?.environmentId ?? ""));
  const labels: Record<string, string> = {};
  for (const item of cases) {
    const values = Object.values(item.values ?? {})
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => humanizeBatchIdentity(value))
      .join(" · ");
    const variant = item.world ? formatBatchWorldLabel(item.world) : values || undefined;
    const test =
      tests.size > 1 && item.identity?.testId ? testNames[item.identity.testId] : undefined;
    const place =
      environments.size > 1
        ? (item.identity?.environmentLabel ?? item.identity?.targetLabel)
        : undefined;
    const label = [test, variant, place].filter(Boolean).join(" · ") || `Case ${item.index + 1}`;
    labels[item.id] = label;
    if (item.runId) labels[item.runId] = label;
  }
  return labels;
}
