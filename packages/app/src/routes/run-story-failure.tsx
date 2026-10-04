/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { CircleX, Eye, Wrench } from "lucide-react";
import type { StoryAction, StoryStep } from "../data/run-story";

export function RunStoryFailure({
  step,
  action,
  stepNumber,
  testId,
}: {
  step: StoryStep;
  action?: StoryAction;
  stepNumber: number;
  /** Present only when the failed step belongs to this editable saved Test. */
  testId?: string;
}) {
  const productOverlap = action?.failure?.kind === "layout-overlap";
  return (
    <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <p className="flex items-start gap-2 text-sm">
        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <span className="min-w-0">
          <strong className="font-semibold">
            Step {stepNumber} failed: {step.title}
          </strong>
          {action ? (
            <span className="block text-muted-foreground">
              {action.failure?.summary ??
                `${action.label} didn’t work${action.detail ? ` — ${action.detail}` : "."}`}
            </span>
          ) : null}
        </span>
      </p>
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
      {testId ? (
        <div className="flex flex-wrap gap-2 pl-6">
          <Button
            nativeButton={false}
            size="sm"
            variant={productOverlap ? "outline" : "default"}
            render={<Link to="/tests/$testId" params={{ testId }} search={{ step: step.id }} />}
          >
            {productOverlap ? <Eye aria-hidden="true" /> : <Wrench aria-hidden="true" />}
            {productOverlap ? "View check" : "Fix this step"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
