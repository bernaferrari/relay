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

function planFields(item: CaptureReviewItem): { runId?: string; blocked?: boolean } {
  const record = item as CaptureReviewItem & { runId?: string; blocked?: boolean };
  return {
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    ...(record.blocked ? { blocked: true } : {}),
  };
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
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selected = queue.items[Math.min(selectedIndex, Math.max(0, queue.items.length - 1))];
  const selectedMeta = selected ? planFields(selected) : {};
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
    return selectedIds.has(key) && item.status !== "missing";
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
      className="grid gap-3 p-2"
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
      <p className="px-3 py-2 text-xs text-muted-foreground">{captureReviewSummaryLine(queue)}</p>
      <ul className="flex flex-wrap gap-1" aria-label="Screenshots for review">
        {queue.items.map((item, index) => {
          const identity = { ...item, ...planFields(item) };
          const key = captureReviewQueueItemKey(identity);
          const thumb = frames.find((frame) => frame.id === captureReviewQueueFrameKey(identity));
          return (
            <li key={key} className="relative">
              {item.status !== "missing" ? (
                <label className="absolute start-1 top-1 z-10">
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
                className={`relay-interactive-row flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-md p-1 text-left focus-visible:outline-2 ${index === selectedIndex ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
                onClick={() => onSelect(index)}
              >
                {thumb?.media ? (
                  <ReportImage
                    media={thumb.media}
                    alt=""
                    className="h-12 w-20 rounded-sm object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">Missing</span>
                )}
                <span className="w-full truncate text-center text-[10px]">{item.caption}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className="grid gap-2 px-3 pb-3">
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
                selectedMeta.blocked ? "blocked" : undefined,
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
            {selected.status === "missing"
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
              Show comparison masks
            </label>
          ) : null}
          {onReview && selected.status !== "missing" ? (
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
              {onReviewMany && bulkItems.length > 1 ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onReviewMany("accept", bulkItems)}
                >
                  Looks correct for {bulkItems.length} selected
                </Button>
              ) : null}
            </div>
          ) : null}
          {frame?.media ? (
            <ReportImage
              media={frame.media}
              alt={selected.caption}
              className="max-h-[28rem] w-full max-w-full object-contain"
            />
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
