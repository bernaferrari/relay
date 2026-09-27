/** @jsxImportSource react */
import type { CSSProperties } from "react";
import type { RunState } from "./run-status";

const SEGMENTS: readonly { state: RunState; className: string; label: string }[] = [
  { state: "passed", className: "bg-success", label: "passed" },
  { state: "review", className: "bg-warning", label: "to review" },
  { state: "failed", className: "bg-destructive", label: "failed" },
  { state: "running", className: "bg-brand", label: "running" },
  { state: "not-run", className: "bg-muted-foreground/25", label: "not run" },
];

/** One thin bar: how a group of checks did on their latest run. */
export function ResultsBar({ states }: { states: readonly RunState[] }) {
  const total = states.length || 1;
  const counts = SEGMENTS.map((segment) => ({
    ...segment,
    count: states.filter((state) => state === segment.state).length,
  })).filter((segment) => segment.count > 0);
  const summary = counts.map((segment) => `${segment.count} ${segment.label}`).join(", ");
  return (
    <span className="grid gap-1.5" title={summary}>
      <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {counts.map((segment) => (
          <span
            key={segment.state}
            className={`h-full shrink-0 grow-0 basis-(--share) ${segment.className}`}
            style={{ "--share": `${(segment.count / total) * 100}%` } as CSSProperties}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {summary || "No results yet"}
      </span>
    </span>
  );
}
