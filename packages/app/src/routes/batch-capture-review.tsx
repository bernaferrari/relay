import { catalogQueryKeys } from "../data/catalog-queries";
/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureReviewAction, PlanCaptureReviewItem } from "@relay/protocol";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  filterPlanCaptureReviewQueue,
  groupPlanCaptureReviewItems,
  parsePlanCaptureReviewFilter,
  planCaptureReviewFilterOptions,
  planCaptureReviewScreenLabel,
  type PlanCaptureReviewDecision,
} from "@relay/protocol";
import { SelectField } from "../components/filter-select";
import { Button } from "@relay/ui-react/components/button";
import { Progress } from "@relay/ui-react/components/progress";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { AlertTriangle, Play } from "lucide-react";
import { captureReviewFeedback } from "./capture-review-feedback";
import type { RunAcrossProductService } from "../data/run-across-product-service";
import { productClientForPlatform } from "../data/product-client";
import type { Platform } from "../platform/types";
import type { ReportEvidenceItem } from "../data/run-report-model";
import {
  needsReview,
  PlanScreenshotGallery,
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

function readPlanReviewView(batchId: string): {
  selectedKey?: string;
  decision?: PlanCaptureReviewDecision;
  groupBy?: "checkpoint" | "configuration";
  place?: string;
} {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(planReviewViewKey(batchId)) ?? "") as {
      selectedKey?: unknown;
      decision?: unknown;
      groupBy?: unknown;
      place?: unknown;
    };
    return {
      ...(typeof parsed.selectedKey === "string" ? { selectedKey: parsed.selectedKey } : {}),
      ...(parsed.decision === "all" || parsed.decision === "pending" || parsed.decision === "issues"
        ? { decision: parsed.decision }
        : {}),
      ...(parsed.groupBy === "checkpoint" || parsed.groupBy === "configuration"
        ? { groupBy: parsed.groupBy }
        : {}),
      ...(typeof parsed.place === "string" ? { place: parsed.place } : {}),
    };
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
}: {
  batchId: string;
  runAcrossService: RunAcrossProductService;
  platform: Platform;
  streaming?: boolean;
  onInspectProblems?: (caseId?: string) => void;
}) {
  const queryClient = useQueryClient();
  const remembered = readPlanReviewView(batchId);
  const [openKey, setOpenKey] = useState<string | undefined>(remembered.selectedKey);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [decision, setDecision] = useState<PlanCaptureReviewDecision | undefined>(
    remembered.decision,
  );
  const [groupBy, setGroupBy] = useState<"checkpoint" | "configuration">(
    remembered.groupBy ?? "checkpoint",
  );
  const [place, setPlace] = useState(remembered.place ?? "");
  useEffect(() => {
    sessionStorage.setItem(
      planReviewViewKey(batchId),
      JSON.stringify({ selectedKey: openKey, decision, groupBy, place }),
    );
  }, [batchId, openKey, decision, groupBy, place]);
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
  const placeFilter = useMemo(
    () => ({
      ...(place.startsWith("device:") ? { device: place.slice("device:".length) } : {}),
      ...(place.startsWith("account:") ? { account: place.slice("account:".length) } : {}),
    }),
    [place],
  );
  const counts = useMemo(() => {
    const count = (value: PlanCaptureReviewDecision) =>
      queue
        ? filterPlanCaptureReviewQueue(
            queue,
            parsePlanCaptureReviewFilter({ decision: value, ...placeFilter }),
          ).items.length
        : 0;
    return { pending: count("pending"), issues: count("issues"), all: count("all") };
  }, [queue, placeFilter]);
  // Open on what needs attention; fall back to everything once review is done.
  const focus: PlanCaptureReviewDecision =
    decision ?? (counts.pending ? "pending" : counts.issues ? "issues" : "all");
  const visible = useMemo(
    () =>
      queue
        ? filterPlanCaptureReviewQueue(
            queue,
            parsePlanCaptureReviewFilter({ decision: focus, groupBy, ...placeFilter }),
          )
        : undefined,
    [queue, focus, groupBy, placeFilter],
  );
  // Keep steps in the order the Test runs them, whatever the filter hides.
  const groupRank = useMemo(() => {
    const rank = new Map<string, number>();
    if (!queue) return rank;
    const position = new Map<string, number>();
    const runPositions = new Map<string, number>();
    for (const item of filterPlanCaptureReviewQueue(queue).items) {
      const run = item.runId ?? item.executionCaseId ?? "";
      const next = runPositions.get(run) ?? 0;
      runPositions.set(run, next + 1);
      position.set(captureReviewQueueItemKey(item), next);
    }
    groupPlanCaptureReviewItems(filterPlanCaptureReviewQueue(queue).items, groupBy).forEach(
      (group, index) => {
        const step = Math.min(
          ...group.items.map((item) => position.get(captureReviewQueueItemKey(item)) ?? 0),
        );
        rank.set(group.id, groupBy === "checkpoint" ? step * 10_000 + index : index);
      },
    );
    return rank;
  }, [queue, groupBy]);
  const groups = useMemo(
    () =>
      visible
        ? groupPlanCaptureReviewItems(visible.items, groupBy).sort(
            (left, right) => (groupRank.get(left.id) ?? 0) - (groupRank.get(right.id) ?? 0),
          )
        : [],
    [visible, groupBy, groupRank],
  );
  // The viewer walks the gallery in the order people see it.
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const options = useMemo(
    () =>
      queue
        ? planCaptureReviewFilterOptions(queue.items)
        : { screens: [], devices: [], accounts: [] },
    [queue],
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
  useEffect(() => {
    if (viewerOpen && !ordered.some((item) => screenshotKey(item) === openKey)) {
      setViewerOpen(false);
    }
  }, [viewerOpen, ordered, openKey]);
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
    items: PlanCaptureReviewItem[],
    note?: string,
  ) =>
    review
      .mutateAsync({
        action,
        items: items
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
  const placeOptions = [
    ...options.devices.map((value) => ({ value: `device:${value}`, label: value })),
    ...options.accounts.map((value) => ({ value: `account:${value}`, label: value })),
  ];
  const multipleConfigurations = options.devices.length > 1 || options.accounts.length > 1;
  const open = (item: PlanCaptureReviewItem) => {
    setOpenKey(screenshotKey(item));
    setViewerOpen(true);
  };
  const firstPending = ordered.find(needsReview);
  const failures = feedback?.failures ?? [];
  return (
    <section className="mt-6 grid gap-5" aria-labelledby="plan-screenshots-title">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-56 flex-1 gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="plan-screenshots-title" className="sr-only">
              Screenshots
            </h2>
            <p className="text-base font-medium tabular-nums" role="status">
              {reviewable
                ? summary.pending
                  ? `${reviewed} of ${reviewable} reviewed`
                  : `All ${reviewable} reviewed`
                : streaming
                  ? "Waiting for the first screenshots…"
                  : "No screenshots to review"}
              {summary.issue ? (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {summary.issue} with issues
                </span>
              ) : null}
            </p>
          </div>
          {reviewable ? (
            <Progress
              value={(reviewed / reviewable) * 100}
              aria-label="Screenshots reviewed"
              className="h-1 max-w-md"
            />
          ) : null}
        </div>
        {onReview && summary.pending && firstPending ? (
          <Button onClick={() => open(firstPending)}>
            <Play aria-hidden="true" />
            {reviewed ? "Continue reviewing" : "Start reviewing"}
          </Button>
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
              : `${notCaptured} screenshots weren’t captured because their cases didn’t finish.`}{" "}
            <span className="text-muted-foreground">
              Fix the case and run it again to collect it.
            </span>
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

      <div
        className="flex flex-wrap items-center justify-between gap-3"
        aria-label="Screenshot filters"
      >
        <Tabs
          value={focus}
          onValueChange={(value) => setDecision(value as PlanCaptureReviewDecision)}
        >
          <TabsList aria-label="Show">
            <TabsTrigger value="pending">
              To review <Count value={counts.pending} />
            </TabsTrigger>
            <TabsTrigger value="issues">
              Issues <Count value={counts.issues} />
            </TabsTrigger>
            <TabsTrigger value="all">
              All <Count value={counts.all} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {multipleConfigurations ? (
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              compact
              label="Device or account"
              value={place || "__all"}
              onValueChange={(value) => setPlace(value === "__all" ? "" : value)}
              options={[{ value: "__all", label: "All devices and accounts" }, ...placeOptions]}
            />
            <SelectField
              compact
              label="Group screenshots"
              value={groupBy}
              onValueChange={(value) =>
                setGroupBy(value === "configuration" ? "configuration" : "checkpoint")
              }
              options={[
                { value: "checkpoint", label: "Group by step" },
                { value: "configuration", label: "Group by device and account" },
              ]}
            />
          </div>
        ) : null}
      </div>

      {streaming ? (
        <p className="text-xs text-muted-foreground">
          New screenshots appear as each case finishes.
        </p>
      ) : null}

      {groups.length ? (
        <PlanScreenshotGallery
          key={`${focus}:${groupBy}:${place}`}
          groups={groups}
          groupBy={groupBy}
          frames={frames}
          busy={review.isPending}
          savedKeys={feedback?.savedKeys}
          onReview={onReview}
          onOpen={open}
        />
      ) : (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          {focus === "pending" && counts.all
            ? "Nothing left to review."
            : focus === "issues" && counts.all
              ? "No issues reported."
              : queue.items.length
                ? "No screenshots match this filter."
                : streaming
                  ? "Screenshots will appear here as cases finish."
                  : "This Plan didn’t capture any screenshots."}
        </p>
      )}

      <PlanScreenshotViewer
        items={ordered}
        openKey={viewerOpen ? openKey : undefined}
        frames={frames}
        busy={review.isPending}
        onReview={onReview}
        onNavigate={(item) => setOpenKey(screenshotKey(item))}
        onClose={() => setViewerOpen(false)}
        onInspectProblems={onInspectProblems}
      />
    </section>
  );
}

function Count({ value }: { value: number }) {
  return <span className="text-xs tabular-nums text-muted-foreground">{value}</span>;
}
