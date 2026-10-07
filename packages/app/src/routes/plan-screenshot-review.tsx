/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  decidedByReference,
  planCaptureReviewScreenLabel,
  type CaptureReviewAction,
  type PlanCaptureReviewGroup,
  type PlanCaptureReviewItem,
} from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@relay/ui-react/components/dialog";
import { Check, ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
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
  return item.device || item.configuration?.app || item.configuration?.browser;
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

/** Gallery grouped by step (or configuration), with selection and a focused viewer. */
export function PlanScreenshotGallery({
  groups,
  groupBy,
  frames,
  busy,
  savedKeys,
  onReview,
  onOpen,
}: {
  /** Decisions the server acknowledged; only these leave the selection. */
  savedKeys?: readonly string[];
  groups: readonly PlanCaptureReviewGroup[];
  groupBy: "checkpoint" | "configuration";
  frames: readonly ReportEvidenceItem[];
  busy: boolean;
  onReview?: ScreenshotReviewHandler;
  onOpen(item: PlanCaptureReviewItem): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // Drop selections that left the visible set (filtered out or decided elsewhere).
  useEffect(() => {
    const visible = new Set(items.filter(isReviewable).map(screenshotKey));
    setSelected((current) => {
      const next = new Set([...current].filter((key) => visible.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [items]);
  useEffect(() => {
    if (!savedKeys?.length) return;
    setSelected((current) => new Set([...current].filter((key) => !savedKeys.includes(key))));
  }, [savedKeys]);
  const selectedItems = items.filter((item) => selected.has(screenshotKey(item)));
  const selecting = selected.size > 0;
  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  return (
    <div className="grid gap-8">
      {groups.map((group) => {
        const pending = group.items.filter(needsReview);
        return (
          <section key={group.id} aria-label={group.label} className="grid gap-3">
            <header className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                {group.label}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
              </h3>
              {onReview && pending.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void onReview("accept", pending)}
                >
                  <Check aria-hidden="true" />
                  Mark {pending.length} as correct
                </Button>
              ) : null}
            </header>
            <ul
              className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-5 p-0"
              aria-label={`${group.label} screenshots`}
            >
              {group.items.map((item) => {
                const key = screenshotKey(item);
                const frame = frameFor(item, frames);
                const checked = selected.has(key);
                const secondary =
                  groupBy === "checkpoint" ? configurationLabel(item, items) : stepLabel(item);
                return (
                  <li key={key} className="group/shot relative min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      aria-label={`Open ${stepLabel(item)}${secondary && groupBy === "checkpoint" ? ` · ${secondary}` : ""}`}
                      className={`flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-xl bg-muted/40 ring-1 transition-[box-shadow,background-color] duration-150 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring ${checked ? "ring-2 ring-primary" : "ring-border hover:ring-foreground/25"}`}
                    >
                      {frame?.media ? (
                        <ReportImage
                          media={frame.media}
                          alt=""
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="grid justify-items-center gap-2 p-3 text-center text-xs text-muted-foreground">
                          <ImageOff className="size-5" aria-hidden="true" />
                          {screenshotStatus(item).label}
                        </span>
                      )}
                    </button>
                    {onReview && isReviewable(item) ? (
                      <span
                        className={`absolute top-2 left-2 flex size-7 items-center justify-center rounded-md bg-background/85 shadow-sm backdrop-blur transition-opacity duration-150 ${selecting || checked ? "opacity-100" : "opacity-0 group-hover/shot:opacity-100 has-focus-visible:opacity-100"}`}
                      >
                        <Checkbox
                          aria-label={`Select ${stepLabel(item)}${secondary ? ` · ${secondary}` : ""}`}
                          checked={checked}
                          disabled={busy}
                          onCheckedChange={(on) => toggle(key, on)}
                        />
                      </span>
                    ) : null}
                    <div className="mt-2 grid gap-0.5 px-0.5 text-xs">
                      {secondary ? (
                        <span className="truncate font-medium text-foreground">{secondary}</span>
                      ) : null}
                      <span className="text-muted-foreground">
                        <StatusLine item={item} />
                      </span>
                      {item.note ? (
                        <span className="line-clamp-2 text-muted-foreground">“{item.note}”</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {onReview && selecting ? (
        <div
          role="region"
          aria-label="Selected screenshots"
          className="sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl items-center gap-2 rounded-xl bg-popover p-2 pl-3 shadow-lg ring-1 ring-foreground/10"
        >
          <CaptureReviewDecisions
            busy={busy}
            bulkCount={selectedItems.length}
            onReview={(action, note) => onReview(action, selectedItems, note)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : null}
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
}: {
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

  const secondary = item ? configurationLabel(item, items) : "";
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
                  className="max-h-[calc(min(92dvh,56rem)-3rem)] w-auto max-w-full rounded-lg object-contain shadow-sm"
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
                className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full shadow-sm"
                aria-label="Previous screenshot"
                disabled={!previous}
                onClick={() => previous && onNavigate(previous)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full shadow-sm"
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
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[0.6875rem] text-foreground">
      {children}
    </kbd>
  );
}
