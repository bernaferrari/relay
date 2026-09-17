/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureReviewAction, PlanCaptureReviewItem } from "@relay/protocol";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  filterPlanCaptureReviewQueue,
  formatCaptureReviewCoverageSummary,
  parsePlanCaptureReviewFilter,
  planCaptureReviewFilterOptions,
} from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { captureReviewFeedback } from "./capture-review-feedback";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { productClientForPlatform } from "../data/product-client";
import type { Platform } from "../platform/types";
import type { ReportEvidenceItem } from "../data/run-report-model";
import { CaptureReviewPanel } from "./run-capture-review-panel";

const FRAME_FILE = /^frames\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp)$/u;

function planCaptureFrames(
  items: readonly PlanCaptureReviewItem[],
  platform: Platform,
): ReportEvidenceItem[] {
  return items.flatMap((item) => {
    if (!item.framePath || !FRAME_FILE.test(item.framePath)) return [];
    const path = `/runs/${encodeURIComponent(item.runId)}/${item.framePath}`;
    const id = captureReviewQueueFrameKey(item);
    if (!id) return [];
    return [
      {
        id,
        title: item.caption,
        media: {
          kind: "image" as const,
          src: path,
          load: async () => {
            const { client } = await productClientForPlatform(platform);
            const resource = await client.binaryResource(path);
            return new Blob([new Uint8Array(resource.bytes)], {
              type: resource.headers.get("content-type") ?? "image/png",
            });
          },
        },
      },
    ];
  });
}

