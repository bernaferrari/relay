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

type Report = ProductRunReportOverview;

export function RunWorkbench({
  report,
  selectedStepIndex,
  failureNotice,
  onSelectStep,
}: {
  report: Report;
  selectedStepIndex: number;
  failureNotice?: ReactNode;
  onSelectStep(index: number): void;
  renderEvidence?(section: Report["evidence"][number]): ReactNode;
}) {
  const [requestedPanel, setPanel] = useState<
    "steps" | "performance" | "details" | "video" | "logs"
  >("steps");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (selectedStepIndex >= report.timeline.length - 1) setPlaying(false);
      else onSelectStep(selectedStepIndex + 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [playing, selectedStepIndex, report.timeline.length, onSelectStep]);
  const logs = report.evidence.find((section) => section.id === "logs")?.items ?? [];
  const step = report.timeline[selectedStepIndex] ?? report.timeline[0];
  const hasChecks = Boolean(step?.expected?.trim());
  const panel = requestedPanel === "details" && !hasChecks ? "steps" : requestedPanel;
  const authoredFrames = framePathsForTraceStep(
    report.stepEvidence,
    step?.id ?? selectedStepIndex,
    step?.index,
  );
  const framePaths = new Set(authoredFrames.length ? authoredFrames : (step?.framePaths ?? []));
  const failureIndexes = report.timeline.flatMap((item, index) =>
    item.state === "failed" ? [index] : [],
  );
  const previousFailure = failureIndexes.filter((index) => index < selectedStepIndex).at(-1);
  const nextFailure = failureIndexes.find((index) => index > selectedStepIndex);
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
      className="grid h-full min-h-0 flex-1 min-w-0 overflow-hidden rounded-xl bg-card max-[720px]:h-auto max-[720px]:grid-rows-[32rem_30rem] min-[721px]:grid-cols-[minmax(0,45%)_minmax(0,1fr)]"
      aria-label="Run workbench"
    >
      <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/40">
        <div className="flex h-11 shrink-0 items-center justify-between px-4 text-xs text-muted-foreground">
          <span>
            Step {selectedStepIndex + 1} of {report.timeline.length}
          </span>
          <span>
            {step.durationMs === undefined
              ? timelineStateLabel(step.state)
              : `${(step.durationMs / 1000).toFixed(1)}s · ${timelineStateLabel(step.state)}`}
          </span>
        </div>
        <StepMedia
          key={`${report.runId}:${step.id}`}
          frames={actionFrames}
          actionBounds={step.actionBounds}
          beforeFramePath={step.beforeFramePath}
          fill
          controls={
            <div className="flex shrink-0 items-center gap-1" aria-label="Step playback">
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
          }
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        {panel !== "steps" ? (
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Step {selectedStepIndex + 1} · {timelineStateLabel(step.state)}
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-base font-semibold">
                <StepActionIcon title={step.title} />
                {step.title}
              </h2>
            </div>
            {previousFailure !== undefined || nextFailure !== undefined ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Previous failure"
                  disabled={previousFailure === undefined}
                  onClick={() => {
                    if (previousFailure !== undefined) onSelectStep(previousFailure);
                  }}
                >
                  Previous failure
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Next failure"
                  disabled={nextFailure === undefined}
                  onClick={() => {
                    if (nextFailure !== undefined) onSelectStep(nextFailure);
                  }}
                >
                  Next failure
                </Button>
              </div>
            ) : null}
          </header>
        ) : null}
        {panel !== "steps" &&
        step.state === "failed" &&
        selectedStepIndex === failureIndexes.at(-1) &&
        failureNotice ? (
          <div className="shrink-0 px-4 pt-2">{failureNotice}</div>
        ) : null}
        <div
          className="flex shrink-0 gap-1 border-b border-border px-4 py-2"
          aria-label="Step views"
        >
          {(
            [
              ["steps", "Steps"],
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
                  {report.timeline.length}
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
              <ol className="relay-test-readable-steps grid list-none gap-1 p-2 pb-4">
                {report.timeline.map((item, index) => {
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
                        aria-current={index === selectedStepIndex ? "step" : undefined}
                        aria-pressed={index === selectedStepIndex}
                        className={`relay-interactive-row relative grid min-h-12 w-full grid-cols-[1rem_minmax(0,1fr)_1rem] items-start gap-2 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${index === selectedStepIndex ? "bg-accent text-foreground ring-1 ring-inset ring-border before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground" : "text-muted-foreground"}`}
                        onClick={() => onSelectStep(index)}
                        onKeyDown={(event) => {
                          const next =
                            event.key === "ArrowDown"
                              ? Math.min(report.timeline.length - 1, index + 1)
                              : event.key === "ArrowUp"
                                ? Math.max(0, index - 1)
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? report.timeline.length - 1
                                    : undefined;
                          if (next === undefined) return;
                          event.preventDefault();
                          onSelectStep(next);
                          const buttons = event.currentTarget
                            .closest("ol")
                            ?.querySelectorAll("button");
                          buttons?.[next]?.focus();
                        }}
                      >
                        <span className="pt-0.5 text-xs tabular-nums">{index + 1}</span>
                        <span className="min-w-0">
                          <strong className="flex items-start gap-2 text-sm font-medium leading-5">
                            <StepActionIcon title={item.title} />
                            <span>{item.title}</span>
                          </strong>
                          <span className="sr-only">{timelineStateLabel(item.state)}</span>
                        </span>
                        <Icon
                          aria-hidden="true"
                          className={`mt-0.5 size-4 ${item.state === "failed" ? "text-[var(--text-critical-base)]" : item.state === "passed" ? "text-[var(--text-success-base)]" : ""}`}
                        />
                      </button>
                      {index === selectedStepIndex &&
                      item.state === "failed" &&
                      index === failureIndexes.at(-1) &&
                      failureNotice ? (
                        <div className="px-3 pb-2 pt-1">{failureNotice}</div>
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
}: {
  frames: readonly ReportEvidenceItem[];
  unlinked?: boolean;
  fill?: boolean;
  actionBounds?: Report["timeline"][number]["actionBounds"];
  beforeFramePath?: string;
  controls?: ReactNode;
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
      className={`relay-evidence-image-frame overflow-hidden bg-card ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}
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
                  : "No screenshot for this step"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {failed
                ? "The saved image could not be loaded. The step result remains available."
                : unlinked
                  ? "Review the other available evidence below."
                  : "This run did not retain a screenshot linked to this step."}
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

export function RunContextFacts({
  report,
  duration,
  compact = false,
}: {
  report: Report;
  duration: string;
  compact?: boolean;
}) {
  const context = report.executionContext;
  const facts = [
    ["Device or browser", report.targetName ?? "Not recorded"],
    ["Duration", duration],
    ["Build", context?.buildId],
    ["App version", context?.appVersion],
    ["Source revision", context?.sourceRevision],
    ["Browser", context?.browser],
    ["Target profile", context?.targetProfileId],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return (
    <dl
      className={`flex flex-wrap gap-x-6 gap-y-3 ${compact ? "" : "mt-4 border-y border-border py-3"}`}
    >
      {(compact ? facts.slice(0, 2) : facts).map(([label, value]) => (
        <div key={label} className="min-w-0 max-w-full">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-all text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
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
  return <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}
