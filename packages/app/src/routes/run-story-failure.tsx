/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { CircleX, Eye, Settings, Wrench } from "lucide-react";
import type { StoryAction, StoryStep } from "../data/run-story";
import type { ProductRunReportOverview } from "../data/run-report-model";
import { storyFailureNextAction } from "../data/run-story-failure-cause";

export function RunStoryFailure({
  step,
  action,
  stepNumber,
  testId,
  report,
  onInspectEvidence,
}: {
  step: StoryStep;
  action?: StoryAction;
  stepNumber: number;
  /** Present only when the failed step belongs to this editable saved Test. */
  testId?: string;
  report: Pick<ProductRunReportOverview, "outcome" | "failureCategory">;
  onInspectEvidence(): void;
}) {
  const nextAction = storyFailureNextAction(report);
  const inspect = nextAction === "inspect" || !testId;
  const productOverlap = inspect && action?.failure?.kind === "layout-overlap";
  return (
    <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2 text-sm">
        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="grid min-w-0 gap-0.5">
          {/* Name the action that failed; the step it belongs to is context. */}
          <p className="font-semibold">
            {action && action.label !== step.title
              ? `${action.label} failed`
              : `${step.title} failed`}
          </p>
          <p className="text-xs text-muted-foreground">
            Step {stepNumber}
            {action && action.label !== step.title ? ` · ${step.title}` : ""}
          </p>
          {action?.failure?.summary || action?.detail ? (
            <p className="mt-1 text-muted-foreground">{action.failure?.summary ?? action.detail}</p>
          ) : null}
        </div>
      </div>
      {action?.failure?.technicalDetail ? (
        <details className="pl-6 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">
            Technical details
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
            {action.failure.technicalDetail}
          </pre>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2 pl-6">
        {inspect ? (
          <Button size="sm" onClick={onInspectEvidence}>
            <Eye aria-hidden="true" /> See where it failed
          </Button>
        ) : nextAction === "setup" && testId ? (
          <Button
            nativeButton={false}
            size="sm"
            render={<Link to="/tests/$testId" params={{ testId }} search={{ setup: "run" }} />}
          >
            <Settings aria-hidden="true" /> Repair setup
          </Button>
        ) : null}
        {testId ? (
          <Button
            nativeButton={false}
            size="sm"
            variant={nextAction === "edit" ? "default" : "outline"}
            render={<Link to="/tests/$testId" params={{ testId }} search={{ step: step.id }} />}
          >
            {productOverlap ? <Eye aria-hidden="true" /> : <Wrench aria-hidden="true" />}
            {productOverlap ? "View check" : "Edit step"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
