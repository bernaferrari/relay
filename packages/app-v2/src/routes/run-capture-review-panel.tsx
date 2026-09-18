/** @jsxImportSource react */

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Check } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import {
  captureReviewAdvanceIndex,
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  destIdentityReviewItems,
  formatCaptureReviewConfiguration,
  formatCaptureReviewCoverageSummary,
  formatCaptureReviewObservedSession,
  planCaptureReviewScreenLabel,
  type CaptureReviewAction,
  type CaptureReviewConfiguration,
  type CaptureReviewItem,
  type CaptureReviewQueue,
} from "@relay/protocol";
import { CaptureReviewDecisions } from "./capture-review-decisions";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";
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

function previewPlace(item: CaptureReviewItem): string {
  const meta = planFields(item);
  return [meta.device, item.configuration?.account ?? meta.account].filter(Boolean).join(" · ");
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

function reviewShellClass(input: {
  showCoverage: boolean;
  showImage: boolean;
  gallery: boolean;
}): string {
  const columns = !input.showImage
    ? ""
    : input.gallery
      ? ""
      : "lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:items-start";
  return `grid gap-5 ${input.showCoverage ? "p-3" : ""} ${columns}`.trim();
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
  showImage = true,
  fallbackTitle,
  reviewedItemKeys,
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
  showImage?: boolean;
  fallbackTitle?: string;
  reviewedItemKeys?: readonly string[];
}) {
  const [layout, setLayout] = useState("gallery");
  const gallery = Boolean(showImage && onReviewMany && layout === "gallery");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!reviewedItemKeys?.length) return;
    setSelectedIds(
      (current) => new Set([...current].filter((key) => !reviewedItemKeys.includes(key))),
    );
  }, [reviewedItemKeys]);
  const destItems = destIdentityReviewItems(queue.items);
  const selected = destItems[Math.min(selectedIndex, Math.max(0, destItems.length - 1))];
  const pendingIndices = destItems.flatMap((item, index) =>
    item.status === "pending" && reviewable(item) && index !== selectedIndex ? [index] : [],
  );
  const nextPendingIndex =
    pendingIndices.find((index) => index > selectedIndex) ?? pendingIndices[0];
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
  const bulkItems = destItems.filter((item) => {
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
  const caption = (item: CaptureReviewItem, index: number) => {
    const labeled = planCaptureReviewScreenLabel(item);
    if (labeled && labeled !== item.caption) return labeled;
    if (item.caption.startsWith("step:"))
      return (
        item.caption.split(":").slice(2).join(":") || fallbackTitle || `Checkpoint ${index + 1}`
      );
    if (item.caption.startsWith("app-map:"))
      return fallbackTitle
        ? `${fallbackTitle} · checkpoint ${index + 1}`
        : `Checkpoint ${index + 1}`;
    return item.caption || fallbackTitle || `Checkpoint ${index + 1}`;
  };
  return (
    <div
      className={reviewShellClass({ showCoverage, showImage, gallery })}
      tabIndex={0}
      aria-label="Screenshot review"
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.defaultPrevented
        )
          return;
        if (
          target instanceof Element &&
          target.closest(
            'input, textarea, select, button, a, [role="tab"], [role="combobox"], [contenteditable="true"], [role="dialog"]',
          )
        )
          return;
        const next = captureReviewAdvanceIndex(selectedIndex, destItems.length, event.key);
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
        {showImage && onReviewMany ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={layout} onValueChange={setLayout}>
              <TabsList aria-label="Screenshot layout">
                <TabsTrigger value="gallery">Gallery</TabsTrigger>
                <TabsTrigger value="detail">Inspect</TabsTrigger>
              </TabsList>
            </Tabs>
            {bulkItems.length > 0 ? (
              <CaptureReviewDecisions
                busy={busy}
                bulkCount={bulkItems.length}
                onReview={(action) => onReviewMany(action, bulkItems)}
              />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  busy || !destItems.some((item) => item.status === "pending" && reviewable(item))
                }
                onClick={() =>
                  setSelectedIds(
                    new Set(
                      destItems
                        .filter((item) => item.status === "pending" && reviewable(item))
                        .map(captureReviewQueueItemKey),
                    ),
                  )
                }
              >
                Select unreviewed
              </Button>
            )}
            {selectedIds.size ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </Button>
            ) : null}
          </div>
        ) : null}
        {nextPendingIndex !== undefined ? (
          <Button
            className="w-fit"
            variant="ghost"
            size="sm"
            disabled={nextPendingIndex === undefined}
            onClick={() => {
              if (nextPendingIndex !== undefined) {
                onSelect(nextPendingIndex);
                if (gallery) setLayout("detail");
              }
            }}
          >
            Next unreviewed
          </Button>
        ) : null}
        {onReviewMany && !showImage && bulkItems.length > 0 ? (
          <CaptureReviewDecisions
            busy={busy}
            bulkCount={bulkItems.length}
            onReview={(action) => onReviewMany(action, bulkItems)}
          />
        ) : null}
        <ul
          className={
            gallery
              ? "grid grid-cols-1 items-start gap-x-4 gap-y-5 p-0.5 sm:grid-cols-2"
              : showImage
                ? "flex gap-2 overflow-x-auto p-0.5 lg:grid lg:max-h-[min(60vh,36rem)] lg:overflow-y-auto"
                : "grid max-h-[min(45vh,24rem)] gap-2 overflow-y-auto p-0.5"
          }
          aria-label="Screenshots for review"
        >
          {destItems.map((item, index) => {
            const identity = { ...item, ...planFields(item) };
            const key = captureReviewQueueItemKey(identity);
            const thumb = frames.find((frame) => frame.id === captureReviewQueueFrameKey(identity));
            const place = previewPlace(item);
            const blocked = Boolean(planFields(item).blocked);
            return (
              <li
                key={key}
                className={`relative min-w-0 ${showImage && !gallery ? "w-72 shrink-0 lg:w-auto" : ""}`}
              >
                {reviewable(item) ? (
                  <label
                    className={`absolute start-0 z-10 flex size-10 items-center justify-center ${gallery ? "top-0 start-0 cursor-pointer" : "top-1/2 -translate-y-1/2"}`}
                  >
                    <span className="sr-only">Select {caption(item, index)}</span>
                    <input
                      type="checkbox"
                      role="checkbox"
                      aria-label={`Select ${caption(item, index)}`}
                      aria-checked={selectedIds.has(key)}
                      className="peer sr-only"
                      checked={selectedIds.has(key)}
                      disabled={busy}
                      onChange={(event) => toggleSelected(key, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <span
                      aria-hidden="true"
                      className="flex size-6 items-center justify-center rounded-full border border-black/20 bg-white/95 text-transparent shadow-sm transition-colors peer-checked:border-info peer-checked:bg-info peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-info peer-focus-visible:ring-offset-2"
                    >
                      <Check className="size-3.5" strokeWidth={2.5} />
                    </span>
                  </label>
                ) : null}
                <button
                  type="button"
                  aria-pressed={gallery ? undefined : index === selectedIndex}
                  className={`${gallery ? "" : " cursor-pointer hover:bg-accent"} flex min-h-20 w-full gap-3 rounded-lg text-left transition-colors focus-visible:outline-2 ${gallery ? "flex-col overflow-hidden pb-1" : "items-center py-2 pl-10 pr-3"} ${index === selectedIndex ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
                  aria-label={gallery ? `Inspect ${caption(item, index)}` : undefined}
                  onClick={() => {
                    onSelect(index);
                    if (gallery) setLayout("detail");
                  }}
                >
                  {thumb?.media ? (
                    <ReportImage
                      media={thumb.media}
                      alt=""
                      className={
                        gallery
                          ? "h-auto w-full rounded-lg object-contain"
                          : "h-16 w-20 shrink-0 rounded-md bg-muted/40 object-contain"
                      }
                    />
                  ) : (
                    <span
                      className={`flex shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground ${gallery ? "aspect-4/3 w-full" : "h-16 w-20"}`}
                    >
                      {blocked ? "Blocked" : "Missing"}
                    </span>
                  )}
                  <span className={`grid min-w-0 gap-1 ${gallery ? "w-full px-0.5" : ""}`}>
                    <span className="truncate text-sm font-medium">{caption(item, index)}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                      {place ? (
                        <>
                          <span className="truncate">{place}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      ) : null}
                      <span>
                        {blocked
                          ? "Blocked"
                          : item.status === "missing"
                            ? "Not captured"
                            : item.status === "accepted"
                              ? "Looks correct"
                              : item.status === "issue"
                                ? "Issue reported"
                                : item.status === "need-more-evidence"
                                  ? "More evidence needed"
                                  : "Pending review"}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {selected && !gallery ? (
        <div
          className={`grid min-w-0 gap-3 ${showImage ? "rounded-lg border border-border/60 p-4" : ""}`}
          aria-label="Selected screenshot"
        >
          {caption(selected, selectedIndex) !== fallbackTitle ? (
            <p className="text-sm font-semibold">{caption(selected, selectedIndex)}</p>
          ) : null}
          {showImage &&
          (selectedMeta.device ||
            fallbackConfiguration?.app ||
            selected.configuration?.account ||
            selectedMeta.account) ? (
            <p className="text-xs text-muted-foreground">
              {[selectedMeta.device, selected.configuration?.account ?? selectedMeta.account]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {selected.lookFor &&
          selected.lookFor !== fallbackTitle &&
          selected.lookFor !== caption(selected, selectedIndex) ? (
            <p className="text-sm text-muted-foreground">Look for: {selected.lookFor}</p>
          ) : null}
          {selected.framePath ||
          selectedMeta.runId ||
          configuration.length ||
          selected.caption !== caption(selected, selectedIndex) ? (
            <details className="order-last text-xs text-muted-foreground">
              <summary className="w-fit cursor-pointer py-1">Capture details</summary>
              {configuration.length ? (
                <p className="break-all">{configuration.join(" · ")}</p>
              ) : null}
              <p className="break-all">Capture: {selected.caption}</p>
              {selectedMeta.runId ? <p className="break-all">Run: {selectedMeta.runId}</p> : null}
              {selected.framePath ? (
                <p className="break-all">Full image: {selected.framePath}</p>
              ) : null}
              {selected.attempt ? <p>Attempt {selected.attempt}</p> : null}
            </details>
          ) : null}
          {selected.status !== "pending" || !onReview ? (
            <p className="text-xs text-muted-foreground">
              {selectedMeta.blocked
                ? onReviewMany
                  ? "Capture blocked. Open Runs and problems to resolve the device or setup issue before rerunning."
                  : "Capture blocked. Check this run’s steps, resolve the device or setup issue, then set up another run."
                : selected.status === "missing"
                  ? onReviewMany
                    ? "This screenshot was not captured. Open Runs and problems to see what stopped it, then rerun the affected case."
                    : "This screenshot was not captured. Check the run’s steps, then set up another run to collect it."
                  : selected.status === "accepted"
                    ? "Looks correct — this does not approve a visual baseline."
                    : selected.status === "issue"
                      ? "Reported as an issue. Execution and automated checks are unchanged."
                      : selected.status === "need-more-evidence"
                        ? "More evidence requested."
                        : "Pending review"}
            </p>
          ) : null}
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
          {showImage && frame?.media ? (
            <div className="relative min-h-48 overflow-hidden rounded-lg bg-muted/20">
              <EvidenceImageViewer
                key={frame.id}
                frame={frame}
                onError={() => undefined}
                className="max-h-[min(70vh,42rem)] w-full max-w-full object-contain"
              />
            </div>
          ) : selectedMeta.blocked ? (
            <p className="text-sm">Blocked — no screenshot to accept.</p>
          ) : selected.status === "missing" ? (
            <p className="text-sm">No screenshot was saved for this checkpoint.</p>
          ) : null}
          {onReview && reviewable(selected) && bulkItems.length === 0 ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <CaptureReviewDecisions
                busy={busy}
                status={selected.status === "pending" ? "Awaiting your decision" : "Decision saved"}
                onReview={(action) => onReview(action, selected)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
