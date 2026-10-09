/** @jsxImportSource react */
import { useEffect, type CSSProperties } from "react";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  decidedByReference,
  planCaptureReviewScreenLabel,
  readableDeviceName,
  type CaptureReviewAction,
  type PlanCaptureReviewItem,
} from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Dialog, DialogContent, DialogTitle } from "@relay/ui-react/components/dialog";
import { Check, CheckCheck, ChevronLeft, ChevronRight, Flag, ImageOff, X } from "lucide-react";
import { CaptureReviewDecisions } from "../components/capture-review-decisions";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";
import { ReportImage } from "../components/report-image";
import type { ReportEvidenceItem } from "../data/run-report-model";

export type ScreenshotReviewHandler = (
  action: CaptureReviewAction,
  items: PlanCaptureReviewItem[],
  note?: string,
) => Promise<boolean>;

type Tone = "pending" | "good" | "bad" | "muted";

export function screenshotKey(item: PlanCaptureReviewItem): string {
  return captureReviewQueueItemKey(item);
}

export function isReviewable(item: PlanCaptureReviewItem): boolean {
  return item.status !== "missing" && !item.blocked;
}

export function needsReview(item: PlanCaptureReviewItem): boolean {
  return item.status === "pending" && isReviewable(item);
}

/** One short, human status per screenshot. */
export function screenshotStatus(item: PlanCaptureReviewItem): { label: string; tone: Tone } {
  if (item.blocked) return { label: "Couldn’t capture", tone: "bad" };
  if (item.status === "missing") return { label: "Not captured", tone: "bad" };
  if (item.status === "issue") return { label: "Issue reported", tone: "bad" };
  if (item.status === "need-more-evidence") return { label: "Needs more evidence", tone: "bad" };
  if (item.status === "accepted")
    return {
      label: decidedByReference(item.decidedBy) ? "Matches reference" : "Looks correct",
      tone: "good",
    };
  if (item.reference?.state === "changed")
    return {
      label: `Changed ${((item.reference.changeRatio ?? 0) * 100).toFixed(1)}% from reference`,
      tone: "pending",
    };
  if (item.reference?.state === "new") return { label: "New screen", tone: "pending" };
  return { label: "To review", tone: "pending" };
}

const toneDot: Record<Tone, string> = {
  pending: "bg-brand",
  good: "bg-success",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/50",
};

