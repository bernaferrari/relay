import { RunViewTabs } from "../components/run-view-tabs";
import { TestWorkspace } from "../components/test-workspace";
import { ReportImage } from "../components/report-image";
import { ReferenceCompareLine } from "./reference-compare-dialog";
import { RunNetworkPanel } from "../components/run-network-panel";
import { RunLogPanel } from "../components/run-log-panel";
/** @jsxImportSource react */
import { RunPerformancePanel, performanceStepAt } from "../components/run-performance-panel";
import { traceVideoInterval } from "../data/run-report-media";
import { StepMedia } from "./run-step-media";
import { ReportVideoInspector } from "../components/report-video-inspector";
import { Button } from "@relay/ui-react/components/button";
import { Tabs, TabsContent } from "@relay/ui-react/components/tabs";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Check, Circle, CircleAlert, Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { framePathsForTraceStep, type ProductRunReportOverview } from "../data/run-product-service";
import { CaptureReviewDecisions } from "./capture-review-decisions";
import { CaptureReviewPanel } from "./run-capture-review-panel";
import { timelineStateLabel } from "./run-workbench-presentation";
import {
  type CaptureReviewAction,
  type CaptureReviewItem,
  destIdentityReviewItems,
  captureReviewQueueItemKey,
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
    note?: string;
    expectedReviewVersion?: number;
  }): Promise<void>;
  renderEvidence?(section: Report["evidence"][number]): ReactNode;
}) {
  const [requestedPanel, setRequestedPanel] = useState<
    "steps" | "captures" | "performance" | "details" | "video" | "logs" | "network"
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
  const [previewSource, setPreviewSource] = useState<"steps" | "captures">(
    view === "steps" ? "steps" : report.captureReview?.items.length ? "captures" : "steps",
  );
  const setPanel = (value: typeof requestedPanel) => {
    if (value === "steps" || value === "captures") setPreviewSource(value);
    setRequestedPanel(value);
    onViewChange?.(value);
  };
  const [localCapture, setLocalCapture] = useState(0);
  const [showMasks, setShowMasks] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewInFlight = useRef(false);
  const [reviewedItemKeys, setReviewedItemKeys] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState<string>();
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
  const reviewItems = destIdentityReviewItems(report.captureReview?.items ?? []);
  const destFrameIds = new Set(
    reviewItems.flatMap((item) => (item.framePath ? [item.framePath] : [])),
  );
  const leftoverFrameIds = (() => {
    if (!destFrameIds.size) return new Set<string>();
    const leftover = new Set<string>();
    let seenDest = false;
    for (const item of allFrames) {
      if (destFrameIds.has(item.id)) {
        seenDest = true;
        continue;
      }
      if (seenDest) leftover.add(item.id);
    }
    return leftover;
  })();
  const destFrames = destFrameIds.size
    ? allFrames.filter((item) => destFrameIds.has(item.id))
    : allFrames;
  const listedFrames = leftoverFrameIds.size
    ? allFrames.filter((item) => !leftoverFrameIds.has(item.id))
    : allFrames;
  const reviewMode = reviewItems.length > 0;
  const selectedCapture = Math.min(
    requestedCapture,
    Math.max(0, (reviewMode ? reviewItems.length : listedFrames.length) - 1),
  );
  const selectedReview = reviewItems[selectedCapture];
  const reviewCaptures = async (
    action: CaptureReviewAction,
    items: CaptureReviewItem[],
    note?: string,
  ) => {
    if (!onReviewCapture || reviewInFlight.current) return false;
    reviewInFlight.current = true;
    setReviewBusy(true);
    const saved: string[] = [];
    setReviewedItemKeys([]);
    setReviewError(undefined);
    try {
      for (const item of items) {
        await onReviewCapture({
          captureId: item.captureId,
          action,
          ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
          ...(item.reviewVersion !== undefined
            ? { expectedReviewVersion: item.reviewVersion }
            : {}),
          ...(note ? { note } : {}),
        });
        saved.push(captureReviewQueueItemKey(item));
        setReviewedItemKeys([...saved]);
      }
      return true;
    } catch (error) {
      setReviewError(
        `${saved.length} of ${items.length} decisions saved. ${error instanceof Error ? error.message : "Save was not confirmed. Refresh before retrying."}`,
      );
      return false;
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  };
  const capture = reviewMode
    ? destFrames.find((item) => item.id === selectedReview?.framePath)
    : listedFrames[selectedCapture];
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
  const network = report.evidence.find((section) => section.id === "network");
  const step = report.timeline[selectedStepIndex] ?? report.timeline[0];
  const hasChecks = Boolean(step?.expected?.trim());
  const requestedView = [
    "steps",
    "captures",
    "performance",
    "details",
    "video",
    "logs",
    "network",
  ].includes(view ?? "")
    ? (view as typeof requestedPanel)
    : requestedPanel;
  const panel = requestedView === "details" && !hasChecks ? "steps" : requestedView;
  const showingCapture =
    panel === "captures" || (panel !== "steps" && previewSource === "captures");
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
              {section.summary ? (
                <p className="mt-1 text-sm text-muted-foreground">{section.summary}</p>
              ) : null}
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Run workbench">
      <Tabs
        value={panel}
        onValueChange={(value) =>
          value === "story" ? onViewChange?.("story") : setPanel(value as typeof panel)
        }
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <RunViewTabs report={report} />
        {panel === "network" || panel === "logs" || panel === "performance" ? (
          <TabsContent value={panel} className="flex min-h-0 flex-1 flex-col">
            {panel === "performance" ? (
              <div className="min-h-0 flex-1 overflow-auto">
                {" "}
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
                <div className="px-5 pb-5">
                  <Button size="sm" variant="outline" onClick={() => setPanel("steps")}>
                    View selected step
                  </Button>
                </div>
              </div>
            ) : panel === "network" ? (
              <RunNetworkPanel items={network?.items ?? []} summary={network?.summary} />
            ) : (
              <RunLogPanel logs={logs} />
            )}
          </TabsContent>
        ) : null}
        <div
          className={
            panel === "network" || panel === "logs" || panel === "performance"
              ? "hidden"
              : "flex min-h-0 min-w-0 flex-1"
          }
        >
          <TestWorkspace
            preview={
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-stage">
                <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 px-4 text-xs text-muted-foreground">
                  <span>
                    {showingCapture
                      ? `Screenshot ${selectedCapture + 1} of ${reviewMode ? reviewItems.length : listedFrames.length}`
                      : step.phase === "test"
                        ? `Test step ${report.timeline.slice(0, selectedStepIndex + 1).filter((item) => item.phase === "test").length} of ${report.timeline.filter((item) => item.phase === "test").length}`
                        : `Step ${selectedStepIndex + 1} of ${report.timeline.length}`}
                  </span>
                  <div
                    className="flex shrink-0 items-center gap-1"
                    aria-label={showingCapture ? "Capture navigation" : "Step playback"}
                  >
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={showingCapture ? "Previous screenshot" : "Previous step"}
                      disabled={(showingCapture ? selectedCapture : selectedStepIndex) === 0}
                      onClick={() => {
                        setPlaying(false);
                        if (showingCapture) setSelectedCapture(selectedCapture - 1);
                        else onSelectStep(selectedStepIndex - 1);
                      }}
                    >
                      <ChevronLeft />
                    </Button>
                    {!showingCapture ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => {
                          if (!playing && selectedStepIndex === report.timeline.length - 1)
                            onSelectStep(0);
                          setPlaying(!playing);
                        }}
                        aria-label={playing ? "Pause step playback" : "Play steps"}
                      >
                        {playing ? <Pause /> : <Play />}
                      </Button>
                    ) : null}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={showingCapture ? "Next screenshot" : "Next step"}
                      disabled={
                        showingCapture
                          ? selectedCapture ===
                            (reviewMode ? reviewItems.length : listedFrames.length) - 1
                          : selectedStepIndex === report.timeline.length - 1
                      }
                      onClick={() => {
                        setPlaying(false);
                        if (showingCapture) setSelectedCapture(selectedCapture + 1);
                        else onSelectStep(selectedStepIndex + 1);
                      }}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                  {!showingCapture && failureIndexes.length > 1 ? (
                    <div className="flex items-center gap-1" aria-label="Failure navigation">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Previous failure"
                        disabled={!failureIndexes.some((index) => index < selectedStepIndex)}
                        onClick={() => {
                          setPlaying(false);
                          onSelectStep(
                            failureIndexes.filter((index) => index < selectedStepIndex).at(-1)!,
                          );
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
                </div>
                <StepMedia
                  key={`${report.runId}:${showingCapture ? capture?.id : step.id}`}
                  frames={showingCapture ? (capture ? [capture] : []) : actionFrames}
                  masks={
                    showingCapture && showMasks && selectedReview?.masks?.length
                      ? selectedReview.masks
                      : undefined
                  }
                  controls={
                    !showingCapture && !actionFrames.length && listedFrames.length ? (
                      <Button size="sm" variant="ghost" onClick={() => setPanel("captures")}>
                        View all captures ({listedFrames.length})
                      </Button>
                    ) : undefined
                  }
                  unlinked={showingCapture}
                  actionBounds={showingCapture ? undefined : step.actionBounds}
                  beforeFramePath={showingCapture ? undefined : step.beforeFramePath}
                  fill
                  reviewControlsForFrame={(frame) => {
                    const matches = frame
                      ? reviewItems.filter(
                          (item) => item.framePath === frame.id && item.status !== "missing",
                        )
                      : [];
                    const item =
                      showingCapture && selectedReview && matches.includes(selectedReview)
                        ? selectedReview
                        : matches.length === 1
                          ? matches[0]
                          : undefined;
                    if (!item || !onReviewCapture)
                      return (
                        <div className="flex min-h-10 flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {showingCapture
                                ? frame
                                  ? "Saved screenshot"
                                  : "Capture unavailable"
                                : "Step result"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {showingCapture
                                ? frame
                                  ? "Saved with this run"
                                  : "This screenshot is unavailable."
                                : `${timelineStateLabel(step.state)}${step.durationMs === undefined ? "" : ` · ${(step.durationMs / 1000).toFixed(1)}s`}`}
                            </p>
                          </div>
                          {!showingCapture && reviewMode ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-10"
                              onClick={() => setPanel("captures")}
                            >
                              Review screenshots
                            </Button>
                          ) : null}
                        </div>
                      );
                    return (
                      <div className="grid w-full gap-2">
                        {reviewError ? (
                          <p
                            role="alert"
                            className="rounded-lg bg-card px-3 py-2 text-sm text-destructive"
                          >
                            {reviewError}
                          </p>
                        ) : null}
                        <ReferenceCompareLine runId={report.runId} item={item} />
                        <CaptureReviewDecisions
                          status={
                            item.status === "accepted"
                              ? "Marked as correct"
                              : item.status === "issue"
                                ? "Issue reported"
                                : item.status === "need-more-evidence"
                                  ? "More evidence requested"
                                  : "Awaiting your decision"
                          }
                          busy={reviewBusy}
                          onReview={(action, reviewNote) =>
                            reviewCaptures(action, [item], reviewNote)
                          }
                        />
                      </div>
                    );
                  }}
                />
              </div>
            }
            outline={
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
                <TabsContent value={panel} className="flex min-h-0 flex-1 flex-col">
                  {panel === "steps" ? (
                    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
                      <ScrollArea
                        className="min-h-0 flex-1"
                        viewportProps={{
                          "aria-label": "Recorded steps",
                          className: "overscroll-auto",
                        }}
                      >
                        {setupCount && setupCount < report.timeline.length ? (
                          <button
                            type="button"
                            className="mx-2 mt-2 flex min-h-10 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2"
                            aria-expanded={setupVisible}
                            onClick={() => {
                              setShowSetup(!setupVisible);
                              if (
                                setupVisible &&
                                report.timeline[selectedStepIndex]?.phase === "setup"
                              )
                                onSelectStep(
                                  report.timeline.findIndex((item) => item.phase !== "setup"),
                                );
                            }}
                          >
                            {setupVisible ? "Hide setup" : "Show setup"}
                            <span className="tabular-nums">{setupCount} steps</span>
                          </button>
                        ) : null}
                        <ol
                          data-slot="test-readable-steps"
                          className="grid list-none gap-1 p-2 pb-4"
                        >
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
                                  className={`relative grid min-h-12 w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${index === selectedStepIndex ? "bg-accent text-foreground ring-1 ring-inset ring-border" : "text-muted-foreground"}`}
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
                                          ? visibleIndexes[
                                              Math.max(0, visibleIndexes.indexOf(index) - 1)
                                            ]
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
                                      <span>{item.title}</span>
                                    </strong>
                                    <span className="sr-only">
                                      {timelineStateLabel(item.state)}
                                    </span>
                                  </span>
                                  <Icon
                                    aria-hidden="true"
                                    className={`size-4 ${item.state === "failed" ? "text-destructive" : item.state === "passed" ? "text-success-foreground" : ""}`}
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
                  <ScrollArea
                    className={panel === "steps" ? "hidden" : "min-h-0 flex-1"}
                    viewportProps={{ "aria-label": "Step report", className: "overscroll-auto" }}
                  >
                    {panel === "captures" ? (
                      reviewMode && report.captureReview ? (
                        <CaptureReviewPanel
                          queue={{ ...report.captureReview, items: reviewItems }}
                          showImage={false}
                          fallbackTitle={report.title}
                          frames={destFrames}
                          selectedIndex={selectedCapture}
                          onSelect={setSelectedCapture}
                          busy={reviewBusy}
                          reviewedItemKeys={reviewedItemKeys}
                          onReviewMany={
                            onReviewCapture
                              ? (action, items, note) => reviewCaptures(action, items, note)
                              : undefined
                          }
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
                        />
                      ) : (
                        <div className="p-2">
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            All screenshots saved during this run.
                          </p>
                          <ul className="grid list-none gap-1">
                            {listedFrames.map((item, index) => (
                              <li key={item.id}>
                                <button
                                  type="button"
                                  aria-pressed={index === selectedCapture}
                                  className={`flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-md p-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${index === selectedCapture ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
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
                                    <span className="text-xs text-foreground">
                                      Capture {index + 1}
                                    </span>
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
                        {step.state === "failed" &&
                        step.log?.trim() &&
                        step.log !== step.observed ? (
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground">
                              Failure details
                            </dt>
                            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">
                              {step.log}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}
                  </ScrollArea>
                </TabsContent>
                {footer ? (
                  <div className="flex shrink-0 justify-end border-t border-border px-4 py-2">
                    {footer}
                  </div>
                ) : null}
              </div>
            }
          />
        </div>
      </Tabs>
    </section>
  );
}
