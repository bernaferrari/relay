import { catalogQueryKeys } from "../data/catalog-queries";
/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureReviewAction, PlanCaptureReviewItem } from "@relay/protocol";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  filterPlanCaptureReviewQueue,
  planCaptureReviewScreenLabel,
} from "@relay/protocol";
import { Button } from "@relay/ui-react/components/button";
import { Progress } from "@relay/ui-react/components/progress";
import { AlertTriangle, CheckCheck, Play } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@relay/ui-react/components/popover";
import { captureReviewFeedback } from "./capture-review-feedback";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { productClientForPlatform } from "../data/product-client";
import type { Platform } from "../platform/types";
import type { ReportEvidenceItem } from "../data/run-report-model";
import {
  configurationLabel,
  journeyLayout,
  needsReview,
  PlanScreenshotJourney,
  PlanScreenshotViewer,
  screenshotKey,
} from "./plan-screenshot-review";

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

function planReviewViewKey(batchId: string): string {
  return `relay.plan-review.${batchId}`;
}

function readPlanReviewView(batchId: string): { selectedKey?: string } {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(planReviewViewKey(batchId)) ?? "") as {
      selectedKey?: unknown;
    };
    return typeof parsed.selectedKey === "string" ? { selectedKey: parsed.selectedKey } : {};
  } catch {
    return {};
  }
}

