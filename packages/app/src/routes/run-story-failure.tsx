/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { CircleX, Eye, Settings, Wrench } from "lucide-react";
import type { StoryAction, StoryStep } from "../data/run-story";
import type { ProductRunReportOverview } from "../data/run-report-model";
import { storyFailureNextAction } from "../data/run-story-failure-cause";
import { plainRunReason } from "@relay/protocol";

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
  report: Pick<
    ProductRunReportOverview,
    "outcome" | "failureCategory" | "cause" | "category" | "technicalCause"
  >;
  onInspectEvidence(): void;
}) {
  const nextAction = storyFailureNextAction(report);
  // Say why in a sentence, right here; the raw message stays one click away.
  // "Could not run" is about Relay or the device, not the app: tell that story,
  // so the card never contradicts the outcome pill above it.
  const couldNotRun = report.outcome === "harness-failure";
  const rawCause = report.technicalCause ?? report.cause;
  const rawReason = couldNotRun
    ? (plainRunReason(rawCause) ?? action?.failure?.summary ?? plainRunReason(action?.detail))
    : (action?.failure?.summary ?? plainRunReason(action?.detail) ?? plainRunReason(report.cause));
  // Engine messages can arrive lowercase ("navigating to…"); present them as sentences.
  const reason = rawReason ? rawReason.charAt(0).toUpperCase() + rawReason.slice(1) : rawReason;
  const inspect = nextAction === "inspect" || !testId;
  const productOverlap = inspect && action?.failure?.kind === "layout-overlap";
  return (
    <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2 text-sm">
        <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="grid min-w-0 gap-0.5">
          {couldNotRun ? (
            <>
              {/* Where it stopped, why, and what that means — nothing repeated. */}
              <p className="font-semibold">
                Stopped at step {stepNumber}
                {action ? ` · ${action.label}` : ""}
              </p>
              {reason ? <p className="text-foreground/80 wrap-anywhere">{reason}</p> : null}
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {report.category ? `${report.category} problem` : "Relay or the device stopped"} —
                not a verdict on your app.
              </p>
            </>
          ) : (
            <>
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
              {action?.expected && action.state === "failed" ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Expected</dt>
                  <dd>{action.expected}</dd>
                  <dt className="text-muted-foreground">Saw</dt>
                  <dd>
                    {action.observed ?? action.detail ?? "Nothing was recorded for this check."}
                  </dd>
                </dl>
              ) : reason ? (
                <p className="mt-1 text-foreground/80">{reason}</p>
              ) : null}
            </>
          )}
        </div>
      </div>
      {(couldNotRun ? rawCause : action?.failure?.technicalDetail) ? (
        <details className="pl-6 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring">
            Technical details
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
            {couldNotRun ? rawCause : action?.failure?.technicalDetail}
          </pre>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2 pl-6">
        {inspect ? (
          <Button size="sm" variant="outline" className="bg-card" onClick={onInspectEvidence}>
            <Eye aria-hidden="true" /> See where it failed
          </Button>
        ) : nextAction === "setup" && testId ? (
          <Button
            nativeButton={false}
            size="sm"
            variant="outline"
            className="bg-card"
            render={<Link to="/tests/$testId" params={{ testId }} search={{ setup: "run" }} />}
          >
            <Settings aria-hidden="true" /> Check run setup
          </Button>
        ) : null}
        {testId ? (
          <Button
            nativeButton={false}
            size="sm"
            variant="outline"
            className="bg-card"
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
