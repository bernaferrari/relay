import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import type { ProductRunSummary } from "@relay/product/catalog";
import type { ProductStabilitySummary } from "../data/stability-product-service";
import { OutcomeMark } from "../components/product-patterns";
import { formatRunDate } from "./saved-test-steps";

export function TestRunHistory({
  open,
  onOpenChange,
  testId,
  name,
  runs,
  stability,
  historyComplete,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  testId: string;
  name?: string;
  runs: readonly ProductRunSummary[];
  stability?: ProductStabilitySummary;
  historyComplete: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(720px,85dvh)] w-[min(640px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <header className="space-y-1 px-6 pt-6 pb-4 pr-12">
          <DialogTitle>Run history</DialogTitle>
          <DialogDescription className="truncate">{name}</DialogDescription>
        </header>
        <div className="min-h-0 overflow-y-auto px-6">
          {stability ? (
            <dl className="mb-5 grid grid-cols-3 gap-4 rounded-lg bg-muted/40 p-4">
              {[
                ["Runs", stability.sampleCount],
                ["Passed", stability.passedCount],
                ["Product issues", stability.failedCount],
              ].map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-xl font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {!historyComplete ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Showing loaded runs. Totals may be incomplete.
            </p>
          ) : null}
          <ul className="divide-y divide-border">
            {[...runs]
              .sort(
                (left, right) =>
                  (right.finishedAt ?? right.startedAt ?? right.queuedAt) -
                  (left.finishedAt ?? left.startedAt ?? left.queuedAt),
              )
              .slice(0, 20)
              .map((run) => (
                <li key={run.id}>
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    onClick={() => onOpenChange(false)}
                    className="group flex min-h-16 items-center gap-4 rounded-md px-2 py-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <OutcomeMark outcome={run.outcome ?? run.phase} />
                      {run.targetName ? (
                        <p className="truncate text-xs text-muted-foreground">{run.targetName}</p>
                      ) : null}
                    </div>
                    <time
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      dateTime={new Date(
                        run.finishedAt ?? run.startedAt ?? run.queuedAt,
                      ).toISOString()}
                    >
                      {formatRunDate(run.finishedAt ?? run.startedAt ?? run.queuedAt)}
                    </time>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
          </ul>
        </div>
        <footer className="mt-2 flex justify-end border-t border-border px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/runs" search={{ view: "all", test: testId }} />}
          >
            View all runs <ChevronRight />
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
