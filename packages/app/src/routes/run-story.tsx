import {
  TestWorkspace,
  TestWorkspaceHeader,
  WorkspaceScreenshot,
} from "../components/test-workspace";
/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import {
  AppWindow,
  Camera,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleX,
  Dot,
  Eye,
  Flag,
  Keyboard,
  ListChecks,
  LoaderCircle,
  MousePointerClick,
  MoveVertical,
  Timer,
} from "lucide-react";
import {
  decidedByReference,
  type CaptureReviewAction,
  type CaptureReviewItem,
} from "@relay/protocol";
import {
  formatDuration,
  type StoryAction,
  type StoryActionKind,
  type StoryState,
  type StoryStep,
} from "../data/run-story";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";
import { ReferenceCompareLine } from "./reference-compare-dialog";
import { StatusPill, type RunState } from "../components/run-status";

export type RunStoryStatus = "running" | "passed" | "review" | "failed" | "cancelled";

const ACTION_ICON: Record<StoryActionKind, typeof Dot> = {
  tap: MousePointerClick,
  type: Keyboard,
  verify: Eye,
  screenshot: Camera,
  wait: Timer,
  scroll: MoveVertical,
  open: AppWindow,
  check: ListChecks,
  other: Dot,
};

const PILL: Record<RunStoryStatus, RunState> = {
  running: "running",
  passed: "passed",
  review: "review",
  failed: "failed",
  cancelled: "cancelled",
};

function StateMark({ state }: { state: StoryState }) {
  if (state === "passed")
    return <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />;
  if (state === "failed")
    return <CircleX className="size-4 shrink-0 text-destructive" aria-label="Failed" />;
  if (state === "running")
    return (
      <LoaderCircle
        className="size-4 shrink-0 animate-spin text-info motion-reduce:animate-none"
        aria-label="Running"
      />
    );
  return <Circle className="size-4 shrink-0 text-muted-foreground/60" aria-label="Waiting" />;
}

function useBlobUrl(blob?: Blob): string | undefined {
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return setImage(undefined);
    const next = URL.createObjectURL(blob);
    setImage({ blob, url: next });
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return image?.blob === blob ? image?.url : undefined;
}

