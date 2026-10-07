import { catalogQueryKeys } from "../data/catalog-queries";
/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CaptureReviewAction, PlanCaptureReviewItem } from "@relay/protocol";
import {
  captureReviewQueueFrameKey,
  captureReviewQueueItemKey,
  filterPlanCaptureReviewQueue,
  formatCaptureReviewCoverageSummary,
  groupPlanCaptureReviewItems,
  parsePlanCaptureReviewFilter,
  planCaptureReviewFilterOptions,
  planCaptureReviewScreenLabel,
  type PlanCaptureReviewDecision,
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

function planReviewViewKey(batchId: string): string {
  return `relay.plan-review.${batchId}`;
}

function readPlanReviewView(batchId: string): {
  selectedKey?: string;
  decision?: PlanCaptureReviewDecision;
  groupBy?: "checkpoint" | "configuration";
  screen?: string;
  place?: string;
} {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(planReviewViewKey(batchId)) ?? "") as {
      selectedKey?: unknown;
      decision?: unknown;
      groupBy?: unknown;
      screen?: unknown;
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
      ...(typeof parsed.screen === "string" ? { screen: parsed.screen } : {}),
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
  const [selectedKey, setSelectedKey] = useState<string | undefined>(remembered.selectedKey);
  const [decision, setDecision] = useState<PlanCaptureReviewDecision>(remembered.decision ?? "all");
  const [groupBy, setGroupBy] = useState<"checkpoint" | "configuration">(
    remembered.groupBy ?? "checkpoint",
  );
  const [screen, setScreen] = useState(remembered.screen ?? "");
  const [place, setPlace] = useState(remembered.place ?? "");
  useEffect(() => {
    sessionStorage.setItem(
      planReviewViewKey(batchId),
      JSON.stringify({ selectedKey, decision, groupBy, screen, place }),
    );
  }, [batchId, selectedKey, decision, groupBy, screen, place]);
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
  const filter = useMemo(
    () =>
      parsePlanCaptureReviewFilter({
        decision,
        groupBy,
        screen: screen || undefined,
        ...(place.startsWith("device:") ? { device: place.slice("device:".length) } : {}),
        ...(place.startsWith("account:") ? { account: place.slice("account:".length) } : {}),
      }),
    [decision, groupBy, screen, place],
  );
  const visible = useMemo(
    () => (queue ? filterPlanCaptureReviewQueue(queue, filter) : undefined),
    [queue, filter],
  );
  useEffect(() => {
    if (!visible?.items.length) return;
    if (
      selectedKey &&
      visible.items.some((item) => captureReviewQueueItemKey(item) === selectedKey)
    )
      return;
    const first = visible.items[0];
    if (first) setSelectedKey(captureReviewQueueItemKey(first));
  }, [selectedKey, visible]);
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
  const reviewItem = (action: CaptureReviewAction, items: PlanCaptureReviewItem[], note?: string) =>
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
      .then((result) => result.results.every((entry) => entry.status === "applied"));
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
        {queue.summary.issue ? <span>{queue.summary.issue} reported issues</span> : null}
        {queue.summary.needMoreEvidence ? (
          <span>{queue.summary.needMoreEvidence} need more evidence</span>
        ) : null}
      </div>
      {queue.summary.pending ? (
        <p className="text-sm leading-6 text-foreground">
          Open each unreviewed screenshot, then choose Looks correct, Report issue, or Need more
          evidence. Looks correct reviews this Run only; Use as reference also affects future Runs.
        </p>
      ) : null}
      {!streaming && (queue.summary.missing || queue.summary.blocked) ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <p className="max-w-prose leading-6">
            {queue.summary.missing
              ? `${queue.summary.missing} screenshot${queue.summary.missing === 1 ? " was" : "s were"} not captured. `
              : ""}
            {queue.summary.blocked ? `${queue.summary.blocked} could not be captured. ` : ""}
            Check the affected case, fix its setup or Test, then run it again. Missing screenshots
            cannot be approved.
          </p>
          {onInspectProblems ? (
            <Button
              variant="outline"
              onClick={() =>
                onInspectProblems(
                  queue.items.find((item) => item.status === "missing" || item.blocked)
                    ?.executionCaseId,
                )
              }
            >
              Review affected cases
            </Button>
          ) : null}
        </div>
      ) : null}
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
          {feedback.failures.some((failure) => failure.status === "conflict") ? (
            <p>
              {feedback.failures.filter((failure) => failure.status === "conflict").length}{" "}
              conflicted — review the newer decision
            </p>
          ) : null}
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
        <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Review focus">
          {(
            [
              ["all", "All"],
              ["pending", "Pending"],
              ["issues", "Issues"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              aria-pressed={decision === value}
              variant={decision === value ? "secondary" : "ghost"}
              onClick={() => setDecision(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Screenshot grouping">
          {(
            [
              ["checkpoint", "By checkpoint"],
              ["configuration", "By configuration"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              aria-pressed={groupBy === value}
              variant={groupBy === value ? "secondary" : "ghost"}
              onClick={() => setGroupBy(value)}
            >
              {label}
            </Button>
          ))}
        </div>
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
            ? "No screenshots match these filters. Try another screen, device, or review focus."
            : streaming
              ? "Waiting for the first planned screenshots. New captures will appear here."
              : "No screenshots are available for this Plan."}
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2" aria-label="Screenshot groups">
            {groupPlanCaptureReviewItems(visible.items, groupBy).map((group) => (
              <span
                key={group.id}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                {group.label}
                <span className="ms-1 tabular-nums">{group.items.length}</span>
              </span>
            ))}
          </div>
          <CaptureReviewPanel
            key={batchId}
            reviewedItemKeys={feedback?.savedKeys}
            queue={visible ?? queue}
            frames={frames}
            selectedIndex={visible.items.findIndex(
              (item) => captureReviewQueueItemKey(item) === selectedKey,
            )}
            onSelect={(index) => setSelectedKey(captureReviewQueueItemKey(visible.items[index]!))}
            busy={review.isPending}
            showCoverage={false}
            onReview={
              runAcrossService.reviewCaptures
                ? (action, item, note) => reviewItem(action, [item as PlanCaptureReviewItem], note)
                : undefined
            }
            onReviewMany={
              runAcrossService.reviewCaptures
                ? (action, items, note) =>
                    reviewItem(action, items as PlanCaptureReviewItem[], note)
                : undefined
            }
          />
        </div>
      )}
      <details className="pt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer">Coverage and review details</summary>
        <p className="mt-2">{formatCaptureReviewCoverageSummary(queue.summary)}</p>
        <p className="mt-1">
          Looks correct reviews this capture. Accept as reference also governs later Runs.
        </p>
      </details>
    </section>
  );
}
