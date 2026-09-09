import { Button } from "@relay/ui-react/components/button";
import { useState } from "react";
import type { ReportPerformanceSeries, ReportTimelineItem } from "../data/run-report-model";

export function RunPerformancePanel({
  series,
  step,
  timeline = [],
  onSeek,
}: {
  series: readonly ReportPerformanceSeries[];
  step?: ReportTimelineItem;
  timeline?: readonly ReportTimelineItem[];
  onSeek(at: number): void;
}) {
  const available = series.filter(
    (metric) => metric.points.length && !/^Startup sample Count$/i.test(metric.name),
  );
  const [showAll, setShowAll] = useState(false);
  const [metricName, setMetricName] = useState("");
  const [selectedAt, setSelectedAt] = useState<number>();
  const metric =
    available.find((item) => item.name === metricName) ??
    available.find((item) => /cpu/i.test(item.name)) ??
    available[0];
  if (!metric) return null;
  const isStartup = /^Startup last Duration Ms$/i.test(metric.name);
  const first = Math.min(
    metric.points[0]!.at,
    ...timeline.flatMap((item) => (item.startedAt === undefined ? [] : [item.startedAt])),
  );
  const last = Math.max(
    metric.points.at(-1)!.at,
    ...timeline.flatMap((item) => (item.finishedAt === undefined ? [] : [item.finishedAt])),
  );
  const peak = Math.max(...metric.points.map((point) => point.value));
  const low = Math.min(0, ...metric.points.map((point) => point.value));
  const ceiling = peak > low ? peak : low + 1;
  const primary = available.filter((item) =>
    /cpu|rss|dropped frames \(%\)|total frame count/i.test(item.name),
  );
  const visibleMetrics = showAll || !primary.length ? available : primary;
  const selectedStep =
    selectedAt === undefined ? undefined : performanceStepAt(timeline, selectedAt);
  const exactStep =
    selectedStep?.startedAt !== undefined &&
    selectedStep.finishedAt !== undefined &&
    selectedAt! >= selectedStep.startedAt &&
    selectedAt! <= selectedStep.finishedAt;
  const selected = metric.points.find((point) => point.at === selectedAt);
  const x = (at: number) =>
    44 + Math.max(0, Math.min(540, ((at - first) / Math.max(1, last - first)) * 540));
  const y = (value: number) => 108 - ((value - low) / (ceiling - low)) * 92;
  const inspect = (index: number) => {
    const point = metric.points[index]!;
    setSelectedAt(point.at);
    onSeek(point.at);
  };
  return (
    <section className="space-y-4 p-5" aria-label="Performance timeline">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Performance</h3>
        <span className="text-xs text-muted-foreground">
          {isStartup ? "Launch measurement" : `${metric.points.length} samples`}
        </span>
      </header>
      <div className="flex flex-wrap gap-1" aria-label="Performance metric">
        {visibleMetrics.map((item) => (
          <Button
            key={item.name}
            size="sm"
            variant={item.name === metric.name ? "secondary" : "ghost"}
            aria-pressed={item.name === metric.name}
            onClick={() => {
              setMetricName(item.name);
              setSelectedAt(undefined);
            }}
          >
            {metricLabel(item.name)}
          </Button>
        ))}
        {primary.length > 0 && primary.length < available.length ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
          >
            {showAll ? "Fewer metrics" : "More metrics"}
          </Button>
        ) : null}
      </div>
      {!isStartup ? (
        <div className="flex min-h-5 items-center justify-between gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground">
            {selected
              ? `At +${((selected.at - first) / 1000).toFixed(1)} s`
              : "Select a sample to inspect"}
          </span>
          <span className="font-mono">
            {selected ? selected.value.toLocaleString() : `Peak ${peak.toLocaleString()}`}
          </span>
        </div>
      ) : null}
      {isStartup ? (
        <div className="py-5">
          <p className="text-xs text-muted-foreground">Recorded app launch duration</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {(metric.points[0]!.value / 1000).toFixed(2)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">s</span>
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Time taken by the app launch command. This does not measure when the first screen became
            interactive.
          </p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => inspect(0)}>
            View recorded moment
          </Button>
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 600 180"
            className="block h-auto w-full overflow-visible"
            aria-label={`${metricLabel(metric.name)}, ${isStartup ? "Launch measurement" : `${metric.points.length} samples`}`}
          >
            {[16, 62, 108].map((line, index) => (
              <g key={line}>
                <text
                  x="36"
                  y={line + 3}
                  textAnchor="end"
                  fill="currentColor"
                  className="text-[9px] text-muted-foreground"
                >
                  {(low + (ceiling - low) * (1 - index / 2)).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}
                </text>
                <line
                  key={line}
                  x1="44"
                  x2="584"
                  y1={line}
                  y2={line}
                  stroke="currentColor"
                  opacity=".12"
                />
              </g>
            ))}
            {step?.startedAt !== undefined && step.finishedAt !== undefined ? (
              <rect
                x={x(step.startedAt)}
                y="8"
                width={Math.max(0, x(step.finishedAt) - x(step.startedAt))}
                height="108"
                fill="currentColor"
                opacity=".06"
              />
            ) : null}
            <polygon
              points={`44,108 ${metric.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")} 584,108`}
              fill="currentColor"
              opacity=".08"
              className="text-[var(--text-info-base)]"
            />
            <polyline
              points={metric.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              className="text-[var(--text-info-base)]"
            />
            {selectedAt !== undefined ? (
              <line
                x1={x(selectedAt)}
                x2={x(selectedAt)}
                y1="8"
                y2="116"
                stroke="currentColor"
                strokeDasharray="3 3"
                opacity=".5"
              />
            ) : null}
            {metric.points.map((point, index) => (
              <g
                key={`${point.at}:${index}`}
                role="button"
                tabIndex={0}
                aria-label={`${metricLabel(metric.name)}: ${point.value}, ${((point.at - first) / 1000).toFixed(1)} seconds into samples`}
                aria-pressed={selectedAt === point.at}
                className="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-ring [&:focus-visible>circle:last-child]:stroke-[3]"
                onClick={() => inspect(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inspect(index);
                  }
                }}
              >
                <circle cx={x(point.at)} cy={y(point.value)} r="12" fill="transparent" />
                <circle
                  cx={x(point.at)}
                  cy={y(point.value)}
                  r={selectedAt === point.at ? 5 : 3}
                  fill="currentColor"
                />
              </g>
            ))}
            <g aria-label="Steps on performance timeline">
              {timeline.map((item, index) =>
                item.startedAt === undefined || item.finishedAt === undefined ? null : (
                  <g
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Show step ${index + 1}: ${item.title}`}
                    aria-pressed={step?.id === item.id}
                    className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring"
                    onClick={() => {
                      setSelectedAt(undefined);
                      onSeek(item.startedAt! + Math.max(0, item.finishedAt! - item.startedAt!) / 2);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedAt(undefined);
                        onSeek(
                          item.startedAt! + Math.max(0, item.finishedAt! - item.startedAt!) / 2,
                        );
                      }
                    }}
                  >
                    <title>{`Step ${index + 1}: ${item.title}`}</title>
                    <line
                      x1={x(item.startedAt)}
                      x2={x(item.startedAt)}
                      y1="8"
                      y2={index % 2 ? 154 : 134}
                      stroke="currentColor"
                      opacity={step?.id === item.id ? ".45" : ".12"}
                      strokeDasharray="2 3"
                    />
                    <rect
                      x={x(item.startedAt) - 9}
                      y={index % 2 ? 154 : 134}
                      width="18"
                      height="18"
                      rx="4"
                      fill="currentColor"
                      opacity={step?.id === item.id ? ".2" : ".06"}
                    />
                    <text
                      x={x(item.startedAt)}
                      y={index % 2 ? 167 : 147}
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize="10"
                    >
                      {index + 1}
                    </text>
                  </g>
                ),
              )}
            </g>
            <text
              x="44"
              y="121"
              textAnchor="start"
              fill="currentColor"
              className="text-[10px] text-muted-foreground"
            >
              0:00
            </text>
            <text
              x="584"
              y="121"
              textAnchor="end"
              fill="currentColor"
              className="text-[10px] text-muted-foreground"
            >
              {Math.floor((last - first) / 60000)}:
              {String(Math.floor((last - first) / 1000) % 60).padStart(2, "0")}
            </text>
          </svg>
        </>
      )}
      {selected ? (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          {selectedStep
            ? exactStep
              ? "Showing the step’s saved screenshot, not an exact frame at the sample time."
              : "Showing the nearest recorded step; no exact step interval was retained for this sample."
            : "No timed step was retained for this sample. The preview has not changed."}
        </p>
      ) : null}
    </section>
  );
}

function metricLabel(name: string): string {
  return name
    .replace(/^Fps total Frame Count$/i, "Frames rendered")
    .replace(/^Fps dropped Frame Count$/i, "Dropped frames")
    .replace(/^Fps sample Window Ms$/i, "Frame sample interval (ms)")
    .replace(/^Fps frame Deadline Ms$/i, "Frame deadline (ms)")
    .replace(/^Fps refresh Rate Hz$/i, "Refresh rate (Hz)")
    .replace(/^Startup last Duration Ms$/i, "App startup (ms)")
    .replace(/^Startup sample Count$/i, "Startup samples");
}

// Sparse traces may retain only a step timestamp. Identify the nearest saved
// step explicitly instead of implying an exact sample-to-frame correlation.
export function performanceStepAt(timeline: readonly ReportTimelineItem[], at: number) {
  const timed = timeline.filter(
    (item) => item.startedAt !== undefined && item.finishedAt !== undefined,
  );
  return (
    timed.find((item) => at >= item.startedAt! && at <= item.finishedAt!) ??
    timed.reduce<ReportTimelineItem | undefined>((nearest, item) => {
      const distance = (candidate: ReportTimelineItem) =>
        Math.min(Math.abs(at - candidate.startedAt!), Math.abs(at - candidate.finishedAt!));
      return !nearest || distance(item) < distance(nearest) ? item : nearest;
    }, undefined)
  );
}