export function RunStoryView({
  header,
  embedded = false,
  livePreview,
  outlineHeader,
  status,
  title,
  meta,
  steps,
  loadFrame,
  frameSource,
  latestFrame,
  captures,
  onReview,
  actions,
  footer,
  runId,
  finishedAt,
  crumbs,
  summary,
  notice,
  navigation,
}: {
  header?: ReactNode;
  embedded?: boolean;
  /** Passive live pixels, with the current captured frame as an honest fallback. */
  livePreview?(fallback?: ReactNode): ReactNode;
  outlineHeader?: ReactNode;
  status: RunStoryStatus;
  title: string;
  /** Small links above the title (Results · View Test). */
  crumbs?: ReactNode;
  /** One sentence about the outcome, under the title. */
  summary?: ReactNode;
  /** Replay progress, failure details and similar, above the steps. */
  notice?: ReactNode;
  navigation?: ReactNode;
  meta: readonly (string | undefined)[];
  steps: readonly StoryStep[];
  loadFrame?(path: string): Promise<Blob>;
  /** A ready URL for a frame (inline evidence); takes precedence over loadFrame. */
  frameSource?(path: string): string | undefined;
  /** Live: follow the newest frame until the person picks a step. */
  latestFrame?: string;
  captures?: readonly CaptureReviewItem[];
  onReview?(item: CaptureReviewItem, action: CaptureReviewAction): Promise<void> | void;
  actions?: ReactNode;
  footer?: ReactNode;
  runId?: string;
  finishedAt?: number;
}) {
  const allActions = useMemo(() => steps.flatMap((step) => step.actions), [steps]);
  const [pinned, setPinned] = useState<string>();
  const selected =
    allActions.find((action) => action.id === pinned) ??
    [...allActions].reverse().find((action) => action.framePath);
  const framePath =
    pinned && selected?.framePath ? selected.framePath : (latestFrame ?? selected?.framePath);
  const direct = framePath ? frameSource?.(framePath) : undefined;
  const frame = useQuery({
    queryKey: ["run-story", "frame", runId ?? "live", framePath],
    queryFn: () => loadFrame!(framePath!),
    enabled: Boolean(loadFrame && framePath && !direct),
    staleTime: Infinity,
    retry: 1,
  });
  const blobUrl = useBlobUrl(direct ? undefined : frame.data);
  const url = direct ?? blobUrl;
  const loadingFrame = Boolean(loadFrame && framePath && !direct && !frame.isError && !blobUrl);
  const capture = captures?.find((item) => item.framePath && item.framePath === framePath);
  const currentStep = steps.find((step) => step.state === "running");
  const currentRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (status === "running" && !pinned) currentRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [currentStep?.id, status, pinned]);
  const capturedScreen = (
    <WorkspaceScreenshot>
      {url ? (
        <EvidenceImageViewer
          key={`${runId}:${framePath}`}
          frame={{
            id: framePath ?? "current",
            title: "Screen at this step",
            media: { kind: "image", src: url },
          }}
          onError={() => {}}
        />
      ) : loadingFrame ? (
        <div
          role="status"
          aria-label="Loading recorded screen"
          aria-busy="true"
          className="h-full w-full rounded-lg bg-muted/15 ring-1 ring-border/30"
        />
      ) : framePath && frame.isError ? (
        <div
          className="grid justify-items-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <p>Screenshot couldn’t load.</p>
          <Button variant="outline" size="sm" onClick={() => void frame.refetch()}>
            Retry screenshot
          </Button>
        </div>
      ) : (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          {status === "running" ? "Starting…" : "No screenshot was saved for this step"}
        </p>
      )}
    </WorkspaceScreenshot>
  );

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label="Run">
      {embedded
        ? null
        : (header ?? (
            <TestWorkspaceHeader title={title} actions={actions}>
              {crumbs ? (
                <nav aria-label="Breadcrumb" className="flex items-center gap-2">
                  {crumbs}
                </nav>
              ) : null}
              <span role="status">
                <StatusPill state={PILL[status]} size="md" />
              </span>
              <span>{meta.filter(Boolean).join(" · ")}</span>
              {summary ? <span>{summary}</span> : null}
            </TestWorkspaceHeader>
          ))}
      {navigation}
      <TestWorkspace
        layout={status === "running" ? "live" : "sidebar"}
        outline={
          <>
            {outlineHeader}
            {notice ? (
              <div className="grid gap-2 border-b border-border px-5 py-3 empty:hidden">
                {notice}
              </div>
            ) : null}
            <ol
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
              aria-label="Steps"
            >
              {steps.length === 0 ? (
                <li className="px-2 py-6 text-sm text-muted-foreground">
                  {status === "running" ? "Waiting for the first step…" : "No steps were recorded."}
                </li>
              ) : null}
              {steps.map((step, index) => (
                <li
                  key={step.id}
                  ref={step.id === currentStep?.id ? currentRow : undefined}
                  aria-current={step.id === currentStep?.id ? "step" : undefined}
                  className={`mb-3 min-w-0 rounded-lg ${step.state === "running" ? "bg-accent/60 ring-1 ring-info/30" : ""}`}
                >
                  <StepDetails
                    live={status === "running"}
                    state={step.state}
                    heading={
                      <div className="flex items-start gap-2 px-2 py-1.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-sm font-semibold leading-6">
                          {step.title}
                        </span>
                        {status === "running" ? (
                          <span className="mt-1">
                            <StateMark state={step.state} />
                          </span>
                        ) : null}
                        {step.durationMs ? (
                          <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                            {formatDuration(step.durationMs)}
                          </span>
                        ) : null}
                      </div>
                    }
                  >
                    <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
                      {step.actions.map((action) => (
                        <ActionRow
                          key={action.id}
                          action={action}
                          selected={selected?.id === action.id && Boolean(pinned)}
                          capture={captures?.find(
                            (item) => item.framePath && item.framePath === action.framePath,
                          )}
                          onSelect={() => setPinned(action.id === pinned ? undefined : action.id)}
                        />
                      ))}
                    </ul>
                  </StepDetails>
                </li>
              ))}
            </ol>
            {footer ? <footer className="border-t border-border px-5 py-3">{footer}</footer> : null}
          </>
        }
        preview={
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center gap-4 overflow-hidden bg-stage p-4">
            {livePreview && !pinned
              ? livePreview(framePath ? capturedScreen : undefined)
              : capturedScreen}
            {livePreview && pinned ? (
              <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Captured screenshot</span>
                <Button variant="outline" size="sm" onClick={() => setPinned(undefined)}>
                  Live device
                </Button>
              </div>
            ) : null}
            {capture ? (
              <CaptureBar
                item={capture}
                {...(runId ? { runId } : {})}
                {...(finishedAt ? { finishedAt } : {})}
                {...(onReview ? { onReview } : {})}
              />
            ) : selected && (!livePreview || pinned) ? (
              <p className="text-sm text-muted-foreground">
                {selected.framePath === framePath ? selected.label : "Latest captured screenshot"}
              </p>
            ) : null}
          </div>
        }
      />
    </section>
  );
}