function StatusLine({ item }: { item: PlanCaptureReviewItem }) {
  const status = screenshotStatus(item);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        className={`size-1.5 shrink-0 rounded-full ${toneDot[status.tone]}`}
        aria-hidden="true"
      />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

function deviceOf(item: PlanCaptureReviewItem): string | undefined {
  const device = item.device || item.configuration?.app || item.configuration?.browser;
  return device ? readableDeviceName(device) : undefined;
}

function accountOf(item: PlanCaptureReviewItem): string | undefined {
  return item.account ?? item.configuration?.account;
}

/** Device and account, leaving out whichever is the same for every screenshot. */
export function configurationLabel(
  item: PlanCaptureReviewItem,
  all: readonly PlanCaptureReviewItem[] = [],
): string {
  const varies = (read: (item: PlanCaptureReviewItem) => string | undefined) =>
    all.length < 2 || new Set(all.map(read)).size > 1;
  const device = varies(deviceOf) ? deviceOf(item) : undefined;
  const account = varies(accountOf) ? accountOf(item) : undefined;
  return [device, account].filter(Boolean).join(" · ") || deviceOf(item) || "";
}

function stepLabel(item: PlanCaptureReviewItem): string {
  return planCaptureReviewScreenLabel(item) || "Screenshot";
}

function frameFor(item: PlanCaptureReviewItem, frames: readonly ReportEvidenceItem[]) {
  const id = captureReviewQueueFrameKey(item);
  return frames.find((frame) => frame.id === id);
}

type JourneyRow = { key: string; label: string; cells: Map<string, PlanCaptureReviewItem> };
type JourneyColumn = { key: string; label: string };

/** Rows are cases, columns are steps in the order the Test runs them. */
export function journeyLayout(
  items: readonly PlanCaptureReviewItem[],
  caseLabel: (item: PlanCaptureReviewItem, index: number) => string,
): { rows: JourneyRow[]; columns: JourneyColumn[]; ordered: PlanCaptureReviewItem[] } {
  const rows = new Map<string, JourneyRow>();
  const columns = new Map<string, JourneyColumn & { rank: number; seen: number }>();
  const occurrences = new Map<string, number>();
  for (const item of items) {
    const rowKey = item.runId ?? item.executionCaseId ?? "case";
    let row = rows.get(rowKey);
    if (!row) {
      row = { key: rowKey, label: caseLabel(item, rows.size), cells: new Map() };
      rows.set(rowKey, row);
    }
    const label = stepLabel(item);
    const occurrence = occurrences.get(`${rowKey}|${label}`) ?? 0;
    occurrences.set(`${rowKey}|${label}`, occurrence + 1);
    const columnKey = `${label}#${occurrence}`;
    const position = row.cells.size;
    const existing = columns.get(columnKey);
    if (!existing)
      columns.set(columnKey, { key: columnKey, label, rank: position, seen: columns.size });
    else existing.rank = Math.min(existing.rank, position);
    row.cells.set(columnKey, item);
  }
  const orderedColumns = [...columns.values()].sort(
    (left, right) => left.rank - right.rank || left.seen - right.seen,
  );
  const orderedRows = [...rows.values()];
  return {
    rows: orderedRows,
    columns: orderedColumns,
    ordered: orderedRows.flatMap((row) =>
      orderedColumns.flatMap((column) => {
        const cell = row.cells.get(column.key);
        return cell ? [cell] : [];
      }),
    ),
  };
}

function DecisionBadge({ item }: { item: PlanCaptureReviewItem }) {
  const status = screenshotStatus(item);
  // Uncaptured cells already read as empty; a flag would claim someone reported them.
  if (!isReviewable(item) || item.status === "pending") return null;
  const Icon = status.tone === "good" ? Check : Flag;
  return (
    <span
      className={`absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full shadow-sm ring-2 ring-background ${status.tone === "good" ? "bg-success text-white" : "bg-destructive text-white"}`}
      title={status.label}
    >
      <Icon className="size-3" strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

/** Every screenshot on one screen: read a row to follow a case, a column to compare a step. */
export function PlanScreenshotJourney({
  rows,
  columns,
  frames,
  busy,
  onReview,
  onOpen,
}: {
  rows: readonly JourneyRow[];
  columns: readonly JourneyColumn[];
  frames: readonly ReportEvidenceItem[];
  busy: boolean;
  onReview?: ScreenshotReviewHandler;
  onOpen(item: PlanCaptureReviewItem): void;
}) {
  const columnCount = { "--journey-steps": columns.length } as CSSProperties;
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <div
        role="table"
        aria-label="Screenshots by case and step"
        className="grid w-max min-w-full grid-cols-[minmax(7rem,10rem)_repeat(var(--journey-steps),minmax(6rem,8.5rem))] gap-x-3 gap-y-5"
        style={columnCount}
      >
        <div role="row" className="contents">
          <div role="columnheader" className="self-end text-xs text-muted-foreground">
            Case
          </div>
          {columns.map((column, index) => {
            const pending = rows.flatMap((row) => {
              const cell = row.cells.get(column.key);
              return cell && needsReview(cell) ? [cell] : [];
            });
            return (
              <div
                key={column.key}
                role="columnheader"
                className="group/col flex min-w-0 items-start gap-1 self-end text-xs"
              >
                <span className="mt-px shrink-0 tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="line-clamp-2 min-w-0 flex-1 font-medium" title={column.label}>
                  {column.label}
                </span>
                {onReview && pending.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="-mt-0.5 shrink-0"
                    title={`Mark this step correct for all ${pending.length} cases`}
                    aria-label={`Mark ${column.label} correct for all ${pending.length} cases`}
                    disabled={busy}
                    onClick={() => void onReview("accept", pending)}
                  >
                    <CheckCheck aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
        {rows.map((row) => {
          const cells = [...row.cells.values()];
          const left = cells.filter(needsReview).length;
          const problems = cells.filter(
            (cell) => isReviewable(cell) && screenshotStatus(cell).tone === "bad",
          ).length;
          const uncaptured = cells.filter((cell) => !isReviewable(cell)).length;
          return (
            <div key={row.key} role="row" className="contents">
              <div role="rowheader" className="grid content-start gap-0.5 pt-1 text-sm">
                <span className="line-clamp-3 font-medium" title={row.label}>
                  {row.label}
                </span>
                <span
                  className={`text-xs ${problems ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {problems
                    ? `${problems} ${problems === 1 ? "problem" : "problems"}`
                    : left
                      ? `${left} to review`
                      : uncaptured === cells.length
                        ? "Nothing captured"
                        : uncaptured
                          ? `${uncaptured} not captured`
                          : "All reviewed"}
                </span>
              </div>
              {columns.map((column) => {
                const item = row.cells.get(column.key);
                if (!item) return <span key={column.key} role="cell" />;
                const frame = frameFor(item, frames);
                const status = screenshotStatus(item);
                const empty = !frame?.media;
                const ring = !isReviewable(item)
                  ? "border border-dashed border-border ring-0 bg-transparent hover:border-foreground/30"
                  : status.tone === "bad"
                    ? "ring-1 ring-destructive/70"
                    : "ring-1 ring-border hover:ring-foreground/30";
                return (
                  <div key={column.key} role="cell" className="relative min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      aria-label={`${column.label} · ${row.label} · ${status.label}`}
                      title={item.note ? `${status.label}: ${item.note}` : status.label}
                      className={`block w-full overflow-hidden rounded-lg bg-muted/40 transition-[box-shadow,transform,border-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${empty ? "" : "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0"} ${ring}`}
                    >
                      {frame?.media ? (
                        <ReportImage
                          media={frame.media}
                          alt=""
                          className="block h-auto w-full object-contain"
                        />
                      ) : (
                        <span className="flex aspect-[9/16] flex-col items-center justify-center gap-1.5 p-2 text-center text-xs text-muted-foreground/70">
                          <ImageOff className="size-4" aria-hidden="true" />
                          {status.label}
                        </span>
                      )}
                    </button>
                    <DecisionBadge item={item} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One screenshot at a time: large image, decision, and keyboard navigation. */
export function PlanScreenshotViewer({
  items,
  openKey,
  frames,
  busy,
  onReview,
  onNavigate,
  onClose,
  onInspectProblems,
  caseLabel,
}: {
  caseLabel(item: PlanCaptureReviewItem): string;
  items: readonly PlanCaptureReviewItem[];
  openKey?: string;
  frames: readonly ReportEvidenceItem[];
  busy: boolean;
  onReview?: ScreenshotReviewHandler;
  onNavigate(item: PlanCaptureReviewItem): void;
  onClose(): void;
  onInspectProblems?(caseId?: string): void;
}) {
  const index = openKey ? items.findIndex((item) => screenshotKey(item) === openKey) : -1;
  const item = index >= 0 ? items[index] : undefined;
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;
  const nextPending =
    items.slice(index + 1).find(needsReview) ??
    items.slice(0, Math.max(0, index)).find(needsReview);
  const remaining = items.filter(needsReview).length;
  const frame = item ? frameFor(item, frames) : undefined;

  useEffect(() => {
    if (!item) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')
      )
        return;
      if (event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        onNavigate(previous);
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault();
        onNavigate(next);
      } else if (
        (event.key === "a" || event.key === "A") &&
        onReview &&
        item &&
        needsReview(item) &&
        !busy
      ) {
        event.preventDefault();
        void decide("accept");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function decide(action: CaptureReviewAction, note?: string) {
    if (!item || !onReview) return false;
    const ok = await onReview(action, [item], note);
    if (ok) {
      if (nextPending) onNavigate(nextPending);
      else onClose();
    }
    return ok;
  }

  const secondary = item ? caseLabel(item) : "";
  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(92dvh,56rem)] w-[min(96vw,72rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none md:flex-row"
      >
        {item ? (
          <>
            <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-6">
              {frame?.media ? (
                <EvidenceImageViewer
                  key={frame.id}
                  frame={frame}
                  onError={() => undefined}
                  className="max-h-full w-auto max-w-full rounded-lg object-contain shadow-sm"
                />
              ) : (
                <div className="grid max-w-xs justify-items-center gap-3 text-center text-sm text-muted-foreground">
                  <ImageOff className="size-8" aria-hidden="true" />
                  <p>
                    {item.blocked
                      ? "This screenshot couldn’t be captured because the case didn’t run."
                      : "This screenshot wasn’t captured. The case stopped before reaching this step."}
                  </p>
                  {onInspectProblems ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onClose();
                        onInspectProblems(item.executionCaseId);
                      }}
                    >
                      See what went wrong
                    </Button>
                  ) : null}
                </div>
              )}
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-1/2 left-3 -translate-y-1/2"
                aria-label="Previous screenshot"
                disabled={!previous}
                onClick={() => previous && onNavigate(previous)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-1/2 right-3 -translate-y-1/2"
                aria-label="Next screenshot"
                disabled={!next}
                onClick={() => next && onNavigate(next)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-border p-5 md:w-80 md:border-t-0 md:border-l">
              <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted-foreground">
                <span>
                  {[
                    remaining === items.length ? undefined : `${index + 1} of ${items.length}`,
                    remaining ? `${remaining} left to review` : "All reviewed",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  className="-me-2"
                  onClick={onClose}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              <div className="grid gap-1.5">
                <DialogTitle className="text-lg leading-snug font-semibold">
                  {stepLabel(item)}
                </DialogTitle>
                {secondary ? <p className="text-sm text-muted-foreground">{secondary}</p> : null}
                <p className="text-sm text-muted-foreground">
                  <StatusLine item={item} />
                </p>
              </div>
              {item.lookFor && item.lookFor !== stepLabel(item) ? (
                <div className="rounded-lg bg-muted/60 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Check that</p>
                  <p className="mt-0.5">{item.lookFor}</p>
                </div>
              ) : null}
              {item.note ? (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Note</p>
                  <p className="mt-0.5">{item.note}</p>
                </div>
              ) : null}
              <div className="mt-auto grid gap-3">
                {onReview && isReviewable(item) ? (
                  <CaptureReviewDecisions
                    prominent
                    busy={busy}
                    reviewStatus={item.status}
                    onReview={(action, note) => decide(action, note)}
                  />
                ) : null}
                <p className="hidden text-xs text-muted-foreground md:block">
                  <Kbd>←</Kbd> <Kbd>→</Kbd> to move
                  {onReview && needsReview(item) ? (
                    <>
                      {" · "}
                      <Kbd>A</Kbd> looks correct
                    </>
                  ) : null}
                </p>
              </div>
            </aside>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-xs text-foreground">
      {children}
    </kbd>
  );
}
