/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { runStateDot, runStateLabel, type RunState } from "../components/run-status";

const SUMMARY_ORDER: readonly RunState[] = [
  "failed",
  "review",
  "running",
  "passed",
  "cancelled",
  "not-run",
];

/** One glance: a health bar, then only the counts that matter. */
export function PlanResultSummary({ states }: { states: readonly RunState[] }) {
  const counts = new Map<RunState, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  const ordered = SUMMARY_ORDER.filter((state) => counts.has(state));
  const description = ordered
    .map((state) => `${counts.get(state)} ${runStateLabel(state).toLowerCase()}`)
    .join(", ");
  if (!states.length) return null;
  // A bar with nothing in it reads as broken; say it plainly instead.
  if (ordered.length === 1 && ordered[0] === "not-run")
    return (
      <span className="text-xs text-muted-foreground" title={description}>
        Not run yet
      </span>
    );
  return (
    <span className="grid gap-1.5" title={description} aria-label={description}>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {ordered.map((state) => (
          <span
            key={state}
            className={`grow-(--share) ${runStateDot(state)}`}
            style={{ "--share": counts.get(state) } as CSSProperties}
          />
        ))}
      </span>
      <span className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        {ordered
          .filter((state) => state !== "not-run" && state !== "cancelled")
          .map((state) => (
            <span key={state} className="inline-flex items-center gap-1 tabular-nums">
              <span className={`size-1.5 rounded-full ${runStateDot(state)}`} />
              {counts.get(state)}{" "}
              {state === "review" ? "to review" : runStateLabel(state).toLowerCase()}
            </span>
          ))}
        {counts.has("not-run") ? (
          <span className="tabular-nums">{counts.get("not-run")} not run</span>
        ) : null}
      </span>
    </span>
  );
}
