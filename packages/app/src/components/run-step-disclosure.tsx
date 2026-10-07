import type { ReportTimelineItem } from "../data/run-report-model";
import { formatDuration } from "./run-report-formatters";

export function runChildStatus(children: readonly ReportTimelineItem[]): string | undefined {
  const failed = children.filter(
    (child) => child.state === "failed" || child.state === "blocked",
  ).length;
  const recovered = children.filter((child) => child.state === "recovered").length;
  return (
    [
      failed ? `${failed} failed internal ${failed === 1 ? "step" : "steps"}` : undefined,
      recovered ? `${recovered} recovered ${recovered === 1 ? "step" : "steps"}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

/** Exact retained engine occurrences, revealed only for the selected authored action. */
export function RunStepDisclosure({
  steps,
  selectedId,
  onSelect,
}: {
  steps: readonly ReportTimelineItem[];
  selectedId?: string;
  onSelect(id: string): void;
}) {
  if (!steps.length)
    return <p className="text-xs text-muted-foreground">This action was not run.</p>;
  const warning = runChildStatus(steps);
  return (
    <details key={steps[0]?.id} open={Boolean(warning)} className="border-t border-border pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2">
        Execution details · {steps.length}
      </summary>
      {warning ? <p className="mb-2 text-xs text-muted-foreground">{warning}</p> : null}
      <ol className="grid list-none gap-1 p-0" aria-label="Execution details">
        {steps.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={item.id === selectedId}
              className="grid min-h-11 w-full gap-1 rounded-md px-2 py-2 text-left text-xs hover:bg-accent/40 aria-pressed:bg-accent/60 focus-visible:outline-2"
              onClick={() => onSelect(item.id)}
            >
              <span className="break-words">{item.title}</span>
              <span className="text-muted-foreground tabular-nums">
                {item.state}
                {item.durationMs === undefined ? "" : ` · ${formatDuration(item.durationMs)}`}
              </span>
            </button>
            {item.id === selectedId && item.log ? (
              <pre className="max-h-48 overflow-auto px-2 py-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">
                {item.log}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
