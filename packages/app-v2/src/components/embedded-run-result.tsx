import { destIdentityReviewItems, isCaptureReviewDestPhase } from "@relay/protocol";
import { useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { initialRunStep } from "../data/run-timeline-selection";
import { framePathsForTraceStep } from "../data/run-report-model";
import { formatDuration } from "./run-report-formatters";
import { ReportImage } from "./report-image";
import { CheckCircle2, CircleAlert, ImageOff } from "lucide-react";
import type { ProductRunReportOverview } from "../data/run-report-model";

/** A result in the test workspace. The separate report owns diagnostics. */
export function EmbeddedRunResult({ report }: { report: ProductRunReportOverview }) {
  const passed = report.outcome === "passed";
  const diagnostic = [report.cause, ...report.timeline.map((step) => step.log)].join("");
  const inspectionUnavailable = /screen-inspection-unavailable:/iu.test(diagnostic);
  const mismatch = !inspectionUnavailable && /expect-screen:/iu.test(diagnostic);
  const title = passed
    ? report.captureReview?.items.length
      ? "Run completed"
      : "Test passed"
    : inspectionUnavailable
      ? "Screen inspection unavailable"
      : mismatch
        ? "Screen didn’t match"
        : report.outcome === "cancelled"
          ? "Run cancelled"
          : "Run couldn’t finish";
  const detail = inspectionUnavailable
    ? "Relay couldn’t read the device’s controls. Reconnect the device, then run the test again. This does not confirm a screen mismatch."
    : mismatch
      ? "Relay couldn’t recognize the taught screen in this capture. Compare it with the recorded screen before running again."
      : passed
        ? undefined
        : "Open the full report to inspect where the run stopped.";
  const [stepIndex, setStepIndex] = useState(() => initialRunStep(report.timeline));
  const step = report.timeline[stepIndex];
  const authoredFrames = step
    ? framePathsForTraceStep(report.stepEvidence, step.id, step.index)
    : [];
  const paths = authoredFrames.length ? authoredFrames : (step?.framePaths ?? []);
  const frames = report.evidence.find((section) => section.id === "screenshot")?.items ?? [];
  const destPath = destIdentityReviewItems(report.captureReview?.items ?? []).find((item) =>
    isCaptureReviewDestPhase(item.phase),
  )?.framePath;
  const lastPath = paths.at(-1);
  const thumbId = destPath ?? lastPath;
  const frame = step
    ? frames.find((item) => item.id === thumbId && item.media)
    : destPath
      ? frames.find((item) => item.id === destPath && item.media)
      : frames.filter((item) => item.media).at(-1);
  const Icon = passed ? CheckCircle2 : CircleAlert;
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 p-4" aria-label="Run result">
      <header className="flex shrink-0 items-start gap-2.5">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${passed ? "text-muted-foreground" : "text-foreground"}`}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {detail ? (
            <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">{detail}</p>
          ) : null}
        </div>
        {report.durationMs !== undefined ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(report.durationMs)}
          </span>
        ) : null}
      </header>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-3 text-xs text-muted-foreground">
        <span>{report.targetName ?? "Device not recorded"}</span>
        <span>
          {report.executionContext?.sourceRevision
            ? `Source revision ${report.executionContext.sourceRevision}`
            : "Source revision not recorded"}
        </span>
        {report.executionContext?.account ? <span>{report.executionContext.account}</span> : null}
        {report.executionContext?.locale ? <span>{report.executionContext.locale}</span> : null}
      </div>
      {step ? (
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              aria-label="Previous run step"
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((index) => index - 1)}
            >
              Previous
            </Button>
            <p className="min-w-0 flex-1 text-sm font-medium" aria-live="polite">
              {stepIndex + 1} / {report.timeline.length} · {step.title}
            </p>
            <Button
              size="sm"
              variant="outline"
              aria-label="Next run step"
              disabled={stepIndex >= report.timeline.length - 1}
              onClick={() => setStepIndex((index) => index + 1)}
            >
              Next
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Saved run step · {step.state}</p>
          {step.expected ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Expected: </span>
              {step.expected}
            </p>
          ) : null}
          {step.observed ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Observed: </span>
              {step.observed}
            </p>
          ) : null}
        </div>
      ) : null}
      {frame?.media ? (
        <figure className="flex min-h-0 flex-1 flex-col gap-2">
          <ReportImage
            media={frame.media}
            alt="Screen captured during this run"
            className="min-h-0 flex-1 rounded-md object-contain"
          />
        </figure>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          <p className="text-sm">No screenshot was saved for this selection.</p>
        </div>
      )}
    </section>
  );
}
