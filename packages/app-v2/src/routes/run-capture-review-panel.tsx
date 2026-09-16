/** @jsxImportSource react */

import { useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import {
  captureReviewAdvanceIndex,
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  formatCaptureReviewConfiguration,
  formatCaptureReviewCoverageSummary,
  formatCaptureReviewObservedSession,
  type CaptureReviewAction,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
  type CaptureReviewQueue,
} from "@relay/protocol";
import { ReportImage } from "../components/report-image";
import type { ReportEvidenceItem } from "../data/run-product-service";

function planFields(item: CaptureReviewItem): {
  runId?: string;
  blocked?: boolean;
  device?: string;
  account?: string;
} {
  const record = item as CaptureReviewItem & {
    runId?: string;
    blocked?: boolean;
    device?: string;
    account?: string;
  };
  return {
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    ...(record.blocked ? { blocked: true } : {}),
    ...(typeof record.device === "string" ? { device: record.device } : {}),
    ...(typeof record.account === "string" ? { account: record.account } : {}),
  };
}

function blockedUnboundLabel(item: CaptureReviewItem): string | undefined {
  const meta = planFields(item);
  if (!meta.blocked) return undefined;
  const imagine =
    item.checkpointId === "imagine" || item.caption.trim().toLowerCase() === "imagine";
  const ios = item.configuration?.app === "ai.x.GrokApp";
  if (imagine && ios) return "iOS Imagine Unbound";
  if (imagine) return "Imagine Unbound";
  return undefined;
}

function previewPlace(item: CaptureReviewItem): string {
  const meta = planFields(item);
  const unbound = blockedUnboundLabel(item);
  return [
    meta.device,
    item.configuration?.account ?? meta.account,
    unbound,
    !unbound && meta.blocked ? "blocked" : undefined,
    !meta.blocked && item.status === "missing" ? "missing" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function reviewable(item: CaptureReviewItem): boolean {
  return item.status !== "missing" && !planFields(item).blocked;
}

export function captureReviewSummaryLine(queue: {
  items?: unknown;
  summary: CaptureReviewQueue["summary"] & { planned?: number; blocked?: number };
}): string {
  return formatCaptureReviewCoverageSummary(queue.summary);
}

export function CaptureReviewPanel({
  queue,
  frames,
  selectedIndex,
  onSelect,
  onReview,
  onReviewMany,
  busy,
  fallbackConfiguration,
  showMasks,
  onShowMasksChange,
  showCoverage = true,
}: {
  queue: CaptureReviewQueue;
  frames: readonly ReportEvidenceItem[];
  selectedIndex: number;
  onSelect(index: number): void;
  onReview?(action: CaptureReviewAction, item: CaptureReviewItem): void;
  onReviewMany?(action: CaptureReviewAction, items: CaptureReviewItem[]): void;
  busy?: boolean;
  fallbackConfiguration?: CaptureReviewConfiguration;
  showMasks?: boolean;
  onShowMasksChange?(show: boolean): void;
  showCoverage?: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selected = queue.items[Math.min(selectedIndex, Math.max(0, queue.items.length - 1))];
  const pendingIndices = queue.items.flatMap((item, index) =>
    item.status === "pending" && reviewable(item) && index !== selectedIndex ? [index] : [],
  );
  const nextPendingIndex =
    pendingIndices.find((index) => index > selectedIndex) ?? pendingIndices[0];
  const selectedMeta = selected ? planFields(selected) : {};
  const selectedBlocked = selected ? blockedUnboundLabel(selected) : undefined;
  const frame = selected
    ? frames.find(
        (item) => item.id === captureReviewQueueFrameKey({ ...selected, ...selectedMeta }),
      )
    : undefined;
  const configuration = [
    ...formatCaptureReviewConfiguration(selected?.configuration ?? fallbackConfiguration),
    ...formatCaptureReviewObservedSession(selected?.observed),
  ];
  const bulkItems = queue.items.filter((item) => {
    const key = captureReviewQueueItemKey({ ...item, ...planFields(item) });
    return selectedIds.has(key) && reviewable(item);
  });
  const toggleSelected = (key: string, enabled: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  return (
    <div
      className="grid gap-4 p-3 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:items-start"
      tabIndex={0}
      aria-label="Screenshot review"
      onKeyDown={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        const next = captureReviewAdvanceIndex(selectedIndex, queue.items.length, event.key);
        if (next === undefined) return;
        event.preventDefault();
        if (next !== selectedIndex) onSelect(next);
      }}
    >
      <div className="grid min-w-0 gap-3">
        {showCoverage ? (
          <p className="px-1 text-xs tabular-nums text-muted-foreground">
            {captureReviewSummaryLine(queue)}
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={nextPendingIndex === undefined}
          onClick={() => {
            if (nextPendingIndex !== undefined) onSelect(nextPendingIndex);
          }}
        >
          Next pending screenshot
        </Button>
        {onReviewMany && bulkItems.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onReviewMany("accept", bulkItems)}
            >
              Looks correct for {bulkItems.length} selected
            </Button>
          </div>
        ) : null}
        <ul
          className="grid max-h-[min(70vh,36rem)] grid-cols-2 gap-2 overflow-y-auto p-0.5 md:grid-cols-1 xl:grid-cols-2"
          aria-label="Screenshots for review"
        >
          {queue.items.map((item, index) => {
            const identity = { ...item, ...planFields(item) };
            const key = captureReviewQueueItemKey(identity);
            const thumb = frames.find((frame) => frame.id === captureReviewQueueFrameKey(identity));
            const place = previewPlace(item);
            const blocked = Boolean(planFields(item).blocked);
            return (
              <li key={key} className="relative min-w-0">
                {reviewable(item) ? (
                  <label className="absolute start-0 top-0 z-10 flex size-8 items-center justify-center">
                    <span className="sr-only">Select {item.caption}</span>
                    <input
                      type="checkbox"
                      className="size-3.5 accent-foreground"
                      checked={selectedIds.has(key)}
                      onChange={(event) => toggleSelected(key, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </label>
                ) : null}
                <button
                  type="button"
                  aria-pressed={index === selectedIndex}
                  className={`relay-interactive-row flex min-h-[8.5rem] w-full flex-col items-stretch gap-1.5 rounded-md p-2 text-left transition-colors focus-visible:outline-2 ${index === selectedIndex ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
                  onClick={() => onSelect(index)}
                >
                  {thumb?.media ? (
                    <ReportImage
                      media={thumb.media}
                      alt=""
                      className="h-24 w-full rounded-sm bg-[var(--surface-base)] object-contain"
                    />
                  ) : (
                    <span className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                      {blocked ? (blockedUnboundLabel(item) ?? "Blocked") : "Missing"}
                    </span>
                  )}
                  <span className="w-full truncate text-xs font-medium">{item.caption}</span>
                  {place ? (
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                      {place}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {selected ? (
        <div className="grid min-w-0 gap-2">
          <p className="text-sm font-medium">{selected.caption}</p>
          {selectedMeta.runId ||
          (selected.attempt && selected.attempt > 1) ||
          selectedMeta.blocked ? (
            <p className="text-xs text-muted-foreground">
              {[
                selectedMeta.runId,
                selected.attempt && selected.attempt > 1
                  ? `attempt ${selected.attempt}`
                  : undefined,
                selectedBlocked,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {configuration.length ? (
            <p className="text-xs text-muted-foreground">{configuration.join(" · ")}</p>
          ) : null}
          {selected.lookFor ? (
            <p className="text-sm text-muted-foreground">Look for: {selected.lookFor}</p>
          ) : null}
          {selected.framePath ? (
            <p className="text-xs text-muted-foreground">Full image: {selected.framePath}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {selectedMeta.blocked
              ? `${selectedBlocked ?? "Blocked"} — this slot stays in the planned count and cannot be marked Looks correct.`
              : selected.status === "missing"
                ? "This screenshot was not captured."
                : selected.status === "accepted"
                  ? "Looks correct — this does not approve a visual baseline."
                  : selected.status === "issue"
                    ? "Reported as an issue. Execution and automated checks are unchanged."
                    : selected.status === "need-more-evidence"
                      ? "More evidence requested."
                      : "A person will review later."}
          </p>
          {selected.masks?.length && onShowMasksChange ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-foreground"
                checked={Boolean(showMasks)}
                onChange={(event) => onShowMasksChange(event.target.checked)}
              />
              Show review overlays
            </label>
          ) : null}
          {onReview && reviewable(selected) ? (
            <div className="flex flex-wrap gap-2" aria-label="Screenshot review decision">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onReview("accept", selected)}
              >
                Looks correct
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onReview("report-issue", selected)}
              >
                Report issue
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onReview("need-more-evidence", selected)}
              >
                Need more evidence
              </Button>
            </div>
          ) : null}
          {frame?.media ? (
            <ReportImage
              media={frame.media}
              alt={selected.caption}
              className="max-h-[min(70vh,42rem)] w-full max-w-full object-contain"
            />
          ) : selectedMeta.blocked ? (
            <p className="text-sm">{selectedBlocked ?? "Blocked"} — no screenshot to accept.</p>
          ) : selected.status === "missing" ? (
            <p className="text-sm">No screenshot was saved for this checkpoint.</p>
          ) : selected.framePath ? (
            <p className="text-sm">Full image: {selected.framePath}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
