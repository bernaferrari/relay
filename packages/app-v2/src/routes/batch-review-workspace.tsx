import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ProductBatchReport } from "@relay/product/run-across";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { RunInspection } from "./run-page";
import { isBatchCaseProblem, isBatchCaseRerunnable, humanizeBatchIdentity } from "./batch-triage";
import { formatBatchCaseError, formatBatchWorldLabel } from "./batch-result-view";

export function BatchReviewWorkspace({
  report,
  selected,
  onToggle,
  onResolve,
  pending,
  groups,
  matrix,
}: {
  report: ProductBatchReport;
  selected: ReadonlySet<string>;
  onToggle(id: string, checked: boolean): void;
  onResolve(id: string): Promise<unknown>;
  pending: boolean;
  groups: (inspect: (id: string) => void) => ReactNode;
  matrix: (inspect: (id: string) => void) => ReactNode;
}) {
  const [view, setView] = useState<"queue" | "matrix" | "groups">("queue");
  const [focusedId, setFocusedId] = useState<string>();
  const unresolved = report.cases.filter(
    (item) =>
      isBatchCaseProblem(item) &&
      item.triageStatus !== "resolved" &&
      item.triageStatus !== "wont-fix",
  );
  const focused =
    report.cases.find((item) => item.id === focusedId) ?? unresolved[0] ?? report.cases[0];
  const queue = [...report.cases].sort(
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
          <h2 className="text-base font-semibold">Review cases</h2>
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {unresolved.length} unresolved · {report.cases.length} total
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
                {item === "queue"
                  ? "Review queue"
                  : item === "matrix"
                    ? "Matrix"
                    : "Failure groups"}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={!next}
            onClick={() => {
              setFocusedId(next?.id);
              setView("queue");
            }}
          >
            Next unresolved
          </Button>
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
                  <span className="text-sm font-medium">
                    {item.world
                      ? formatBatchWorldLabel(item.world)
                      : Object.values(item.values).map(humanizeBatchIdentity).join(" · ") ||
                        `Case ${item.index + 1}`}
                  </span>
                  <span className="text-xs text-foreground">
                    {item.status} · {item.triageStatus ?? "unreviewed"}
                  </span>
                </button>
              </li>
            ))}
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
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">
                      Case {focused.index + 1} · {focused.status}
                    </h3>
                    {focused.error ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatBatchCaseError(focused.error)}
                      </p>
                    ) : null}
                  </div>
                  {focused.runId ? (
                    <>
                      <Button
                        nativeButton={false}
                        variant="ghost"
                        className="min-h-11"
                        render={
                          <Link
                            to="/runs/$runId"
                            params={{ runId: focused.runId }}
                            search={{ reportView: "captures" }}
                          />
                        }
                      >
                        Open full report
                      </Button>
                      <Button
                        nativeButton={false}
                        variant="ghost"
                        className="min-h-11"
                        render={
                          <Link to="/runs/$runId/walkthrough" params={{ runId: focused.runId }} />
                        }
                      >
                        Walk through
                      </Button>
                    </>
                  ) : null}
                  {isBatchCaseProblem(focused) &&
                  focused.triageStatus !== "resolved" &&
                  focused.triageStatus !== "wont-fix" ? (
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
                      {pending ? "Saving…" : "Resolve and continue"}
                    </Button>
                  ) : null}
                  <p className="w-full text-xs text-muted-foreground">
                    Review decisions do not change execution outcomes or approve visual baselines.
                  </p>
                </header>
                <div className="min-h-96 overflow-auto">
                  {focused.runId ? (
                    <RunInspection key={focused.runId} runId={focused.runId} embedded />
                  ) : (
                    <p className="p-6 text-sm text-muted-foreground">
                      No run evidence is available for this case.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Cases will appear here when the Plan starts.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
