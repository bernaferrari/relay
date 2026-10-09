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
import { firstSentence, formatDuration } from "./run-report-formatters";
import { EvidenceImageViewer } from "./evidence-image-viewer";
import { RunStepDisclosure, runChildStatus } from "./run-step-disclosure";
import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  ImageOff,
  LoaderCircle,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import type {
  ProductRunReportOverview,
  ReportEvidenceItem,
  ReportTimelineItem,
} from "../data/run-report-model";

const STEP_STATE: Record<
  ReportTimelineItem["state"],
  { label: string; icon: typeof CircleCheck; tone: string }
> = {
  passed: { label: "Passed", icon: CircleCheck, tone: "text-success-foreground" },
  recovered: { label: "Recovered", icon: RotateCcw, tone: "text-warning-foreground" },
  failed: { label: "Failed", icon: CircleX, tone: "text-destructive" },
  blocked: { label: "Blocked", icon: CircleMinus, tone: "text-destructive" },
  running: { label: "Running", icon: LoaderCircle, tone: "text-brand" },
  pending: { label: "Not run", icon: CircleDashed, tone: "text-muted-foreground/70" },
};

/** One glanceable verdict per step: icon, word, and colour agree. */
function StepState({ state, detail }: { state: ReportTimelineItem["state"]; detail?: string }) {
  const presentation = STEP_STATE[state];
  const Icon = presentation.icon;
  return (
    <span className={`mt-0.5 flex items-center gap-1 text-xs ${presentation.tone}`}>
      <Icon
        className={`size-3.5 shrink-0 ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      <span>{presentation.label}</span>
      {detail ? <span className="text-muted-foreground">· {detail}</span> : null}
    </span>
  );
}

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
  onOpenReport,
}: {
  report: ProductRunReportOverview;
  onReviewCaptures?: () => void;
  onOpenReport?: () => void;
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
        : report.cause
          ? firstSentence(report.cause)
          : "The report shows where the run stopped and why.";
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
  const destFrame = destPath
    ? frames.find((item) => item.id === destPath && item.media)
    : undefined;
  const showingCapturedResult = Boolean(destFrame) && !inspectingSteps;
  const thumbId = showingCapturedResult ? destPath : lastPath;
  const frame = step
    ? frames.find((item) => item.id === thumbId && item.media)
    : destPath
      ? frames.find((item) => item.id === destPath && item.media)
      : destWaitForEvidenceThumb(frames);
  // A step that stopped before saving a screenshot still has a moment worth
  // seeing: the last screen Relay captured, labelled as such.
  const fallbackFrame = !frame?.media && step && !showingCapturedResult ? destFrame : undefined;
  const shownFrame = frame?.media ? frame : fallbackFrame;
  const stepFailure =
    step && (step.state === "failed" || step.state === "blocked")
      ? step.failure?.summary
      : undefined;
  const Icon = passed ? CircleCheck : CircleAlert;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Run result">
      <header
        className={`flex shrink-0 items-start gap-3 border-b border-border px-5 py-3 ${
          passed ? "" : "bg-destructive/[0.06]"
        }`}
      >
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${passed ? "text-success-foreground" : "text-destructive"}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {detail ? (
            <p className="mt-0.5 line-clamp-2 max-w-prose text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          ) : null}
        </div>
        {report.durationMs !== undefined ? (
          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatDuration(report.durationMs)}
          </span>
        ) : null}
        {onOpenReport ? (
          <Button size="sm" variant={passed ? "ghost" : "outline"} onClick={onOpenReport}>
            Open report
            <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        ) : null}
      </header>
      <TestWorkspace
        outline={
          <div className="grid content-start gap-4 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="size-3.5" aria-hidden="true" />
                {report.targetName ?? "Device not recorded"}
              </span>
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
            {destFrame ? (
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
                      <span
                        className={`block font-medium ${item.state === "pending" ? "text-muted-foreground" : ""}`}
                      >
                        {item.title}
                      </span>
                      <StepState
                        state={item.state}
                        detail={
                          outline ? runChildStatus(outline.steps[index]?.children ?? []) : undefined
                        }
                      />
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
            {stepFailure ? (
              <p
                className="rounded-md border border-destructive/25 bg-destructive/[0.06] px-3 py-2 text-sm leading-5"
                role="status"
              >
                {stepFailure}
              </p>
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
            {shownFrame?.media ? (
              <WorkspaceScreenshot
                caption={
                  shownFrame === fallbackFrame
                    ? "No screenshot for this step — showing the last screen Relay saw"
                    : undefined
                }
              >
                <EvidenceImageViewer key={shownFrame.id} frame={shownFrame} onError={() => {}} />
              </WorkspaceScreenshot>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
                <ImageOff className="size-5" aria-hidden="true" />
                <p className="text-sm">
                  {step?.state === "pending"
                    ? "This step didn’t run."
                    : "No screenshot was saved for this step."}
                </p>
              </div>
            )}
          </div>
        }
      />
    </section>
  );
}