function StepDetails({
  live,
  state,
  heading,
  children,
}: {
  live: boolean;
  state: StoryState;
  heading: ReactNode;
  children: ReactNode;
}) {
  if (!live)
    return (
      <>
        {heading}
        {children}
      </>
    );
  return (
    <details open={state === "running"} className="group/step">
      <summary className="relative cursor-pointer list-none rounded-lg pr-3 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {heading}
        <ChevronRight
          aria-hidden="true"
          className="absolute top-3 right-0 size-3 text-muted-foreground group-open/step:rotate-90"
        />
      </summary>
      {children}
    </details>
  );
}

function captureBadge(item?: CaptureReviewItem): string | undefined {
  if (!item) return undefined;
  if (item.status === "accepted")
    return decidedByReference(item.decidedBy)
      ? (item.reference?.changeRatio ?? 0) > 0
        ? "Matches reference within tolerance"
        : "Matches reference"
      : "Looks correct";
  if (item.status === "issue") return "Issue reported";
  if (item.reference?.state === "changed")
    return `Changed ${Math.max(0.1, (item.reference.changeRatio ?? 0) * 100).toFixed(1)}%`;
  if (item.reference?.state === "incomparable") return "Cannot compare · review needed";
  if (item.status === "pending") return "To review";
  return undefined;
}

function ActionRow({
  action,
  selected,
  capture,
  onSelect,
}: {
  action: StoryAction;
  selected: boolean;
  capture?: CaptureReviewItem;
  onSelect(): void;
}) {
  const Icon = ACTION_ICON[action.kind];
  const badge = captureBadge(capture);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={!action.framePath}
        aria-pressed={selected}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-md py-1.5 pr-2 pl-9 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent/50 ${
          selected ? "bg-accent" : ""
        }`}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{action.label}</span>
          {action.detail ? (
            <span className="block truncate text-xs text-muted-foreground">{action.detail}</span>
          ) : null}
        </span>
        {badge ? (
          <span
            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-medium ${
              capture?.status === "accepted"
                ? "bg-success/15 text-success-foreground"
                : capture?.status === "issue"
                  ? "bg-destructive/15 text-destructive"
                  : "bg-warning/15 text-warning-foreground"
            }`}
          >
            {badge}
          </span>
        ) : action.durationMs !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(action.durationMs)}
          </span>
        ) : null}
        <StateMark state={action.state} />
      </button>
    </li>
  );
}

function CaptureBar({
  item,
  runId,
  finishedAt,
  onReview,
}: {
  item: CaptureReviewItem;
  runId?: string;
  finishedAt?: number;
  onReview?(item: CaptureReviewItem, action: CaptureReviewAction): Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const decide = async (action: CaptureReviewAction) => {
    setBusy(true);
    try {
      await onReview?.(item, action);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid w-full max-w-xl justify-items-center gap-2">
      {runId ? (
        <ReferenceCompareLine runId={runId} item={item} {...(finishedAt ? { finishedAt } : {})} />
      ) : null}
      {item.status === "pending" && onReview ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide("accept")}>
            <Check aria-hidden="true" /> Looks correct
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void decide("accept-as-reference")}
          >
            Accept as reference
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void decide("report-issue")}
          >
            <Flag aria-hidden="true" /> Report issue
          </Button>
        </div>
      ) : null}
    </div>
  );
}
