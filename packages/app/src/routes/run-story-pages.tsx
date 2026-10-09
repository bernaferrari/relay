import { RunTestLink } from "./run-test-link";
import { Tabs } from "@relay/ui-react/components/tabs";
import { RunViewTabs } from "../components/run-view-tabs";
/** @jsxImportSource react */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { ChevronLeft, Eye, LoaderCircle, Play, Square } from "lucide-react";
import type { CaptureReviewAction, CaptureReviewItem } from "@relay/protocol";
import type { ProductRunReportOverview } from "../data/run-report-model";
import type { RunProductService } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { catalogQueryKeys } from "../data/catalog-queries";
import { formatDuration, storyFromJob, storyFromReport } from "../data/run-story";
import { RunStoryView, type RunStoryStatus } from "./run-story";
import { RunStoryFailure } from "./run-story-failure";
import { LiveNativeRunPreview } from "./live-native-run-preview";
import type { ProductRunState } from "../data/run-product-service";
import { buildRunScreenJourney } from "../data/run-screen-journey";
import { RunScreenJourney } from "./run-screen-journey";

function savedStatus(report: ProductRunReportOverview): RunStoryStatus {
  if (report.outcome === "cancelled") return "cancelled";
  if (report.outcome && report.outcome !== "passed") return "failed";
  if (report.captureReview?.items.some((item) => item.status === "issue")) return "failed";
  if (report.captureReview?.items.some((item) => item.status === "pending")) return "review";
  return "passed";
}

/** A finished Run: what happened, step by step, next to the screen. */
export function SavedRunStory({
  header,
  report,
  testId,
  runService,
  onViewChange,
  onInspectFailure,
  extraActions,
  summary,
  notice,
}: {
  header?: React.ReactNode;
  report: ProductRunReportOverview;
  testId?: string;
  runService: RunProductService;
  onViewChange(view: string): void;
  onInspectFailure?(traceStepId?: string): void;
  extraActions?: React.ReactNode;
  summary?: React.ReactNode;
  notice?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const test = useQuery({
    queryKey: runQueryKeys.test(testId ?? "none"),
    queryFn: () => runService.getTest(testId!),
    enabled: Boolean(testId),
    staleTime: 60_000,
    retry: false,
  });
  const stepTitles: Record<string, string> = {};
  const visit = (
    steps:
      | readonly { id: string; intent: string; label?: string; children?: readonly unknown[] }[]
      | undefined,
  ) => {
    for (const step of steps ?? []) {
      stepTitles[step.id] = step.label?.trim() || step.intent;
      visit(step.children as typeof steps);
    }
  };
  visit(test.data?.steps);
  const steps = storyFromReport({
    timeline: report.traceSteps?.length ? report.traceSteps : report.timeline,
    ...(report.stepEvidence ? { stepEvidence: report.stepEvidence } : {}),
    stepTitles,
  });
  // Older reports carry screenshots only as inline evidence; show those too.
  const inline = new Map<string, string>();
  const evidenceShots = report.evidence
    .filter((section) => section.id === "screenshot")
    .flatMap((section) => section.items)
    .filter((item) => item.media?.src);
  for (const item of evidenceShots) {
    inline.set(`evidence:${item.id}`, item.media!.src);
    // Frame ids and evidence ids are the same path when the report embeds frames.
    if (item.media!.src.startsWith("data:")) inline.set(item.id, item.media!.src);
  }
  if (
    evidenceShots.length &&
    !steps.some((step) => step.actions.some((action) => action.framePath))
  ) {
    steps.push({
      id: "screenshots",
      title: "Screenshots",
      state: "passed",
      actions: evidenceShots.map((item) => ({
        id: `evidence:${item.id}`,
        kind: "screenshot" as const,
        label: item.title,
        state: "passed" as const,
        framePath: `evidence:${item.id}`,
      })),
    });
  }
  const captures = report.captureReview?.items ?? [];
  const pending = captures.filter((item) => item.status === "pending").length;
  // Show the failed step with its check or repair action.
  const failedIndex = steps.findIndex((step) => step.state === "failed");
  const failedStep = failedIndex >= 0 ? steps[failedIndex] : undefined;
  const failedAction = failedStep?.actions.find((action) => action.state === "failed");
  const fixable = Boolean(testId && failedStep && stepTitles[failedStep.id]);
  const failureCard = failedStep ? (
    <RunStoryFailure
      step={failedStep}
      action={failedAction}
      stepNumber={failedIndex + 1}
      report={report}
      onInspectEvidence={() =>
        onInspectFailure ? onInspectFailure(failedAction?.id) : onViewChange("steps")
      }
      {...(fixable ? { testId: testId! } : {})}
    />
  ) : null;
  const review = async (item: CaptureReviewItem, action: CaptureReviewAction) => {
    await runService.reviewCapture?.({
      runId: report.runId,
      captureId: item.captureId,
      action,
      ...(item.imageSha256 ? { imageSha256: item.imageSha256 } : {}),
      ...(item.reviewVersion !== undefined ? { expectedReviewVersion: item.reviewVersion } : {}),
    });
    void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs });
    void queryClient.invalidateQueries({ queryKey: ["review", "inbox"] });
    await queryClient.invalidateQueries({ queryKey: runQueryKeys.report(report.runId) });
  };
  return (
    <RunStoryView
      header={header}
      navigation={
        <Tabs value="story" onValueChange={onViewChange} className="shrink-0 gap-0">
          <RunViewTabs report={report} value="story" onSelect={onViewChange} />
        </Tabs>
      }
      runId={report.runId}
      status={savedStatus(report)}
      title={report.title}
      meta={[report.targetName, formatDuration(report.durationMs)]}
      steps={steps}
      captures={captures}
      frameSource={(path) => inline.get(path)}
      {...(runService.loadFrame
        ? { loadFrame: (path: string) => runService.loadFrame!(report.runId, path) }
        : {})}
      {...(runService.reviewCapture ? { onReview: review } : {})}
      crumbs={<RunTestLink testId={testId} />}
      {...(summary ? { summary } : {})}
      {...(notice || failureCard
        ? {
            notice: (
              <>
                {failureCard}
                {notice}
              </>
            ),
          }
        : {})}
      actions={
        <>
          {extraActions ??
            (testId ? (
              <Button
                nativeButton={false}
                size="sm"
                render={<Link to="/tests/$testId" params={{ testId }} search={{ setup: "run" }} />}
              >
                <Play aria-hidden="true" /> Run again
              </Button>
            ) : null)}
          {pending ? (
            <Button nativeButton={false} size="sm" variant="outline" render={<Link to="/review" />}>
              <Eye aria-hidden="true" /> Review {pending}
            </Button>
          ) : null}
        </>
      }
    />
  );
}

