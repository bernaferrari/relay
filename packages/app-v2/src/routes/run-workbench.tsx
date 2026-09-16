import { ReportImage } from "../components/report-image";
import { workspacePreviewSurface, workspaceToolsSurface } from "../components/workspace-surfaces";
import { RunLogPanel } from "../components/run-log-panel";
/** @jsxImportSource react */
import { RunPerformancePanel, performanceStepAt } from "../components/run-performance-panel";
import { traceVideoInterval } from "../data/run-report-media";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";
import { ReportVideoInspector } from "../components/report-video-inspector";
import { Button } from "@relay/ui-react/components/button";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import {
  Check,
  Circle,
  CircleAlert,
  ImageOff,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Hand,
  ArrowLeft,
  Camera,
  Clock,
  Keyboard,
  MoveUpRight,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  framePathsForTraceStep,
  type ProductRunReportOverview,
  type ReportEvidenceItem,
} from "../data/run-product-service";
import { CaptureReviewPanel } from "./run-capture-review-panel";
import {
  captureReviewCoverageLine,
  type CaptureReviewAction,
  type CaptureReviewItem,
  type CaptureReviewMask,
} from "@relay/protocol";

type Report = ProductRunReportOverview;

export function RunWorkbench({
  report,
  selectedStepIndex,
  failureNotice,
  footer,
  onSelectStep,
  view,
  onViewChange,
  captureIndex,
  onCaptureChange,
  onReviewCapture,
}: {
  report: Report;
  view?: string;
  onViewChange?(view: string): void;
  captureIndex?: number;
  onCaptureChange?(index: number): void;
  selectedStepIndex: number;
  failureNotice?: ReactNode;
  footer?: ReactNode;
  onSelectStep(index: number): void;
  onReviewCapture?(input: {
    captureId: string;
    action: CaptureReviewAction;
    imageSha256?: string;
  }): Promise<void>;
  renderEvidence?(section: Report["evidence"][number]): ReactNode;
}) {
  const [requestedPanel, setRequestedPanel] = useState<
    "steps" | "captures" | "performance" | "details" | "video" | "logs"
  >(() =>
    report.captureReview?.items.length
      ? "captures"
      : report.timeline.some((item) => item.framePaths?.length) ||
          report.stepEvidence?.some((item) => item.evidence.framePaths.length) ||
          !report.evidence.some(
            (section) => section.id === "screenshot" && section.items.some((item) => item.media),
          )
        ? "steps"
        : "captures",
  );
  const setPanel = (value: typeof requestedPanel) => {
    setRequestedPanel(value);
    onViewChange?.(value);
  };
  const [localCapture, setLocalCapture] = useState(0);
  const [showMasks, setShowMasks] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const requestedCapture =
    Number.isInteger(captureIndex) && captureIndex! >= 0 ? captureIndex! : localCapture;
  const setSelectedCapture = (index: number) => {
    setLocalCapture(index);
    onCaptureChange?.(index);
  };
  const [showSetup, setShowSetup] = useState(false);
  const setupCount = report.timeline.filter((item) => item.phase === "setup").length;
  const setupVisible =
    showSetup ||
    setupCount === report.timeline.length ||
    report.timeline[selectedStepIndex]?.phase === "setup";
  const visibleIndexes = report.timeline.flatMap((item, index) =>
    item.phase !== "setup" || setupVisible ? [index] : [],
  );
  const allFrames =
    report.evidence
      .find((section) => section.id === "screenshot")
      ?.items.filter((item) => item.media) ?? [];
  const reviewItems = report.captureReview?.items ?? [];
  const reviewMode = reviewItems.length > 0;
  const selectedCapture = Math.min(
    requestedCapture,
    Math.max(0, (reviewMode ? reviewItems.length : allFrames.length) - 1),
  );
  const selectedReview = reviewItems[selectedCapture];
  const capture = reviewMode
    ? allFrames.find((item) => item.id === selectedReview?.framePath)
    : allFrames[selectedCapture];
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || requestedPanel === "captures") return;
    const timer = setTimeout(() => {
      if (selectedStepIndex >= report.timeline.length - 1) setPlaying(false);
      else onSelectStep(selectedStepIndex + 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [playing, selectedStepIndex, report.timeline.length, onSelectStep, requestedPanel]);
  const logs = report.evidence.find((section) => section.id === "logs")?.items ?? [];
  const step = report.timeline[selectedStepIndex] ?? report.timeline[0];
  const hasChecks = Boolean(step?.expected?.trim());
  const requestedView = ["steps", "captures", "performance", "details", "video", "logs"].includes(
    view ?? "",
  )
    ? (view as typeof requestedPanel)
    : requestedPanel;
  const panel = requestedView === "details" && !hasChecks ? "steps" : requestedView;
  const authoredFrames = framePathsForTraceStep(
    report.stepEvidence,
    step?.id ?? selectedStepIndex,
    step?.index,
  );
  const framePaths = new Set(authoredFrames.length ? authoredFrames : (step?.framePaths ?? []));
  const failureIndexes = report.timeline.flatMap((item, index) =>
    item.state === "failed" ? [index] : [],
  );
  const frames =
    report.evidence
      .find((section) => section.id === "screenshot")
      ?.items.filter((item) => framePaths.has(item.id) && item.media) ?? [];
  const beforeFrame = report.evidence
    .find((section) => section.id === "screenshot")
    ?.items.find((item) => item.id === step?.beforeFramePath && item.media);
  const actionFrames =
    beforeFrame && frames.length > 0
      ? [
          { ...beforeFrame, title: "Before action · previous saved frame" },
          ...frames.filter((item) => item.id !== beforeFrame.id),
        ]
      : frames;
  if (!step)
    return (
      <section
        className="overflow-hidden rounded-xl border border-border bg-card"
        aria-label="Run workbench"
      >
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Available evidence</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This Run has no saved step timeline. These artifacts belong to the Run; they cannot be
            attributed to a specific step.
          </p>
        </header>
        <StepMedia
          key={report.runId}
          frames={
            report.evidence
              .find((section) => section.id === "screenshot")
              ?.items.filter((item) => item.media) ?? []
          }
          unlinked
        />
        {report.video ? (
          <div className="border-t border-border p-5">
            <ReportVideoInspector video={report.video} diagnostics={report.diagnostics} />
          </div>
        ) : null}
        {report.evidence
          .filter((section) => section.id !== "screenshot" && section.items.length)
          .map((section) => (
            <section className="border-t border-border p-5" key={section.id}>
              <h3 className="text-sm font-semibold">{section.label}</h3>
              <ul className="mt-3 grid gap-3">
                {section.items.map((item) => (
                  <li key={item.id} className="text-sm">
                    <p>{item.title}</p>
                    {item.detail ? (
                      <p className="mt-1 text-muted-foreground">{item.detail}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </section>
    );
  return (
    <section
      className="grid h-full min-h-0 flex-1 min-w-0 gap-3 p-3 overflow-hidden max-[720px]:h-auto max-[720px]:grid-rows-[32rem_30rem] min-[721px]:grid-cols-[minmax(0,45%)_minmax(0,1fr)]"
      aria-label="Run workbench"
    >
      <div className={`relative flex flex-col ${workspacePreviewSurface}`}>
        <div className="flex h-11 shrink-0 items-center justify-between px-4 text-xs text-muted-foreground">
          <span>
            {panel === "captures"
              ? reviewMode && report.captureReview
                ? `${captureReviewCoverageLine(report.captureReview.summary)} · ${report.captureReview.summary.pending} pending review`
                : `Capture ${selectedCapture + 1} of ${allFrames.length}`
              : step.phase === "test"
                ? `Test step ${report.timeline.slice(0, selectedStepIndex + 1).filter((item) => item.phase === "test").length} of ${report.timeline.filter((item) => item.phase === "test").length}`
                : `Step ${selectedStepIndex + 1} of ${report.timeline.length}`}
          </span>
          <div
            className={panel === "captures" ? "hidden" : "flex shrink-0 items-center gap-1"}
            aria-label="Step playback"
          >
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous step"
              disabled={selectedStepIndex === 0}
              onClick={() => {
                setPlaying(false);
                onSelectStep(selectedStepIndex - 1);
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => {
                if (!playing && selectedStepIndex === report.timeline.length - 1) onSelectStep(0);
                setPlaying(!playing);
              }}
              aria-label={playing ? "Pause step playback" : "Play steps"}
            >
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next step"
              disabled={selectedStepIndex === report.timeline.length - 1}
              onClick={() => {
                setPlaying(false);
                onSelectStep(selectedStepIndex + 1);
              }}
            >
              <ChevronRight />
            </Button>
          </div>
          {panel !== "captures" && failureIndexes.length > 1 ? (
            <div className="flex items-center gap-1" aria-label="Failure navigation">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous failure"
                disabled={!failureIndexes.some((index) => index < selectedStepIndex)}
                onClick={() => {
                  setPlaying(false);
                  onSelectStep(failureIndexes.filter((index) => index < selectedStepIndex).at(-1)!);
                }}
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs">Failures</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next failure"
                disabled={!failureIndexes.some((index) => index > selectedStepIndex)}
                onClick={() => {
                  setPlaying(false);
                  onSelectStep(failureIndexes.find((index) => index > selectedStepIndex)!);
                }}
              >
                <ChevronRight />
              </Button>
            </div>
          ) : null}
          <span>
            {panel === "captures"
              ? "Saved screenshot"
              : step.durationMs === undefined
                ? timelineStateLabel(step.state)
                : `${(step.durationMs / 1000).toFixed(1)}s · ${timelineStateLabel(step.state)}`}
          </span>
        </div>
        <StepMedia
          key={`${report.runId}:${panel === "captures" ? capture?.id : step.id}`}
          frames={panel === "captures" ? (capture ? [capture] : []) : actionFrames}
          masks={
            panel === "captures" && showMasks && selectedReview?.masks?.length
              ? selectedReview.masks
              : undefined
          }
          controls={
            panel !== "captures" && !actionFrames.length && allFrames.length ? (
              <Button size="sm" variant="ghost" onClick={() => setPanel("captures")}>
                View all captures ({allFrames.length})
              </Button>
            ) : undefined
          }
          unlinked={panel === "captures"}
          actionBounds={panel === "captures" ? undefined : step.actionBounds}
          beforeFramePath={panel === "captures" ? undefined : step.beforeFramePath}
          fill
        />
      </div>
      <div className={workspaceToolsSurface}>
        <div
          className="flex shrink-0 gap-1 border-b border-border px-4 py-2"
          aria-label="Step views"
        >
          {(
            [
              ["steps", "Steps"],
              ...(allFrames.length || reviewMode ? [["captures", "Captures"]] : []),
              ...(report.performance?.length ? [["performance", "Performance"]] : []),
              ...(hasChecks ? [["details", "Checks"]] : []),
              ["logs", "Logs"],
              ...(report.video ? [["video", "Video"]] : []),
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={panel === value ? "secondary" : "ghost"}
              aria-pressed={panel === value}
              onClick={() => setPanel(value as typeof panel)}
            >
              {label}
              {value === "steps" ? (
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  {report.timeline.length - setupCount || report.timeline.length}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
        {panel === "steps" ? (
          <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScrollArea
              className="min-h-0 flex-1"
              viewportProps={{ "aria-label": "Recorded steps", className: "overscroll-auto" }}
            >
              {setupCount && setupCount < report.timeline.length ? (
                <button
                  type="button"
                  className="mx-2 mt-2 flex min-h-10 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2"
                  aria-expanded={setupVisible}
                  onClick={() => {
                    setShowSetup(!setupVisible);
                    if (setupVisible && report.timeline[selectedStepIndex]?.phase === "setup")
                      onSelectStep(report.timeline.findIndex((item) => item.phase !== "setup"));
                  }}
                >
                  {setupVisible ? "Hide setup" : "Show setup"}
                  <span className="tabular-nums">{setupCount} steps</span>
                </button>
              ) : null}
              <ol className="relay-test-readable-steps grid list-none gap-1 p-2 pb-4">
                {report.timeline.map((item, index) => {
                  if (!visibleIndexes.includes(index)) return null;
                  const Icon =
                    item.state === "passed" || item.state === "recovered"
                      ? Check
                      : item.state === "failed"
                        ? CircleAlert
                        : Circle;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-step-index={index}
                        aria-current={index === selectedStepIndex ? "step" : undefined}
                        aria-pressed={index === selectedStepIndex}
                        className={`relay-interactive-row relative grid min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${index === selectedStepIndex ? "bg-accent text-foreground ring-1 ring-inset ring-border" : "text-muted-foreground"}`}
                        onClick={() => onSelectStep(index)}
                        onKeyDown={(event) => {
                          const next =
                            event.key === "ArrowDown"
                              ? visibleIndexes[
                                  Math.min(
                                    visibleIndexes.length - 1,
                                    visibleIndexes.indexOf(index) + 1,
                                  )
                                ]
                              : event.key === "ArrowUp"
                                ? visibleIndexes[Math.max(0, visibleIndexes.indexOf(index) - 1)]
                                : event.key === "Home"
                                  ? visibleIndexes[0]
                                  : event.key === "End"
                                    ? visibleIndexes.at(-1)
                                    : undefined;
                          if (next === undefined) return;
                          event.preventDefault();
                          onSelectStep(next);
                          const buttons = event.currentTarget
                            .closest("ol")
                            ?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
                          Array.from(buttons ?? [])
                            .find((button) => button.dataset.stepIndex === String(next))
                            ?.focus();
                        }}
                      >
                        <span className="text-xs tabular-nums">
                          {item.phase === "test"
                            ? report.timeline
                                .slice(0, index + 1)
                                .filter((step) => step.phase === "test").length
                            : index + 1}
                        </span>
                        <span className="min-w-0">
                          <strong className="flex items-center gap-2 text-sm font-medium leading-5">
                            <StepActionIcon title={item.title} />
                            <span>{item.title}</span>
                          </strong>
                          <span className="sr-only">{timelineStateLabel(item.state)}</span>
                        </span>
                        <Icon
                          aria-hidden="true"
                          className={`size-4 ${item.state === "failed" ? "text-[var(--text-critical-base)]" : item.state === "passed" ? "text-[var(--text-success-base)]" : ""}`}
                        />
                      </button>
                      {index === selectedStepIndex &&
                      item.state === "failed" &&
                      index === failureIndexes.at(-1) &&
                      failureNotice ? (
                        <div className="pt-0.5">{failureNotice}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          </aside>
        ) : null}
        {panel === "logs" ? <RunLogPanel logs={logs} /> : null}
        <ScrollArea
          className={panel === "steps" || panel === "logs" ? "hidden" : "min-h-0 flex-1"}
          viewportProps={{ "aria-label": "Step report", className: "overscroll-auto" }}
        >
          {panel === "captures" ? (
            reviewMode && report.captureReview ? (
              <CaptureReviewPanel
                queue={report.captureReview}
                frames={allFrames}
                selectedIndex={selectedCapture}
                onSelect={setSelectedCapture}
                busy={reviewBusy}
                showMasks={showMasks}
                onShowMasksChange={setShowMasks}
                fallbackConfiguration={{
                  ...(report.targetName ? { app: report.targetName } : {}),
                  ...(report.executionContext?.account
                    ? { account: report.executionContext.account }
                    : {}),
                  ...(report.executionContext?.browser
                    ? { browser: report.executionContext.browser }
                    : {}),
                  ...(report.executionContext?.viewport
                    ? { viewport: report.executionContext.viewport }
                    : {}),
                  ...(report.executionContext?.locale
                    ? { locale: report.executionContext.locale }
                    : {}),
                  ...(report.executionContext?.buildId
                    ? { build: report.executionContext.buildId }
                    : report.executionContext?.appVersion
                      ? { build: report.executionContext.appVersion }
                      : {}),
                }}
                onReview={
                  onReviewCapture
                    ? async (action: CaptureReviewAction, item: CaptureReviewItem) => {
                        setReviewBusy(true);
                        try {
                          await onReviewCapture({
                            captureId: item.captureId,
                            action,
                            ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
                          });
                        } finally {
                          setReviewBusy(false);
                        }
                      }
                    : undefined
                }
                onReviewMany={
                  onReviewCapture
                    ? async (action: CaptureReviewAction, items: CaptureReviewItem[]) => {
                        setReviewBusy(true);
                        try {
                          for (const item of items) {
                            await onReviewCapture({
                              captureId: item.captureId,
                              action,
                              ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
                            });
                          }
                        } finally {
                          setReviewBusy(false);
                        }
                      }
                    : undefined
                }
              />
            ) : (
              <div className="p-2">
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  All screenshots saved during this run.
                </p>
                <ul className="grid list-none gap-1">
                  {allFrames.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={index === selectedCapture}
                        className={`relay-interactive-row flex min-h-20 w-full items-center gap-3 rounded-md p-3 text-left focus-visible:outline-2 focus-visible:outline-ring ${index === selectedCapture ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
                        onClick={() => setSelectedCapture(index)}
                      >
                        {item.media ? (
                          <ReportImage
                            media={item.media}
                            alt=""
                            className="h-16 w-20 rounded-sm object-contain"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="grid min-w-0 gap-1">
                          <span className="text-sm font-medium">{item.title}</span>
                          <span className="text-xs text-muted-foreground">Capture {index + 1}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
          {panel === "video" && report.video ? (
            <div className="border-t border-border p-5">
              <ReportVideoInspector
                video={report.video}
                diagnostics={report.diagnostics}
                interval={traceVideoInterval(step, report.video.clock)}
              />
            </div>
          ) : null}
          {panel === "performance" && report.performance?.length ? (
            <RunPerformancePanel
              series={report.performance}
              timeline={report.timeline}
              step={step}
              onSeek={(at) => {
                const matched = performanceStepAt(report.timeline, at);
                const index = matched ? report.timeline.indexOf(matched) : -1;
                if (index >= 0) onSelectStep(index);
              }}
            />
          ) : null}
          {panel === "details" ? (
            <dl className="grid gap-5 px-5 py-4">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Expected</dt>
                <dd className="mt-1 text-sm leading-6">{step.expected}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Observed</dt>
                <dd className="mt-1 text-sm leading-6">
                  {step.observed?.trim() || "No observation was retained for this check."}
                </dd>
              </div>
              {step.state === "failed" && step.log?.trim() && step.log !== step.observed ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Failure details</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{step.log}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </ScrollArea>
        {footer ? (
          <div className="flex shrink-0 justify-end border-t border-border px-4 py-2">{footer}</div>
        ) : null}
      </div>
    </section>
  );
}

function StepMedia({
  frames,
  unlinked = false,
  fill = false,
  actionBounds,
  beforeFramePath,
  controls,
  masks,
}: {
  frames: readonly ReportEvidenceItem[];
  unlinked?: boolean;
  fill?: boolean;
  actionBounds?: Report["timeline"][number]["actionBounds"];
  beforeFramePath?: string;
  controls?: ReactNode;
  masks?: readonly CaptureReviewMask[];
}) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState(() => {
    const after = frames.findIndex((item) => item.phase === "after");
    return after >= 0 ? after : beforeFramePath && frames.length > 1 ? 1 : 0;
  });
  const [failed, setFailed] = useState(false);
  const frame = frames[selected] ?? frames[0];
  return (
    <div
      className={`relay-evidence-image-frame overflow-hidden bg-transparent ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}
    >
      <div
        onLoadCapture={(event) => {
          const img = event.target;
          if (img instanceof HTMLImageElement)
            setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
        }}
        className={`relative flex items-center justify-center p-5 ${fill ? "min-h-0 flex-1" : "min-h-64"}`}
      >
        {actionBounds && frame?.id === beforeFramePath && imageSize.width > 0 ? (
          <svg
            aria-label="Recorded tap target"
            className="pointer-events-none absolute inset-5 z-10 h-[calc(100%-2.5rem)] w-[calc(100%-2.5rem)]"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              {...actionBounds}
              fill="#3b82f6"
              fillOpacity=".16"
              stroke="#3b82f6"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              rx="6"
            />
          </svg>
        ) : null}
        {masks?.length && imageSize.width > 0 ? (
          <svg
            aria-label="Review overlays"
            className="pointer-events-none absolute inset-5 z-10 h-[calc(100%-2.5rem)] w-[calc(100%-2.5rem)]"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {masks.map((mask, index) => {
              const normalized = mask.width <= 1 && mask.height <= 1 && mask.x <= 1 && mask.y <= 1;
              return (
                <rect
                  key={`${mask.name ?? "mask"}-${index}`}
                  x={normalized ? mask.x * imageSize.width : mask.x}
                  y={normalized ? mask.y * imageSize.height : mask.y}
                  width={normalized ? mask.width * imageSize.width : mask.width}
                  height={normalized ? mask.height * imageSize.height : mask.height}
                  fill="#d97706"
                  fillOpacity=".2"
                  stroke="#b45309"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}
        {frame?.media && !failed ? (
          <EvidenceImageViewer
            key={frame.id}
            frame={frame}
            className={fill ? "h-full w-full object-contain" : undefined}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="max-w-sm py-10 text-center">
            <ImageOff className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">
              {failed
                ? "Screenshot unavailable"
                : unlinked
                  ? "No saved screenshots"
                  : controls
                    ? "No capture linked to this step"
                    : "No screenshot for this step"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {failed
                ? "The saved image could not be loaded. The step result remains available."
                : unlinked
                  ? "Review the other available evidence below."
                  : controls
                    ? "Other captures are available in this run. View them below."
                    : "This step did not save a screenshot."}
            </p>
            {failed ? (
              <Button size="sm" variant="outline" className="mt-4" onClick={() => setFailed(false)}>
                Retry image
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {frames.length > 1 || controls ? (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5">
          {controls}
          <div className="flex flex-wrap gap-0.5" aria-label="Step screenshots">
            {frames.length > 1
              ? frames.map((item, index) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant={index === selected ? "secondary" : "ghost"}
                    aria-label={`Screenshot ${index + 1}: ${item.title}`}
                    aria-pressed={index === selected}
                    onClick={() => {
                      setSelected(index);
                      setFailed(false);
                    }}
                  >
                    {item.phase
                      ? item.phase === "before"
                        ? "Before"
                        : "After"
                      : beforeFramePath
                        ? item.id === beforeFramePath
                          ? "Before"
                          : frames.length === 2
                            ? "After"
                            : `After ${index}`
                        : index + 1}
                  </Button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function timelineStateLabel(state: Report["timeline"][number]["state"]): string {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
  if (state === "blocked") return "Blocked";
  if (state === "recovered") return "Recovered";
  if (state === "running") return "In progress";
  return "Not reached";
}

function StepActionIcon({ title }: { title: string }) {
  const Icon = /^tap\b/i.test(title)
    ? Hand
    : /^back\b/i.test(title)
      ? ArrowLeft
      : /^observe\b/i.test(title)
        ? Camera
        : /^(wait|pause)\b/i.test(title)
          ? Clock
          : /^(type|input)\b/i.test(title)
            ? Keyboard
            : /^swipe\b/i.test(title)
              ? MoveUpRight
              : Circle;
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}