export function PlanCaptureReviewSection({
  batchId,
  runAcrossService,
  platform,
  streaming = false,
  onInspectProblems,
  caseLabels = {},
}: {
  batchId: string;
  runAcrossService: RunAcrossProductService;
  platform: Platform;
  streaming?: boolean;
  onInspectProblems?: (caseId?: string) => void;
  /** Human case names keyed by Run id or case id. */
  caseLabels?: Readonly<Record<string, string>>;
}) {
  const queryClient = useQueryClient();
  const [openKey, setOpenKey] = useState<string | undefined>(
    () => readPlanReviewView(batchId).selectedKey,
  );
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    sessionStorage.setItem(planReviewViewKey(batchId), JSON.stringify({ selectedKey: openKey }));
  }, [batchId, openKey]);
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
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    // The last polling response can precede the final Run's durable evidence.
    // Fetch once at completion before stopping, rather than retaining that partial queue.
    if (finished && runAcrossService.getCaptureReview) void captures.refetch();
  }, [streaming, captures.refetch, runAcrossService.getCaptureReview]);
  const review = useMutation({
    mutationFn: (input: {
      action: CaptureReviewAction;
      items: Array<{
        runId: string;
        captureId: string;
        imageSha256?: string;
        expectedReviewVersion?: number;
      }>;
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
  const items = useMemo(() => (queue ? filterPlanCaptureReviewQueue(queue).items : []), [queue]);
  const caseLabel = (item: PlanCaptureReviewItem, index?: number) =>
    (item.runId && caseLabels[item.runId]) ||
    (item.executionCaseId && caseLabels[item.executionCaseId]) ||
    configurationLabel(item, items) ||
    `Case ${(index ?? 0) + 1}`;
  const layout = useMemo(
    () => journeyLayout(items, caseLabel),
    // caseLabel is derived from these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, caseLabels],
  );
  const feedback = useMemo(
    () =>
      review.data && review.variables
        ? captureReviewFeedback(review.variables.items, review.data.results)
        : undefined,
    [review.data, review.variables],
  );
  const frames = useMemo(
    () => (queue ? planCaptureFrames(queue.items, platform) : []),
    [queue, platform],
  );
  if (!runAcrossService.getCaptureReview) return null;
  if (!queue)
    return (
      <section className="mt-6" aria-label="Screenshot review">
        {captures.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
            <p>Screenshots couldn’t be loaded. {captures.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={captures.isFetching}
              onClick={() => void captures.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading screenshots…
          </p>
        )}
      </section>
    );
  const reviewItems = (
    action: CaptureReviewAction,
    targets: PlanCaptureReviewItem[],
    note?: string,
  ) =>
    review
      .mutateAsync({
        action,
        items: targets
          .filter((item): item is PlanCaptureReviewItem & { runId: string } => Boolean(item.runId))
          .map((item) => ({
            runId: item.runId,
            captureId: item.captureId,
            ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
            ...(item.reviewVersion !== undefined
              ? { expectedReviewVersion: item.reviewVersion }
              : {}),
            ...(note ? { note } : {}),
          })),
      })
      .then((result) => result.results.every((entry) => entry.status === "applied"))
      .catch(() => false);
  const onReview = runAcrossService.reviewCaptures ? reviewItems : undefined;
  const summary = queue.summary;
  const reviewable = summary.planned - summary.missing - summary.blocked;
  const reviewed = Math.max(0, reviewable - summary.pending);
  const notCaptured = summary.missing + summary.blocked;
  const pending = layout.ordered.filter(needsReview);
  const open = (item: PlanCaptureReviewItem) => {
    setOpenKey(screenshotKey(item));
    setViewerOpen(true);
  };
  const failures = feedback?.failures ?? [];
  return (
    <section className="mt-6 grid gap-5" aria-labelledby="plan-screenshots-title">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-56 flex-1 gap-2">
          <h2 id="plan-screenshots-title" className="sr-only">
            Screenshots
          </h2>
          <p className="text-base font-medium tabular-nums" role="status">
            {reviewable
              ? summary.pending
                ? `${reviewed} of ${reviewable} screenshots reviewed`
                : `All ${reviewable} screenshots reviewed`
              : streaming
                ? "Waiting for the first screenshots…"
                : "No screenshots to review"}
            {summary.issue ? (
              <span className="font-normal text-destructive"> · {summary.issue} with issues</span>
            ) : null}
          </p>
          {reviewable ? (
            <Progress
              value={(reviewed / reviewable) * 100}
              aria-label="Screenshots reviewed"
              className="h-1 max-w-md"
            />
          ) : null}
        </div>
        {onReview && pending.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmMarkAll
              count={pending.length}
              disabled={review.isPending}
              onConfirm={() => void onReview("accept", pending)}
            />
            <Button onClick={() => open(pending[0]!)}>
              <Play aria-hidden="true" />
              {reviewed ? "Continue reviewing" : "Review one by one"}
            </Button>
          </div>
        ) : null}
      </header>

      {!streaming && notCaptured ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning-foreground" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            {notCaptured === 1
              ? "1 screenshot wasn’t captured because its case didn’t finish."
              : `${notCaptured} screenshots weren’t captured because their cases didn’t finish.`}
          </p>
          {onInspectProblems ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onInspectProblems(
                  queue.items.find((item) => item.status === "missing" || item.blocked)
                    ?.executionCaseId,
                )
              }
            >
              See what went wrong
            </Button>
          ) : null}
        </div>
      ) : null}

      {captures.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <p>Showing saved results. New screenshots couldn’t be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            disabled={captures.isFetching}
            onClick={() => void captures.refetch()}
          >
            Refresh
          </Button>
        </div>
      ) : null}
      {review.isError || failures.length ? (
        <div role="alert" className="grid gap-1 rounded-lg bg-destructive/10 px-4 py-3 text-sm">
          <p>
            {review.isError
              ? "Your decision wasn’t saved."
              : `${failures.length} of ${review.variables?.items.length} decisions weren’t saved.`}{" "}
            {failures.some((failure) => failure.status === "conflict")
              ? "Someone else reviewed these screenshots first — refresh to see their decision."
              : "Refresh and try again."}
          </p>
          {failures.length ? (
            <ul className="list-disc pl-5 text-muted-foreground">
              {failures.map((failure) => (
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
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={captures.isFetching}
            onClick={() => void captures.refetch()}
          >
            Refresh screenshots
          </Button>
        </div>
      ) : null}

      {layout.rows.length ? (
        <PlanScreenshotJourney
          rows={layout.rows}
          columns={layout.columns}
          frames={frames}
          busy={review.isPending}
          onReview={onReview}
          onOpen={open}
        />
      ) : (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          {streaming
            ? "Screenshots will appear here as cases finish."
            : "This Plan didn’t capture any screenshots."}
        </p>
      )}
      {streaming && layout.rows.length ? (
        <p className="text-xs text-muted-foreground">
          New screenshots appear as each case finishes.
        </p>
      ) : null}

      <PlanScreenshotViewer
        items={layout.ordered}
        openKey={viewerOpen ? openKey : undefined}
        frames={frames}
        busy={review.isPending}
        onReview={onReview}
        caseLabel={(item) => caseLabel(item)}
        onNavigate={(item) => setOpenKey(screenshotKey(item))}
        onClose={() => setViewerOpen(false)}
        onInspectProblems={onInspectProblems}
      />
    </section>
  );
}

/** Approving every pending screenshot is one decision per screenshot, so it
 * asks once before saving instead of acting on a single stray click. */
function ConfirmMarkAll({
  count,
  disabled,
  onConfirm,
}: {
  count: number;
  disabled: boolean;
  onConfirm(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" disabled={disabled} />}>
        <CheckCheck aria-hidden="true" />
        Mark all {count} correct
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>
            Mark {count} {count === 1 ? "screenshot" : "screenshots"} correct?
          </PopoverTitle>
          <PopoverDescription>
            Each one is saved as reviewed without opening it. You can still report an issue on any
            of them later.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Mark {count} correct
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