/** A Run in progress: steps stream in, the screen follows the newest frame. */
export function LiveRunStory({
  jobId,
  title,
  targetName,
  target,
  embedded = false,
  runService,
  onCancel,
  cancelling,
}: {
  jobId: string;
  title: string;
  targetName?: string;
  target?: NonNullable<ProductRunState["snapshot"]>["target"];
  embedded?: boolean;
  runService: RunProductService;
  onCancel?(): void;
  cancelling?: boolean;
}) {
  const job = useQuery({
    queryKey: ["run", "live-job", jobId],
    queryFn: () => runService.liveJob!(jobId),
    enabled: typeof runService.liveJob === "function",
    refetchInterval: 1_000,
    staleTime: 0,
  });
  const story = storyFromJob(job.data ?? {});
  const startedAt = typeof job.data?.startedAt === "number" ? job.data.startedAt : undefined;
  return (
    <RunStoryView
      status="running"
      embedded={embedded}
      runId={jobId}
      title={title}
      meta={[targetName, startedAt ? formatDuration(Date.now() - startedAt) : undefined]}
      steps={story.steps}
      outlineHeader={<RunScreenJourney journey={buildRunScreenJourney(job.data ?? {})} />}
      {...(target && (target.platform === "android" || target.platform === "ios")
        ? {
            livePreview: (fallback: React.ReactNode) => (
              <LiveNativeRunPreview
                target={target as { platform: "android" | "ios"; targetId: string }}
                {...(targetName ? { targetName } : {})}
                fallback={fallback}
              />
            ),
          }
        : {})}
      {...(story.latestFrame ? { latestFrame: story.latestFrame } : {})}
      {...(runService.loadLiveFrame
        ? { loadFrame: (path: string) => runService.loadLiveFrame!(jobId, path) }
        : {})}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {job.isError || (job.isFetched && !job.data) ? "Live steps unavailable" : "Running"}
          </span>
          {onCancel ? (
            <Button size="sm" variant="outline" onClick={onCancel} disabled={cancelling}>
              <Square aria-hidden="true" /> {cancelling ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
