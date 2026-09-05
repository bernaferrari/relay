/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Check, Circle, CircleAlert, ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  framePathsForTraceStep,
  type ProductRunReportOverview,
  type ReportEvidenceItem,
} from "../data/run-product-service";

type Report = ProductRunReportOverview;

export function RunWorkbench({
  report,
  selectedStepIndex,
  onSelectStep,
}: {
  report: Report;
  selectedStepIndex: number;
  onSelectStep(index: number): void;
  renderEvidence?(section: Report["evidence"][number]): ReactNode;
}) {
  const step = report.timeline[selectedStepIndex] ?? report.timeline[0];
  const authoredFrames = framePathsForTraceStep(
    report.stepEvidence,
    step?.index ?? selectedStepIndex,
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
  if (!step) return null;
  return (
    <section
      className="grid min-w-0 overflow-hidden rounded-xl border border-border bg-card min-[721px]:grid-cols-[12rem_minmax(0,1fr)] min-[1280px]:grid-cols-[16rem_minmax(0,1fr)]"
      aria-label="Run workbench"
    >
      <aside className="min-w-0 border-b border-border bg-muted/20 min-[721px]:border-r min-[721px]:border-b-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Steps</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {report.timeline.length}
          </span>
        </div>
        <ol className="relay-test-readable-steps max-h-40 overflow-y-auto p-2 min-[721px]:max-h-[36rem]">
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
                  className={`grid min-h-16 w-full grid-cols-[1rem_minmax(0,1fr)_1rem] items-start gap-2 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${index === selectedStepIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"}`}
                  onClick={() => onSelectStep(index)}
                >
                  <span className="pt-0.5 text-xs tabular-nums">{index + 1}</span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-medium leading-5">{item.title}</strong>
                    <span className="mt-1 block text-xs">{timelineStateLabel(item.state)}</span>
                  </span>
                  <Icon
                    aria-hidden="true"
                    className={`mt-0.5 size-4 ${item.state === "failed" ? "text-[var(--text-critical-base)]" : item.state === "passed" ? "text-[var(--text-success-base)]" : ""}`}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Step {selectedStepIndex + 1}</p>
            <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
          </div>
          <span className="text-xs text-muted-foreground">{timelineStateLabel(step.state)}</span>
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
        </header>
        <StepMedia key={`${report.runId}:${step.id}`} frames={frames} />
        <dl className="grid gap-5 border-t border-border px-5 py-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Expected</dt>
            <dd className="mt-1 text-sm leading-6">
              {step.expected ?? "No saved expectation is available for this step."}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Observed</dt>
            <dd className="mt-1 text-sm leading-6">
              {step.observed ?? timelineStateLabel(step.state)}
              {step.durationMs === undefined ? "" : ` · ${(step.durationMs / 1000).toFixed(1)}s`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Trace interval</dt>
            <dd className="mt-1 text-sm leading-6">
              {formatTraceInterval(step.startedAt, step.finishedAt)}
            </dd>
          </div>
          {step.log ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Run log</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{step.log}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

function formatTraceInterval(startedAt?: number, finishedAt?: number): string {
  if (startedAt === undefined && finishedAt === undefined) return "Not recorded";
  const start = startedAt === undefined ? "Unknown start" : new Date(startedAt).toISOString();
  const end = finishedAt === undefined ? "Unknown end" : new Date(finishedAt).toISOString();
  return `${start} → ${end}`;
}

function StepMedia({ frames }: { frames: readonly ReportEvidenceItem[] }) {
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState(false);
  const frame = frames[selected] ?? frames[0];
  return (
    <div className="relay-evidence-image-frame overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-h-64 items-center justify-center bg-muted/30 p-5">
        {frame?.media && !failed ? (
          <img
            src={frame.media.src}
            alt={frame.title}
            width={frame.media.width}
            height={frame.media.height}
            className="max-h-72 w-full max-w-full rounded-md border border-border bg-background object-contain shadow-sm"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="max-w-sm py-10 text-center">
            <ImageOff className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">
              {failed ? "Screenshot unavailable" : "No screenshot for this step"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {failed
                ? "The saved image could not be loaded. The step result remains available."
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
      {frames.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">{frame?.title}</p>
          <div className="flex flex-wrap gap-1" aria-label="Step screenshots">
            {frames.map((item, index) => (
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
                {index + 1}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function timelineStateLabel(state: Report["timeline"][number]["state"]): string {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
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
    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-y border-border py-3">
      {(compact ? facts.slice(0, 2) : facts).map(([label, value]) => (
        <div key={label} className="min-w-0 max-w-full">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 break-all text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
