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
  if (!series.length)
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No numeric performance samples were retained for this run.
      </p>
    );
  return (
    <section className="grid gap-4 border-t border-border p-5" aria-label="Performance timeline">
      <div>
        <h3 className="text-sm font-medium">Performance</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a sample to inspect its recorded step.
        </p>
      </div>
      {series.map((metric) => {
        const first = metric.points[0]!.at;
        const last = metric.points.at(-1)!.at;
        const peak = Math.max(...metric.points.map((p) => p.value));
        const low = Math.min(0, ...metric.points.map((p) => p.value));
        const x = (at: number) =>
          Math.max(0, Math.min(600, ((at - first) / Math.max(1, last - first)) * 600));
        const y = (value: number) => 64 - ((value - low) / Math.max(1, peak - low)) * 56;
        return (
          <div key={metric.name} className="min-w-0 rounded-lg bg-muted/40 p-3">
            <div className="mb-2 flex justify-between gap-4 text-xs">
              <span className="font-medium">{metric.name}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                Peak {peak.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <svg
              viewBox="0 0 600 72"
              className="h-20 w-full overflow-visible"
              role="img"
              aria-label={`${metric.name}, ${metric.points.length} recorded samples`}
            >
              {step?.startedAt !== undefined && step.finishedAt !== undefined ? (
                <rect
                  x={x(step.startedAt)}
                  y="0"
                  width={Math.max(0, x(step.finishedAt) - x(step.startedAt))}
                  height="72"
                  fill="currentColor"
                  opacity=".07"
                />
              ) : null}
              <polyline
                points={metric.points.map((p) => `${x(p.at)},${y(p.value)}`).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              {metric.points.map((point, index) => (
                <circle
                  key={`${point.at}:${index}`}
                  cx={x(point.at)}
                  cy={y(point.value)}
                  r="4"
                  fill="currentColor"
                >
                  <title>{`${metric.name}: ${point.value} at ${new Date(point.at).toLocaleTimeString()}`}</title>
                </circle>
              ))}
            </svg>
            <input
              type="range"
              className="mt-2 h-5 w-full accent-current"
              aria-label={`Inspect ${metric.name} sample`}
              min={0}
              max={Math.max(0, metric.points.length - 1)}
              defaultValue={0}
              disabled={metric.points.length < 2}
              onChange={(event) => onSeek(metric.points[Number(event.currentTarget.value)]!.at)}
            />
            <div className="flex justify-between font-mono text-xs tabular-nums text-muted-foreground">
              <span>{new Date(first).toLocaleTimeString()}</span>
              <span>{new Date(last).toLocaleTimeString()}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
