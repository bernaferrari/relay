/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureReviewAction, PlanCaptureReviewItem } from "@relay/protocol";
import {
  captureReviewQueueFrameKey,
  filterPlanCaptureReviewQueue,
  parsePlanCaptureReviewFilter,
  planCaptureReviewFilterOptions,
} from "@relay/protocol";
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
}: {
  batchId: string;
  runAcrossService: RunAcrossProductService;
  platform: Platform;
}) {
  const queryClient = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
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
  useEffect(() => {
    setSelectedIndex(0);
  }, [pendingOnly, screen, place]);
  const frames = useMemo(
    () => (visible ? planCaptureFrames(visible.items, platform) : []),
    [visible, platform],
  );
  if (!queue?.items.length) return null;
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
      <h2 className="px-5 pt-4 text-[20px] font-semibold tracking-tight text-foreground">
        Screenshot review
      </h2>
      <p className="px-5 text-sm text-muted-foreground">
        {queue.summary.planned} planned · {queue.summary.captured} captured
        {queue.summary.blocked ? ` · ${queue.summary.blocked} blocked` : ""} ·{" "}
        {queue.summary.accepted} accepted · {queue.summary.issue} issue
        {queue.summary.issue === 1 ? "" : "s"} · {queue.summary.pending} pending · Looks correct
        does not approve a visual baseline.
      </p>
      <div
        className="flex flex-wrap items-center gap-3 px-5 pt-2 text-sm"
        aria-label="Screenshot review filters"
      >
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-3.5 accent-foreground"
            checked={pendingOnly}
            onChange={(event) => setPendingOnly(event.target.checked)}
          />
          Pending
        </label>
        <label className="flex items-center gap-2">
          Screen
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
          Device or account
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
      <CaptureReviewPanel
        queue={visible ?? queue}
        frames={frames}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        busy={review.isPending}
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
    </section>
  );
}
