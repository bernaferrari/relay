/** @jsxImportSource react */

import { useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import {
  captureReviewAdvanceIndex,
  captureReviewCoverageLine,
  formatCaptureReviewConfiguration,
  type CaptureReviewAction,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
  type CaptureReviewQueue,
} from "@relay/protocol";
import { ReportImage } from "../components/report-image";
import type { ReportEvidenceItem } from "../data/run-product-service";

export function captureReviewSummaryLine(queue: CaptureReviewQueue): string {
  const { summary } = queue;
  const parts = [captureReviewCoverageLine(summary)];
  if (summary.pending) parts.push(`${summary.pending} pending review`);
  if (summary.accepted) parts.push(`${summary.accepted} accepted`);
  if (summary.issue) parts.push(`${summary.issue} issue${summary.issue === 1 ? "" : "s"}`);
  if (summary.needMoreEvidence) {
    parts.push(
      `${summary.needMoreEvidence} need${summary.needMoreEvidence === 1 ? "s" : ""} more evidence`,
    );
  }
  if (summary.missing) parts.push(`${summary.missing} missing`);
  return parts.join(" · ");
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
  const frame = selected?.framePath
    ? frames.find((item) => item.id === selected.framePath)
    : undefined;
  const configuration = formatCaptureReviewConfiguration(
    selected?.configuration ?? fallbackConfiguration,
  );
  const bulkItems = queue.items.filter(
    (item) => selectedIds.has(item.captureId) && item.status !== "missing",
  );
  const toggleSelected = (captureId: string, enabled: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (enabled) next.add(captureId);
      else next.delete(captureId);
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
          const thumb = item.framePath
            ? frames.find((frame) => frame.id === item.framePath)
            : undefined;
          return (
            <li key={item.captureId} className="relative">
              {item.status !== "missing" ? (
                <label className="absolute start-1 top-1 z-10">
                  <span className="sr-only">Select {item.caption}</span>
                  <input
                    type="checkbox"
                    className="size-3.5 accent-foreground"
                    checked={selectedIds.has(item.captureId)}
                    onChange={(event) => toggleSelected(item.captureId, event.target.checked)}
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
          {configuration.length ? (
            <p className="text-xs text-muted-foreground">{configuration.join(" · ")}</p>
          ) : null}
          {selected.lookFor ? (
            <p className="text-sm text-muted-foreground">Look for: {selected.lookFor}</p>
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
          {frame?.media ? null : selected.status === "missing" ? (
            <p className="text-sm">No screenshot was saved for this checkpoint.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
