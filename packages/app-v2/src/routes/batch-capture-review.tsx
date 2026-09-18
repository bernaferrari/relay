import { catalogQueryKeys } from "../data/catalog-queries";
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
  planCaptureReviewScreenLabel,
} from "@relay/protocol";
import { SelectField } from "../components/filter-select";
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
    if (!item.runId || !item.framePath || !FRAME_FILE.test(item.framePath)) return [];
    const path = `/runs/${encodeURIComponent(item.runId)}/${item.framePath}`;
    const id = captureReviewQueueFrameKey(item);
    if (!id) return [];
    return [
      {
        id,
        title: planCaptureReviewScreenLabel(item),
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
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["run-across", "batch", batchId, "capture-review"],
        }),
        queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs }),
      ]),
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
        <h2 className="text-base font-semibold">Screenshot review</h2>
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
      items: items
        .filter((item): item is PlanCaptureReviewItem & { runId: string } => Boolean(item.runId))
        .map((item) => ({
          runId: item.runId,
          captureId: item.captureId,
          ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
        })),
    });
  };
  return (
    <section className="mt-4 grid gap-4">
      <h2 className="sr-only">Screenshot review</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums text-muted-foreground">
        <span>
          {queue.summary.captured} of {queue.summary.planned} screenshots captured
        </span>
        <span>{queue.summary.pending} to review</span>
        {queue.summary.missing ? <span>{queue.summary.missing} missing</span> : null}
        {queue.summary.blocked ? <span>{queue.summary.blocked} blocked</span> : null}
        {queue.summary.accepted ? <span>{queue.summary.accepted} reviewed as correct</span> : null}
      </div>
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
                  {planCaptureReviewScreenLabel(
                    queue.items.find((item) => captureReviewQueueItemKey(item) === failure.key) ?? {
                      caption: "Screenshot",
                    },
                  )}
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
      <div className="flex flex-wrap items-center gap-2" aria-label="Screenshot review filters">
        <Button
          variant={pendingOnly ? "secondary" : "outline"}
          aria-pressed={pendingOnly}
          onClick={() => setPendingOnly((current) => !current)}
        >
          Pending
        </Button>
        <SelectField
          compact
          label="Filter by screen"
          value={screen || "__all"}
          onValueChange={(value) => setScreen(value === "__all" ? "" : value)}
          options={[
            { value: "__all", label: "All screens" },
            ...options.screens.map((value) => ({
              value,
              label: value.startsWith("step:")
                ? value.split(":").slice(2).join(":") || "Checkpoint"
                : value,
            })),
          ]}
        />
        <SelectField
          compact
          label="Filter by device or account"
          value={place || "__all"}
          onValueChange={(value) => setPlace(value === "__all" ? "" : value)}
          options={[
            { value: "__all", label: "All devices and accounts" },
            ...options.devices.map((value) => ({ value: `device:${value}`, label: value })),
            ...options.accounts.map((value) => ({ value: `account:${value}`, label: value })),
          ]}
        />
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
      <details className="pt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">Coverage and review details</summary>
        <p className="mt-2">{formatCaptureReviewCoverageSummary(queue.summary)}</p>
        <p className="mt-1">Looks correct does not approve a visual baseline.</p>
      </details>
    </section>
  );
}