export function PlanCaptureReviewSection({
  batchId,
  runAcrossService,
  platform,
  streaming = false,
}: {
  batchId: string;
  runAcrossService: RunAcrossProductService;
  platform: Platform;
  streaming?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [pendingOnly, setPendingOnly] = useState(false);
  const [screen, setScreen] = useState("");
  const [place, setPlace] = useState("");
  const captures = useQuery({
    queryKey: ["run-across", "batch", batchId, "capture-review"],
    queryFn: () => {
      if (!runAcrossService.getCaptureReview)
        throw new Error("Plan capture review is unavailable.");
      return runAcrossService.getCaptureReview(batchId);
    },
    enabled: Boolean(runAcrossService.getCaptureReview),
    staleTime: 5_000,
    refetchInterval: streaming ? 5_000 : false,
  });
  const review = useMutation({
    mutationFn: (input: {
      action: CaptureReviewAction;
      items: Array<{ runId: string; captureId: string; imageSha256?: string }>;
    }) => {
      if (!runAcrossService.reviewCaptures) {
        throw new Error("Plan capture review is unavailable.");
      }
      return runAcrossService.reviewCaptures(batchId, input);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["run-across", "batch", batchId, "capture-review"],
      }),
  });
  const queue = captures.data;
  const filter = useMemo(
    () =>
      parsePlanCaptureReviewFilter({
        pending: pendingOnly || undefined,
        screen: screen || undefined,
        ...(place.startsWith("device:") ? { device: place.slice("device:".length) } : {}),
        ...(place.startsWith("account:") ? { account: place.slice("account:".length) } : {}),
      }),
    [pendingOnly, screen, place],
  );
  const visible = useMemo(
    () => (queue ? filterPlanCaptureReviewQueue(queue, filter) : undefined),
    [queue, filter],
  );
  const options = useMemo(
    () =>
      queue
        ? planCaptureReviewFilterOptions(queue.items)
        : { screens: [], devices: [], accounts: [] },
    [queue],
  );
  const selectedIndex = Math.max(
    0,
    visible?.items.findIndex((item) => captureReviewQueueItemKey(item) === selectedKey) ?? 0,
  );
  const feedback = useMemo(
    () =>
      review.data && review.variables
        ? captureReviewFeedback(review.variables.items, review.data.results)
        : undefined,
    [review.data, review.variables],
  );
  const frames = useMemo(
    () => (visible ? planCaptureFrames(visible.items, platform) : []),
    [visible, platform],
  );
  if (!runAcrossService.getCaptureReview) return null;
  if (!queue)
    return (
      <section className="mt-5 rounded-xl border border-border p-5" aria-label="Screenshot review">
        <h2 className="text-title font-semibold">Screenshot review</h2>
        {captures.isError ? (
          <div role="alert" className="mt-2 grid gap-2 text-sm">
            <p>Screenshots could not be loaded. {captures.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={captures.isFetching}
              onClick={() => void captures.refetch()}
            >
              Retry loading screenshots
            </Button>
          </div>
        ) : (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            Loading screenshots…
          </p>
        )}
      </section>
    );
  const reviewItem = (action: CaptureReviewAction, items: PlanCaptureReviewItem[]) => {
    review.mutate({
      action,
      items: items.map((item) => ({
        runId: item.runId,
        captureId: item.captureId,
        ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
      })),
    });
  };
  return (
    <section className="relay-batch-capture-review mt-5 rounded-xl border border-border bg-[var(--surface-raised-strong)]">
      <h2 className="px-5 pt-4 text-title font-semibold tracking-tight text-foreground">
        Screenshot review
      </h2>
      <p className="px-5 text-sm tabular-nums text-muted-foreground">
        {formatCaptureReviewCoverageSummary(queue.summary)}· Looks correct does not approve a visual
        baseline.
      </p>
      {captures.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 px-5 pt-2 text-sm">
          <p>Showing saved results. New captures could not be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={captures.isFetching}
            onClick={() => void captures.refetch()}
          >
            Refresh screenshots
          </Button>
        </div>
      ) : null}
      {review.isPending ? (
        <p role="status" className="px-5 pt-2 text-sm">
          Saving review…
        </p>
      ) : null}
      {review.isError ? (
        <p role="alert" className="px-5 pt-2 text-sm text-destructive">
          Review could not be confirmed. {review.error.message} Refresh screenshots before retrying.
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            disabled={captures.isFetching}
            onClick={() => void captures.refetch()}
          >
            Refresh screenshots
          </Button>
        </p>
      ) : null}
      {!review.isPending && !review.isError && feedback ? (
        <div className="px-5 pt-2 text-sm" role={feedback.failures.length ? "alert" : "status"}>
          <p>
            {feedback.savedKeys.length} of {review.variables?.items.length} review decisions saved.
          </p>
          {feedback.failures.length ? (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {feedback.failures.map((failure) => (
                <li key={failure.key}>
                  {queue.items.find((item) => captureReviewQueueItemKey(item) === failure.key)
                    ?.caption ?? "Screenshot"}
                  : {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {streaming ? (
        <p className="px-5 pt-1 text-xs text-muted-foreground">
          New captures appear here as they finish. Selection does not include later arrivals.
        </p>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-3 px-5 pt-2 text-sm"
        aria-label="Screenshot review filters"
      >
        <button
          type="button"
          aria-pressed={pendingOnly}
          className={`rounded-md border px-2.5 py-1 transition-colors ${pendingOnly ? "border-foreground bg-accent" : "border-border bg-background"}`}
          onClick={() => setPendingOnly((current) => !current)}
        >
          Pending
        </button>
        <label className="flex items-center gap-2">
          By screen
          <select
            aria-label="Filter by screen"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={screen}
            onChange={(event) => setScreen(event.target.value)}
          >
            <option value="">All screens</option>
            {options.screens.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          By device/account
          <select
            aria-label="Filter by device or account"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={place}
            onChange={(event) => setPlace(event.target.value)}
          >
            <option value="">All devices and accounts</option>
            {options.devices.map((value) => (
              <option key={`device:${value}`} value={`device:${value}`}>
                {value}
              </option>
            ))}
            {options.accounts.map((value) => (
              <option key={`account:${value}`} value={`account:${value}`}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!visible?.items.length ? (
        <p role="status" className="p-5 text-sm text-muted-foreground">
          {queue.items.length
            ? "No screenshots match these filters. Try another screen or device, or turn off Pending."
            : streaming
              ? "Waiting for the first planned screenshots. New captures will appear here."
              : "No screenshots are available for this Plan."}
        </p>
      ) : (
        <CaptureReviewPanel
          key={batchId}
          reviewedItemKeys={feedback?.savedKeys}
          queue={visible ?? queue}
          frames={frames}
          selectedIndex={selectedIndex}
          onSelect={(index) => setSelectedKey(captureReviewQueueItemKey(visible.items[index]!))}
          busy={review.isPending}
          showCoverage={false}
          onReview={
            runAcrossService.reviewCaptures
              ? (action, item) => reviewItem(action, [item as PlanCaptureReviewItem])
              : undefined
          }
          onReviewMany={
            runAcrossService.reviewCaptures
              ? (action, items) => reviewItem(action, items as PlanCaptureReviewItem[])
              : undefined
          }
        />
      )}
    </section>
  );
}
