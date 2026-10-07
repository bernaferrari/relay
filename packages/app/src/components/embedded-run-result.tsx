import { TestStepButton, TestWorkspace, WorkspaceScreenshot } from "./test-workspace";
import {
  destIdentityReviewItems,
  isCaptureReviewDestPhase,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewOpenerCaption,
} from "@relay/protocol";
import { useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { initialRunStep } from "../data/run-timeline-selection";
import { framePathsForTraceStep } from "../data/run-report-model";
import { formatDuration } from "./run-report-formatters";
import { EvidenceImageViewer } from "./evidence-image-viewer";
import { RunStepDisclosure, runChildStatus } from "./run-step-disclosure";
import { CheckCircle2, CircleAlert, ImageOff } from "lucide-react";
import type { ProductRunReportOverview, ReportEvidenceItem } from "../data/run-report-model";

/** Dest wait-for thumb when leftover Close / Transition executed last-frame
 * captions are also listed. Opener before · Tap cannot fill dest beside those
 * leftovers. Unphased dest-wait (no dest wait-for caption) keeps the last media
 * frame. */
function destWaitForEvidenceThumb(
  frames: readonly ReportEvidenceItem[],
): ReportEvidenceItem | undefined {
  const withMedia = frames.filter((item) => item.media);
  const dest = withMedia.filter((item) => !isCaptureReviewLeftoverCaption(item.title));
  const leftover = withMedia.filter((item) => isCaptureReviewLeftoverCaption(item.title));
  if (!(dest.length && leftover.length)) return withMedia.at(-1);
  const withoutOpeners = dest.filter((item) => !isCaptureReviewOpenerCaption(item.title));
  return (withoutOpeners.length ? withoutOpeners : dest).at(-1);
}

/** A result in the test workspace. The separate report owns diagnostics. */
export function EmbeddedRunResult({
  report,
  onReviewCaptures,
}: {
  report: ProductRunReportOverview;
  onReviewCaptures?: () => void;
}) {
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
  const [inspectingSteps, setInspectingSteps] = useState(() => !passed);
  const outline = report.authoredOutline;
  const timeline = outline?.steps ?? report.timeline;
  const [stepIndex, setStepIndex] = useState(() => initialRunStep(timeline));
  const [showingRunDetails, setShowingRunDetails] = useState(() =>
    Boolean(
      outline?.supportingSteps.some(
        (item) => item.state === "failed" || item.state === "blocked",
      ) && !timeline.some((item) => item.state === "failed" || item.state === "blocked"),
    ),
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string>();
  const children = showingRunDetails
    ? outline?.supportingSteps
    : outline?.steps[stepIndex]?.children;
  const selectedChild =
    children?.find((item) => item.id === selectedTraceId) ??
    children?.find((item) => item.state === "failed" || item.state === "blocked");
  const step = selectedChild ?? (showingRunDetails ? undefined : timeline[stepIndex]);
  const authoredFrames =
    step && !outline ? framePathsForTraceStep(report.stepEvidence, step.id, step.index) : [];
  const paths = authoredFrames.length ? authoredFrames : (step?.framePaths ?? []);
  const frames = report.evidence.find((section) => section.id === "screenshot")?.items ?? [];
  const reviewItems = destIdentityReviewItems(report.captureReview?.items ?? []);
  const finalStepPath = report.timeline
    .flatMap((item) => {
      const authored = framePathsForTraceStep(report.stepEvidence, item.id, item.index);
      return authored.length ? authored : (item.framePaths ?? []);
    })
    .at(-1);
  const destPath =
    reviewItems.find((item) => isCaptureReviewDestPhase(item.phase))?.framePath ??
    finalStepPath ??
    reviewItems.filter((item) => item.framePath).at(-1)?.framePath;
  const lastPath = paths.at(-1);
  const showingCapturedResult = Boolean(destPath) && !inspectingSteps;
  const thumbId = showingCapturedResult ? destPath : lastPath;
  const frame = step
    ? frames.find((item) => item.id === thumbId && item.media)
    : destPath
      ? frames.find((item) => item.id === destPath && item.media)
      : destWaitForEvidenceThumb(frames);
  const Icon = passed ? CheckCircle2 : CircleAlert;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Run result">
      <header className="flex shrink-0 items-start gap-2.5 border-b border-border px-5 py-3">
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
      <TestWorkspace
        outline={
          <div className="grid content-start gap-4 p-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border pb-3 text-xs text-muted-foreground">
              <span>{report.targetName ?? "Device not recorded"}</span>
              {report.executionContext?.sourceRevision ? (
                <span>Source revision {report.executionContext.sourceRevision}</span>
              ) : null}
              {report.executionContext?.account ? (
                <span>{report.executionContext.account}</span>
              ) : null}
              {report.executionContext?.locale ? (
                <span>{report.executionContext.locale}</span>
              ) : null}
            </div>
            {report.captureReview?.items.length && onReviewCaptures ? (
              <Button
                size="sm"
                variant="ghost"
                className="justify-between"
                onClick={onReviewCaptures}
              >
                <span>Screenshots</span>
                <span className="text-xs">
                  {report.captureReview.summary?.pending
                    ? `${report.captureReview.summary.pending} to review`
                    : report.captureReview.summary?.missing
                      ? `${report.captureReview.summary.missing} missing`
                      : "View"}
                </span>
              </Button>
            ) : null}
            {destPath ? (
              <TestStepButton
                number=""
                selected={showingCapturedResult}
                onClick={() => setInspectingSteps(false)}
              >
                {passed ? "Captured result" : "Last screenshot"}
              </TestStepButton>
            ) : null}
            {timeline.length ? (
              <ol className="grid list-none gap-1 p-0" aria-label="Run steps">
                {timeline.map((item, index) => (
                  <li key={item.id}>
                    <TestStepButton
                      number={String(index + 1)}
                      selected={!showingCapturedResult && !showingRunDetails && index === stepIndex}
                      onClick={() => {
                        setInspectingSteps(true);
                        setStepIndex(index);
                        setShowingRunDetails(false);
                        setSelectedTraceId(undefined);
                      }}
                    >
                      <span className="block font-medium">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.state}
                        {outline && runChildStatus(outline.steps[index]?.children ?? [])
                          ? ` · ${runChildStatus(outline.steps[index]?.children ?? [])}`
                          : ""}
                      </span>
                    </TestStepButton>
                  </li>
                ))}
              </ol>
            ) : null}
            {outline?.supportingSteps.length ? (
              <TestStepButton
                number=""
                selected={!showingCapturedResult && showingRunDetails}
                onClick={() => {
                  setInspectingSteps(true);
                  setShowingRunDetails(true);
                  setSelectedTraceId(undefined);
                }}
              >
                <span className="block font-medium">Run details</span>
                <span className="text-xs text-muted-foreground">
                  {runChildStatus(outline.supportingSteps) ?? "Setup and other retained evidence"}
                </span>
              </TestStepButton>
            ) : null}
            {children && !showingCapturedResult ? (
              <RunStepDisclosure
                steps={children}
                selectedId={selectedChild?.id}
                onSelect={setSelectedTraceId}
              />
            ) : null}
            {step && !showingCapturedResult ? (
              <div className="grid gap-2">
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
          </div>
        }
        preview={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden p-4">
            {frame?.media ? (
              <WorkspaceScreenshot>
                <EvidenceImageViewer key={frame.id} frame={frame} onError={() => {}} />
              </WorkspaceScreenshot>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOff className="size-5" aria-hidden="true" />
                <p className="text-sm">No screenshot was saved for this selection.</p>
              </div>
            )}
          </div>
        }
      />
    </section>
  );
}
