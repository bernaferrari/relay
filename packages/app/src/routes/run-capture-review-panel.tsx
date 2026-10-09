/** @jsxImportSource react */

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Info, SquareCheck } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import {
  captureReviewAdvanceIndex,
  decidedByReference,
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
  onReview?(
    action: CaptureReviewAction,
    item: CaptureReviewItem,
    note?: string,
  ): void | boolean | Promise<boolean | void>;
  onReviewMany?(
    action: CaptureReviewAction,
    items: CaptureReviewItem[],
    note?: string,
  ): void | boolean | Promise<boolean | void>;
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
  const [selecting, setSelecting] = useState(false);
  const gallery = Boolean(showImage && onReviewMany && layout === "gallery");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!reviewedItemKeys?.length) return;
    setSelectedIds(
      (current) => new Set([...current].filter((key) => !reviewedItemKeys.includes(key))),
    );
  }, [reviewedItemKeys]);
  const destItems = destIdentityReviewItems(queue.items);
  const canSelect = Boolean(onReviewMany && destItems.length > 1);
  const showSelection = canSelect && (showImage || selecting);
  const selected =
    selectedIndex >= 0 && selectedIndex < destItems.length ? destItems[selectedIndex] : undefined;
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
      return item.caption.split(":").slice(2).join(":") || fallbackTitle || `Check ${index + 1}`;
    if (item.caption.startsWith("app-map:"))
      return fallbackTitle ? `${fallbackTitle} · checkpoint ${index + 1}` : `Check ${index + 1}`;
    return item.caption || fallbackTitle || `Check ${index + 1}`;
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
            'input, textarea, select, button, a, [role="tab"], [role="combobox"], [role="checkbox"], [contenteditable="true"], [role="dialog"]',
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
                onReview={(action, note) => onReviewMany(action, bulkItems, note)}
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
        {!showImage && canSelect ? (
          <Button
            size="sm"
            variant={selecting ? "secondary" : "outline"}
            className="min-h-11 w-full justify-center"
            aria-pressed={selecting}
            disabled={busy}
            onClick={() => {
              setSelecting(!selecting);
              setSelectedIds(new Set());
            }}
          >
            <SquareCheck className="size-4" />
            {selecting ? "Done selecting" : "Select screenshots"}
          </Button>
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
            onReview={(action, note) => onReviewMany(action, bulkItems, note)}
          />
        ) : null}
        <ul
          className={
            gallery
              ? "grid grid-cols-1 items-start gap-x-4 gap-y-5 p-0.5 sm:grid-cols-2"
              : showImage
                ? "flex gap-2 overflow-x-auto p-0.5 lg:grid lg:max-h-[min(60vh,36rem)] lg:overflow-y-auto"
                : "grid gap-2 p-0.5"
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
                {showSelection && reviewable(item) ? (
                  <div
                    className={`absolute end-1 z-10 flex size-11 items-center justify-center ${gallery ? "top-1" : "top-1/2 -translate-y-1/2"}`}
                  >
                    <Checkbox
                      aria-label={`Select ${caption(item, index)}`}
                      className="size-5 border-muted-foreground/60 bg-card shadow-none after:-inset-3 dark:bg-card"
                      checked={selectedIds.has(key)}
                      disabled={busy}
                      onCheckedChange={(checked) => toggleSelected(key, checked)}
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-pressed={gallery ? undefined : index === selectedIndex}
                  className={`${gallery ? "" : " cursor-pointer hover:bg-accent"} flex min-h-20 w-full gap-3 rounded-lg text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${gallery ? "flex-col overflow-hidden pb-1" : `items-center py-3 pl-3 ${showSelection ? "pr-12" : "pr-3"}`} ${index === selectedIndex ? "bg-accent ring-1 ring-inset ring-border" : ""}`}
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
                    <span className="line-clamp-2 text-sm font-medium leading-5">
                      {caption(item, index)}
                    </span>
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
                              ? decidedByReference(item.decidedBy)
                                ? (item.reference?.changeRatio ?? 0) > 0
                                  ? "Matches reference within tolerance"
                                  : "Matches reference"
                                : "Looks correct"
                              : item.status === "issue"
                                ? "Issue reported"
                                : item.status === "need-more-evidence"
                                  ? "More evidence needed"
                                  : item.reference?.state === "changed"
                                    ? `Changed ${((item.reference.changeRatio ?? 0) * 100).toFixed(1)}%`
                                    : item.reference?.state === "incomparable"
                                      ? "Cannot compare · review needed"
                                      : item.reference?.state === "new"
                                        ? "New · no reference yet"
                                        : "Pending review"}
                      </span>
                      {item.note ? <span className="min-w-0 basis-full">{item.note}</span> : null}
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
          {showImage && caption(selected, selectedIndex) !== fallbackTitle ? (
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
            <div className="order-last border-t border-border/60 pt-3">
              <Popover>
                <PopoverTrigger
                  render={
                    <Button variant="outline" size="sm" className="min-h-11 w-full justify-start" />
                  }
                >
                  <Info className="size-4 text-muted-foreground" />
                  Capture details
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="top"
                  className="max-h-[70dvh] w-80 max-w-[calc(100vw-2rem)] overflow-auto p-4"
                >
                  <h3 className="text-sm font-medium">Capture details</h3>
                  <dl className="grid gap-3 text-xs leading-5">
                    {[
                      ["Configuration", configuration.join(" · ")],
                      ["Capture", selected.caption],
                      ["Run", selectedMeta.runId],
                      ["Full image", selected.framePath],
                      ["Attempt", selected.attempt ? String(selected.attempt) : undefined],
                    ].map(([label, value]) =>
                      value ? (
                        <div key={label} className="space-y-0.5">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="wrap-anywhere">{value}</dd>
                        </div>
                      ) : null,
                    )}
                  </dl>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
          {(showImage && (selected.status !== "pending" || !onReview)) ||
          selected.status === "missing" ||
          selectedMeta.blocked ? (
            <p className="text-xs text-muted-foreground">
              {selectedMeta.blocked
                ? onReviewMany
                  ? "Capture blocked. Open runs and problems to resolve the device or setup issue before rerunning."
                  : "Capture blocked. Check this run’s steps, resolve the device or setup issue, then set up another run."
                : selected.status === "missing"
                  ? onReviewMany
                    ? "This screenshot was not captured. Open runs and problems to see what stopped it, then rerun the affected case."
                    : "This screenshot was not captured. Check the run’s steps, then set up another run to collect it."
                  : selected.status === "accepted"
                    ? decidedByReference(selected.decidedBy)
                      ? (selected.reference?.changeRatio ?? 0) > 0
                        ? "Within the approved reference tolerance — approved automatically."
                        : "Matches the approved reference — approved automatically."
                      : "Looks correct — a person reviewed this screenshot."
                    : selected.status === "issue"
                      ? "Reported as an issue. Execution and automated checks are unchanged."
                      : selected.status === "need-more-evidence"
                        ? "More evidence requested."
                        : "Pending review"}
            </p>
          ) : null}
          {selected.note ? <p className="text-sm">{selected.note}</p> : null}
          {selected.masks?.length && onShowMasksChange ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-xs text-muted-foreground">
              <Checkbox
                className="size-5 after:-inset-3"
                checked={Boolean(showMasks)}
                onCheckedChange={onShowMasksChange}
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
                onReview={(action, note) => onReview(action, selected, note)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
