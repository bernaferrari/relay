/** @jsxImportSource react */
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Eye, LoaderCircle } from "lucide-react";

/** The six states a person acts on. Every surface speaks this vocabulary. */
export type RunState = "passed" | "review" | "failed" | "running" | "not-run" | "cancelled";

type RunLike = {
  phase?: string;
  outcome?: string;
  captureSummary?: { pending?: number; issue?: number } | undefined;
};

export function runStateOf(run: RunLike | undefined): RunState {
  if (!run) return "not-run";
  if (run.phase === "queued" || run.phase === "running") return "running";
  if (run.outcome === "cancelled" || run.phase === "cancelled") return "cancelled";
  if (
    run.phase === "failed" ||
    run.outcome === "failed" ||
    run.outcome === "product-failure" ||
    run.outcome === "harness-failure" ||
    (run.captureSummary?.issue ?? 0) > 0
  )
    return "failed";
  if ((run.captureSummary?.pending ?? 0) > 0 || run.outcome === "uncertain") return "review";
  return "passed";
}

const PRESENTATION: Record<
  RunState,
  { label: string; icon: typeof CircleCheck; pill: string; dot: string }
> = {
  passed: {
    label: "Passed",
    icon: CircleCheck,
    pill: "bg-success/12 text-success-foreground",
    dot: "bg-success",
  },
  review: {
    label: "Needs review",
    icon: Eye,
    pill: "bg-warning/15 text-warning-foreground",
    dot: "bg-warning",
  },
  failed: {
    label: "Failed",
    icon: CircleX,
    pill: "bg-destructive/12 text-destructive",
    dot: "bg-destructive",
  },
  running: {
    label: "Running",
    icon: LoaderCircle,
    pill: "bg-brand-soft text-brand",
    dot: "bg-brand",
  },
  "not-run": {
    label: "Not run yet",
    icon: CircleDashed,
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
  cancelled: {
    label: "Cancelled",
    icon: CircleMinus,
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

export function runStateLabel(state: RunState): string {
  return PRESENTATION[state].label;
}

export function StatusPill({
  state,
  label,
  size = "sm",
}: {
  state: RunState;
  label?: string;
  size?: "sm" | "md";
}) {
  const presentation = PRESENTATION[state];
  const Icon = presentation.icon;
  return (
    <span
      data-slot="status-pill"
      data-state={state}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap ${
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-xs"
      } ${presentation.pill}`}
    >
      <Icon
        className={`size-3.5 ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      {label ?? presentation.label}
    </span>
  );
}

/** Compact state for dense rows; the label stays available to assistive tech. */
export function StatusDot({ state }: { state: RunState }) {
  const presentation = PRESENTATION[state];
  return (
    <span className="relative inline-flex size-2.5 shrink-0" title={presentation.label}>
      {state === "running" ? (
        <span
          aria-hidden="true"
          className={`absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none ${presentation.dot}`}
        />
      ) : null}
      <span className={`relative size-2.5 rounded-full ${presentation.dot}`} />
      <span className="sr-only">{presentation.label}</span>
    </span>
  );
}
