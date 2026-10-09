import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ProductBatchReport } from "@relay/product/run-across";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { RunInspection } from "./run-page";
import { isBatchCaseProblem, isBatchCaseRerunnable, humanizeBatchIdentity } from "./batch-triage";
import { formatBatchCaseError, formatBatchWorldLabel } from "./batch-result-view";
import { batchCaseEvidenceMessage, batchCaseInspectionReference } from "./batch-case-inspection";

export function BatchReviewWorkspace({
  report,
  focusedCaseId,
  focusRequest,
  selected,
  onToggle,
  onResolve,
  onRerun,
  pending,
  rerunning,
  groups,
  matrix,
}: {
  report: ProductBatchReport;
  focusedCaseId?: string;
  focusRequest?: number;
  selected: ReadonlySet<string>;
  onToggle(id: string, checked: boolean): void;
  onResolve(id: string): Promise<unknown>;
  onRerun(id: string): void;
  pending: boolean;
  rerunning: boolean;
  groups: (inspect: (id: string) => void) => ReactNode;
  matrix: (inspect: (id: string) => void) => ReactNode;
}) {
  const [view, setView] = useState<"queue" | "matrix" | "groups">("queue");
  const [focusedId, setFocusedId] = useState<string | undefined>(focusedCaseId);
  const [showPassing, setShowPassing] = useState(false);
  useEffect(() => {
    if (focusedCaseId) {
      setFocusedId(focusedCaseId);
      setView("queue");
    }
  }, [focusedCaseId, focusRequest]);
  const unresolved = report.cases.filter(
    (item) =>
      isBatchCaseProblem(item) &&
      item.triageStatus !== "resolved" &&
      item.triageStatus !== "wont-fix",
  );
  const focused =
    report.cases.find((item) => item.id === focusedId) ?? unresolved[0] ?? report.cases[0];
  const inspection = focused ? batchCaseInspectionReference(focused) : undefined;
  const problemCount = report.cases.filter(isBatchCaseProblem).length;
  const passingCount = report.cases.length - problemCount;
  // Problems lead; passing cases stay one click away instead of crowding the list.
  const queue = [...report.cases]
    .filter(
      (item) => showPassing || !problemCount || isBatchCaseProblem(item) || item.id === focusedId,
    )
    .sort(
      (a, b) => Number(isBatchCaseProblem(b)) - Number(isBatchCaseProblem(a)) || a.index - b.index,
    );
  const next =
    unresolved.find((item) => item.index > (focused?.index ?? -1) && item.id !== focused?.id) ??
    unresolved.find((item) => item.id !== focused?.id);
  const offset =
    Math.floor(
      Math.max(
        0,
        queue.findIndex((item) => item.id === focused?.id),
      ) / 50,
    ) * 50;
  function inspect(id: string) {
    setFocusedId(id);
    setView("queue");
  }
  return (
    <section className="mt-6 grid min-w-0 gap-4" aria-label="Case review workspace">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            {unresolved.length
              ? `${unresolved.length} ${unresolved.length === 1 ? "problem" : "problems"} to look at`
              : problemCount
                ? "All problems resolved"
                : "Every case passed"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground" role="status">
            {report.cases.length} {report.cases.length === 1 ? "case" : "cases"} in this Plan run
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Case view">
            {(["queue", "matrix", "groups"] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                aria-pressed={view === item}
                variant={view === item ? "secondary" : "ghost"}
                onClick={() => setView(item)}
              >
                {item === "queue" ? "List" : item === "matrix" ? "Grid" : "Groups"}
              </Button>
            ))}
          </div>
          {next ? (
            <Button
              variant="outline"
              onClick={() => {
                setFocusedId(next.id);
                setView("queue");
              }}
            >
              Next problem
            </Button>
          ) : null}
        </div>
      </header>
      {view === "matrix" ? (
        matrix(inspect)
      ) : view === "groups" ? (
        groups(inspect)
      ) : (
        <div className="grid min-w-0 gap-3 min-[1100px]:grid-cols-[280px_minmax(0,1fr)]">
          <ol
            className="grid max-h-56 min-[1100px]:max-h-[70dvh] list-none content-start gap-1 overflow-y-auto rounded-xl border border-border bg-card p-2"
            aria-label="Cases"
          >
            {queue.slice(offset, offset + 50).map((item) => (
              <li
                key={item.id}
                className={`flex items-start gap-2 rounded-lg p-2 ${focused?.id === item.id ? "bg-accent" : "hover:bg-muted/50"}`}
              >
                <Checkbox
                  className="mt-3"
                  checked={selected.has(item.id)}
                  disabled={!isBatchCaseRerunnable(item)}
                  aria-label={`Select case ${item.index + 1}`}
                  onCheckedChange={(checked) => onToggle(item.id, checked === true)}
                />
                <button
                  type="button"
                  aria-pressed={focused?.id === item.id}
                  onClick={() => setFocusedId(item.id)}
                  className="grid min-h-11 min-w-0 flex-1 gap-1 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-sm font-medium">{caseName(item)}</span>
                  <span
                    className={`text-xs ${isBatchCaseProblem(item) ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {caseStatusLabel(item)}
                  </span>
                </button>
              </li>
            ))}
            {problemCount && passingCount ? (
              <li>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setShowPassing((value) => !value)}
                >
                  {showPassing ? "Hide passing cases" : `Show ${passingCount} passing`}
                </Button>
              </li>
            ) : null}
            {queue.length > 50 ? (
              <li className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setFocusedId(queue[offset - 50]?.id)}
                >
                  Previous cases
                </Button>
                <span className="text-xs tabular-nums">
                  {offset + 1}–{Math.min(offset + 50, queue.length)} / {queue.length}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={offset + 50 >= queue.length}
                  onClick={() => setFocusedId(queue[offset + 50]?.id)}
                >
                  Next cases
                </Button>
              </li>
            ) : null}
          </ol>
          <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            {focused ? (
              <>
                <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border p-4">
                  <div className="min-w-64 flex-1">
                    <h3 className="text-base font-semibold">{caseName(focused)}</h3>
                    <p
                      className={`mt-0.5 text-sm ${isBatchCaseProblem(focused) ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {focused.error
                        ? formatBatchCaseError(focused.error)
                        : caseStatusLabel(focused)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {inspection ? (
                      <>
                        <Button
                          nativeButton={false}
                          variant="ghost"
                          render={
                            <Link
                              to="/runs/$runId"
                              params={{ runId: inspection.id }}
                              search={inspection.kind === "saved" ? { reportView: "captures" } : {}}
                            />
                          }
                        >
                          {inspection.kind === "live" ? "Open run" : "Open report"}
                        </Button>
                        {focused.runId ? (
                          <Button
                            nativeButton={false}
                            variant="ghost"
                            render={
                              <Link
                                to="/runs/$runId/walkthrough"
                                params={{ runId: focused.runId }}
                                search={{
                                  state: undefined,
                                  variant: undefined,
                                  capture: undefined,
                                }}
                              />
                            }
                          >
                            Walk through
                          </Button>
                        ) : null}
                      </>
                    ) : focused.identity?.testId ? (
                      <Button
                        nativeButton={false}
                        variant="outline"
                        render={
                          <Link
                            to="/tests/$testId"
                            params={{ testId: focused.identity.testId }}
                            search={{ setup: "run" }}
                          />
                        }
                      >
                        Open test setup
                      </Button>
                    ) : null}
                    {isBatchCaseProblem(focused) &&
                    focused.triageStatus !== "resolved" &&
                    focused.triageStatus !== "wont-fix" ? (
                      <>
                        {isBatchCaseRerunnable(focused) ? (
                          <Button disabled={rerunning} onClick={() => onRerun(focused.id)}>
                            {rerunning ? "Starting…" : "Run again"}
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          disabled={pending}
                          onClick={async () => {
                            try {
                              await onResolve(focused.id);
                              setFocusedId(next?.id ?? focused.id);
                            } catch {
                              /* The parent presents mutation errors. */
                            }
                          }}
                        >
                          {pending ? "Saving…" : "Mark resolved"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </header>
                <div className="min-h-96 overflow-auto">
                  {inspection ? (
                    <RunInspection key={inspection.id} runId={inspection.id} embedded />
                  ) : (
                    <p className="p-6 text-sm text-muted-foreground">
                      {batchCaseEvidenceMessage(focused)}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Cases will appear here when the plan starts.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function caseName(item: ProductBatchReport["cases"][number]): string {
  return item.world
    ? formatBatchWorldLabel(item.world)
    : Object.values(item.values).map(humanizeBatchIdentity).join(" · ") || `Case ${item.index + 1}`;
}

function caseStatusLabel(item: ProductBatchReport["cases"][number]): string {
  const outcome =
    item.status === "passed"
      ? "Passed"
      : item.status === "failed"
        ? "Failed"
        : item.status === "blocked"
          ? "Couldn’t run"
          : item.status === "cancelled"
            ? "Stopped"
            : item.status === "running"
              ? "Running"
              : "Waiting";
  const triage =
    item.triageStatus === "resolved"
      ? "resolved"
      : item.triageStatus === "wont-fix"
        ? "won’t fix"
        : item.triageStatus === "investigating"
          ? "investigating"
          : undefined;
  return triage ? `${outcome} · ${triage}` : outcome;
}
