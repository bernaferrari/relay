/** @jsxImportSource react */
import type { AppMapObserved, AppMapObservedStatus } from "@relay/protocol";

const STATUS: Record<AppMapObservedStatus, { label: string; className: string }> = {
  passing: { label: "Passing in the latest run", className: "bg-success" },
  failing: { label: "The latest run failed here", className: "bg-destructive" },
  seen: { label: "Reached by runs", className: "bg-warning" },
  untested: { label: "No recent run reached this screen", className: "bg-muted-foreground/40" },
  new: { label: "New: found by a run, not on the map yet", className: "bg-brand" },
};

export function mapStatusLabel(status: AppMapObservedStatus): string {
  return STATUS[status].label;
}

/** A small colored dot next to a screen title; nothing when there is no run data. */
export function MapStatusDot({ status }: { status: AppMapObservedStatus | undefined }) {
  if (!status) return null;
  const { label, className } = STATUS[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-status={status}
      className={`mr-1.5 mb-1 inline-block size-2 shrink-0 self-end rounded-full ${className}`}
    />
  );
}

/** "12 screens · 9 reached by recent runs · 2 failing · 3 new" in one line. */
export function mapCoverageLine(observed: AppMapObserved | undefined): string | undefined {
  if (!observed) return undefined;
  const { known, tested, failing, new: fresh } = observed.summary;
  if (!known && !fresh) return undefined;
  return [
    `${known} ${known === 1 ? "screen" : "screens"}`,
    `${tested} reached by recent runs`,
    ...(failing ? [`${failing} failing`] : []),
    ...(fresh ? [`${fresh} new`] : []),
  ].join(" · ");
}
