import { useState } from "react";
import type { ReportPerformanceSeries, ReportTimelineItem } from "../data/run-report-model";

export function RunPerformancePanel({
  series,
  step,
  onSeek,
}: {
  series: readonly ReportPerformanceSeries[];
  step?: ReportTimelineItem;
  onSeek(at: number): void;
}) {
  const available = series.filter((metric) => metric.points.length);
  const [metricName, setMetricName] = useState("");
  const [selectedAt, setSelectedAt] = useState<number>();
  const metric =
    available.find((item) => item.name === metricName) ??
    available.find((item) => /cpu/i.test(item.name)) ??
    available[0];
  if (!metric) return null;
  const first = metric.points[0]!.at;
  const last = metric.points.at(-1)!.at;
  const peak = Math.max(...metric.points.map((point) => point.value));
  const low = Math.min(0, ...metric.points.map((point) => point.value));
  const selected = metric.points.find((point) => point.at === selectedAt);
  const x = (at: number) =>
    16 + Math.max(0, Math.min(568, ((at - first) / Math.max(1, last - first)) * 568));
  const y = (value: number) => 108 - ((value - low) / Math.max(1, peak - low)) * 92;
  const inspect = (index: number) => {
    const point = metric.points[index]!;
    setSelectedAt(point.at);
    onSeek(point.at);
  };
  return (
    <section className="space-y-3 border-t border-border p-5" aria-label="Performance timeline">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Performance</h3>
        <select
          aria-label="Performance metric"
          className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs"
          value={metric.name}
          onChange={(event) => {
            setMetricName(event.target.value);
            setSelectedAt(undefined);
          }}
        >
          {available.map((item) => (
            <option key={item.name} value={item.name}>
              {metricLabel(item.name)}
            </option>
          ))}
        </select>
      </header>
      <div className="flex min-h-5 items-center justify-between gap-3 text-xs tabular-nums">
        <span className="text-muted-foreground">
          {selected
            ? `At +${((selected.at - first) / 1000).toFixed(1)} s`
            : "Select a point to view its step"}
        </span>
        <span className="font-mono">
          {selected ? selected.value.toLocaleString() : `Peak ${peak.toLocaleString()}`}
        </span>
      </div>
      <svg
        viewBox="0 0 600 124"
        className="h-36 w-full overflow-visible"
        aria-label={`${metricLabel(metric.name)}, ${metric.points.length} samples`}
      >
        {[16, 62, 108].map((line) => (
          <line
            key={line}
            x1="16"
            x2="584"
            y1={line}
            y2={line}
            stroke="currentColor"
            opacity=".08"
          />
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
        <polyline
          points={metric.points.map((point) => `${x(point.at)},${y(point.value)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
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
      </svg>
      <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>0:00</span>
        <span>
          {Math.floor((last - first) / 60000)}:
          {String(Math.floor((last - first) / 1000) % 60).padStart(2, "0")}
        </span>
      </div>
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
