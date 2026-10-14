/** @jsxImportSource react */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { plainRunReason } from "@relay/protocol";
import type { ProductRunReportOverview } from "../data/run-report-model";
import { storyFromReport, type StoryState } from "../data/run-story";
import { formatDuration } from "../components/run-report-formatters";

export type StepOutcome = { state: StoryState; durationMs?: number };

type LatestRun = {
  runId: string;
  couldNotRun: boolean;
  failedStepId?: string;
  reason?: string;
};

type Outcomes = { byStep: Readonly<Record<string, StepOutcome>>; latest?: LatestRun };

const StepOutcomesContext = createContext<Outcomes>({ byStep: {} });

/**
 * The saved Test and its latest result on one page: each step carries the
 * outcome of the most recent run, so nobody flips between "Test" and "Result".
 */
export function StepOutcomesProvider({
  runId,
  report,
  children,
}: {
  /** The run the header shows; a report for any other run is ignored. */
  runId?: string;
  report?: ProductRunReportOverview;
  children: ReactNode;
}) {
  const value = useMemo<Outcomes>(() => {
    if (!report || !runId || report.runId !== runId) return { byStep: {} };
    const steps = storyFromReport({
      timeline: report.traceSteps?.length ? report.traceSteps : report.timeline,
      ...(report.stepEvidence ? { stepEvidence: report.stepEvidence } : {}),
    });
    const byStep: Record<string, StepOutcome> = {};
    for (const step of steps) {
      byStep[step.id] = {
        state: step.state,
        ...(step.durationMs ? { durationMs: step.durationMs } : {}),
      };
    }
    const failed = steps.find((step) => step.state === "failed");
    const couldNotRun = report.outcome === "harness-failure";
    const failedAction = failed?.actions.find((action) => action.state === "failed");
    const rawReason = couldNotRun
      ? plainRunReason(report.technicalCause ?? report.cause)
      : (failedAction?.failure?.summary ??
        failedAction?.observed ??
        plainRunReason(failedAction?.detail) ??
        plainRunReason(report.cause));
    const latest =
      report.outcome === "product-failure" || couldNotRun
        ? {
            runId: report.runId,
            couldNotRun,
            ...(failed ? { failedStepId: failed.id } : {}),
            ...(rawReason
              ? { reason: rawReason.charAt(0).toUpperCase() + rawReason.slice(1) }
              : {}),
          }
        : undefined;
    return { byStep, ...(latest ? { latest } : {}) };
  }, [report, runId]);
  return <StepOutcomesContext.Provider value={value}>{children}</StepOutcomesContext.Provider>;
}

export function useStepOutcome(stepId: string): StepOutcome | undefined {
  return useContext(StepOutcomesContext).byStep[stepId];
}

/** Duration and a mark from the latest run; steps it never reached stay quiet. */
export function StepOutcomeMark({ stepId }: { stepId: string }) {
  const outcome = useStepOutcome(stepId);
  if (!outcome || (outcome.state !== "passed" && outcome.state !== "failed")) return <span />;
  const failed = outcome.state === "failed";
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground"
      aria-label={`Last run: ${failed ? "failed" : "passed"}`}
    >
      {outcome.durationMs ? formatDuration(outcome.durationMs) : null}
      {failed ? (
        <CircleX className="size-3.5 text-destructive" aria-hidden="true" />
      ) : (
        <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
      )}
    </span>
  );
}

/** One line above the steps when the latest run didn't pass: what, why, and where to look. */
export function LatestRunBanner({ stepTitle }: { stepTitle(stepId: string): string | undefined }) {
  const { latest } = useContext(StepOutcomesContext);
  if (!latest) return null;
  const step = latest.failedStepId ? stepTitle(latest.failedStepId) : undefined;
  const Icon = latest.couldNotRun ? TriangleAlert : CircleX;
  return (
    <div
      role="status"
      className={`mt-3 grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-lg border p-3 text-sm ${
        latest.couldNotRun
          ? "border-warning/40 bg-warning/5"
          : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <Icon
        className={`mt-0.5 size-4 ${latest.couldNotRun ? "text-warning-foreground" : "text-destructive"}`}
        aria-hidden="true"
      />
      <p className="font-medium">
        {latest.couldNotRun
          ? "The last run couldn’t finish"
          : step
            ? `Last run failed at “${step}”`
            : "The last run failed"}
      </p>
      {latest.reason ? (
        <p className="col-start-2 text-xs leading-relaxed text-muted-foreground">{latest.reason}</p>
      ) : null}
      <Link
        to="/runs/$runId"
        params={{ runId: latest.runId }}
        className="col-start-2 mt-0.5 inline-flex w-fit items-center gap-0.5 rounded-sm text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Open report <ChevronRight className="size-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
