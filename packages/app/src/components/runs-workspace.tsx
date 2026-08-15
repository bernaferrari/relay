import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo, type PersistedRun } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { RunSummary } from "./run-summary";
import { friendlyError, readableFailure } from "../lib/run-failure-presentation";
import { Icon } from "./icon";
import { StatusChip, runOutcomeChip } from "./status-chip";
import { EmptyState } from "./empty-state";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur } from "../lib/job";
import { persistedAsJob } from "../lib/persisted-run";
import { toast } from "../context/toast";
import { nextRovingIndex } from "../lib/roving-focus";
import { eyebrow, mono, productPage } from "../lib/ui";
import { runFrameCanvasItems } from "../lib/frame-canvas-presentation";
import { initialRunReviewStep, runCompletion, runReviewCounts } from "../lib/run-review-model";
import type {
  RunEvidenceQuery,
  VisualComparison as DurableVisualComparison,
  VisualReviewAction,
  VisualReviewDecision,
} from "@relay/protocol";
import { appMapIdForJob, runStopHeadline, runTargetLabel } from "../lib/run-presentation";
import { canApproveVisualBaseline, hasVisualRunFrames } from "../lib/visual-run-readiness";
import { RunLogsEvidence, RunNetworkEvidence, RunPerformanceEvidence } from "./run-evidence-panels";
import { RunBrowser } from "./run-browser";
import { CompatibilityReportPanel } from "./compatibility-report-panel";
import { RunRow, RunStepList } from "./run-list-surfaces";
import { RunReplayStage } from "./run-replay-stage";
import { RunMatrixReview } from "./run-matrix-review";
import { RunShareMenu } from "./run-share-menu";
import { VisualDiffReview } from "./visual-diff-review";
import { RunsRefreshControl } from "./runs-refresh-control";
import { RunChecksPanel } from "./run-checks-panel";
import {
  filterRunRows,
  dedupeLatestRunFlows,
  runsEqualForSelection,
  evidenceTabForChannel,
  findBaselineRun,
  RUN_FILTER_TABS,
  RUN_REPORT_TABS,
  type RunFilterId,
  summarizeRunBatch,
} from "../lib/runs-workspace-helpers";
import {
  isRunMatrixJob,
  projectRunMatrix,
  stepIndexForMatrixCapture,
} from "../lib/run-matrix-review";
import { matrixRetryToast, retryProblemMatrix } from "../lib/run-matrix-retry";

export function RunsWorkspace(props: {
  onOpenMap: (id: string) => void;
  onOpenTest: (id: string) => void;
  onOpenTests: () => void;
}) {
  const server = useServer();
  const workbench = useWorkbench();
  const linkedRun = new URLSearchParams(window.location.search).get("run");
  const [selectedId, setSelectedId] = createSignal<string | null>(linkedRun);
  const [selectedRunStep, setSelectedRunStep] = createSignal(0);
  const [tab, setTab] = createSignal<
    | "timeline"
    | "summary"
    | "visual"
    | "evaluation"
    | "network"
    | "logs"
    | "performance"
    | "matrix"
    | "compatibility"
  >("timeline");
  const [runEvidence, setRunEvidence] = createSignal<RunEvidenceQuery | null>(null);
  const [runEvidenceLoading, setRunEvidenceLoading] = createSignal(false);
  const [runEvidenceRunId, setRunEvidenceRunId] = createSignal<string | null>(null);
  const [durableVisualComparison, setDurableVisualComparison] =
    createSignal<DurableVisualComparison | null>(null);
  const [visualDecision, setVisualDecision] = createSignal<VisualReviewDecision | null>(null);
  const [visualLoading, setVisualLoading] = createSignal(false);
  const [approvingVisualBaseline, setApprovingVisualBaseline] = createSignal(false);
  const [visualPolicyBusy, setVisualPolicyBusy] = createSignal(false);
  const [matrixExporting, setMatrixExporting] = createSignal(false);
  const [openMatrixWhenReady, setOpenMatrixWhenReady] = createSignal(false);
  const [matrixReport, setMatrixReport] = createSignal<
    import("@relay/protocol").CompatibilityReport | null
  >(null);
  const [regressionSignals, setRegressionSignals] = createSignal<
    import("@relay/protocol").RegressionSignal[]
  >([]);
  const [runFilter, setRunFilter] = createSignal<RunFilterId>("all");
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  const requestedDetails = new Set<string>();

  onMount(() => {
    if (linkedRun) void server.loadRunDetail(linkedRun);
  });

  const rows = createMemo(() => {
    const live = server.jobs();
    const liveIds = new Set(live.map((run) => run.id));
    const disk = server
      .persistedRuns()
      .filter((run) => !liveIds.has(run.id))
      .map(persistedAsJob);
    return [...live, ...disk].sort(
      (a, b) => (b.startedAt ?? b.queuedAt) - (a.startedAt ?? a.queuedAt),
    );
  });
  const visibleRows = createMemo(() => {
    const filter = runFilter();
    const filtered = filterRunRows(rows(), filter);
    // The default should answer “what needs review?” rather than repeat the
    // same flow forty times. Full chronology remains one deliberate click
    // away for audit work.
    if (filter !== "all" || historyExpanded()) return filtered;
    return dedupeLatestRunFlows(filtered);
  });
  // Custom equality: `rows()` re-spreads every persisted run into a fresh
  // object on every background poll (persistedAsJob), even when nothing
  // about the run changed. A plain memo would treat each of those as a
  // "new" value, and the <Show when={selected()}>{(job) => ...} panels
  // below would remount from scratch every poll tick — resetting local
  // state like the replay stage's play/pause signal mid-playback. Comparing
  // by the fields that actually indicate a meaningful change keeps the
  // selected run's identity stable across churn while still updating when
  // the run truly changes (e.g. a live run progressing).
  const selected = createMemo(() => rows().find((row) => row.id === selectedId()) ?? null, null, {
    equals: runsEqualForSelection,
  });
  const selectedMatrixRows = createMemo(() => {
    const job = selected();
    if (!job?.batchId || !isRunMatrixJob(job)) return [];
    // Persisted list rows omit frozen inputs until their detail is loaded. Once
    // the selected run proves this is a matrix, include every sibling so the
    // detail-loading effect below can hydrate the complete review.
    return rows().filter((row) => row.batchId === job.batchId);
  });
  const selectedBatchRunCount = createMemo(() => {
    const job = selected();
    if (!job?.batchId) return 1;
    const loaded = rows().filter((row) => row.batchId === job.batchId).length;
    return Math.max(loaded, job.caseCount ?? 1);
  });
  const selectedMatrixReview = createMemo(() => projectRunMatrix(selectedMatrixRows()));
  /**
   * A run report owns its local replay cursor, but when the corresponding
   * test is open it must also advance the shared workbench selection. This
   * keeps a selected report screen, the test outline, and its inspector from
   * drifting into three different ideas of the current step.
   */
  function selectRunStep(index: number): void {
    setSelectedRunStep(index);
    if (server.selectedRecipeId() === selected()?.action) workbench.focusStep(index);
  }
  createEffect(() => {
    const run = selected();
    if (run && !run.steps?.length && !requestedDetails.has(run.id)) {
      requestedDetails.add(run.id);
      void server
        .loadRunDetail(run.id, Boolean(run.persisted))
        .finally(() => requestedDetails.delete(run.id));
    }
    if (run?.evidence) void server.loadRunSignals(run.id).then(setRegressionSignals);
    else setRegressionSignals([]);
  });
  createEffect(() => {
    for (const run of selectedMatrixRows()) {
      const needsDetail =
        (run.frameCount ?? 0) > (run.frames?.length ?? 0) ||
        (!run.matrixCase && !run.artifacts?.length);
      if (!needsDetail || requestedDetails.has(run.id)) continue;
      requestedDetails.add(run.id);
      void server
        .loadRunDetail(run.id, Boolean(run.persisted))
        .finally(() => requestedDetails.delete(run.id));
    }
  });
  createEffect(() => {
    if (!openMatrixWhenReady() || (selectedMatrixReview()?.rows.length ?? 0) < 2) return;
    setTab("matrix");
    setOpenMatrixWhenReady(false);
  });
  createEffect(() => {
    const job = selected();
    if (!job?.persisted) return;
    if (runEvidenceRunId() === job.id && runEvidence()) return;
    setRunEvidence(null);
    setRunEvidenceRunId(job.id);
    setRunEvidenceLoading(true);
    void server
      .loadRunEvidence(job.id, { limit: 500 })
      .then((evidence) => {
        setRunEvidence(evidence);
      })
      .finally(() => setRunEvidenceLoading(false));
  });
  createEffect(() => {
    const job = selected();
    if (tab() !== "visual" || !job?.persisted || !hasVisualRunFrames(job.frames ?? [])) {
      setDurableVisualComparison(null);
      setVisualDecision(null);
      setVisualLoading(false);
      return;
    }
    setVisualLoading(true);
    void server
      .compareVisualRun(job.id)
      .then((durable) => {
        setDurableVisualComparison(durable);
        setVisualDecision(null);
      })
      .finally(() => setVisualLoading(false));
  });
  async function reviewCurrentVisual(action: VisualReviewAction): Promise<void> {
    const job = selected();
    if (!job?.persisted || approvingVisualBaseline()) return;
    const comparison = durableVisualComparison();
    if (!comparison) {
      toast("Visual comparison is not ready yet", "error");
      return;
    }
    setApprovingVisualBaseline(true);
    try {
      const decision = await server.reviewVisualRun(job.id, comparison.id, action);
      if (decision) {
        setVisualDecision(decision);
        if (action === "approve-new-baseline") {
          const durable = await server.compareVisualRun(job.id);
          setDurableVisualComparison(durable);
        }
        const labels: Record<VisualReviewAction, string> = {
          "approve-new-baseline": "Expected look saved",
          "keep-baseline": "Expected look kept",
          "fix-connection": "Path marked for repair",
          retry: "Retry requested",
          "mark-expected-variation": "Expected variation recorded",
        };
        toast(labels[action], "success");
      }
    } finally {
      setApprovingVisualBaseline(false);
    }
  }
  async function reviewDeferredRun(action: "approve" | "reject"): Promise<void> {
    const job = selected();
    if (!job?.persisted || job.review?.status !== "pending") return;
    const review = await server.reviewRun(job.id, action);
    if (review) {
      toast(
        action === "approve" ? "Check marked correct" : "Check left unresolved",
        action === "approve" ? "success" : "info",
      );
    }
  }
  async function updateVisualPolicy(
    regions: import("@relay/protocol").VisualRegion[],
  ): Promise<void> {
    const job = selected();
    const comparison = durableVisualComparison();
    if (!job?.persisted || !comparison || visualPolicyBusy()) return;
    setVisualPolicyBusy(true);
    try {
      const result = await server.runAction("run.visual-policy.update", {
        runId: job.id,
        expectedRevision: comparison.policy.revision,
        changeThreshold: comparison.policy.changeThreshold,
        pixelThreshold: comparison.policy.pixelThreshold,
        regions,
      });
      setDurableVisualComparison(result.comparison);
      toast("Visual review areas updated", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      const refreshed = await server.compareVisualRun(job.id);
      setDurableVisualComparison(refreshed);
    } finally {
      setVisualPolicyBusy(false);
    }
  }
  const openRun = (job: JobInfo) => {
    setSelectedId(job.id);
    server.setSelectedJobId(job.id);
    selectRunStep(initialRunReviewStep(job));
    setOpenMatrixWhenReady(
      Boolean(job.batchId && rows().filter((row) => row.batchId === job.batchId).length > 1),
    );
    setTab(
      job.batchId &&
        rows().filter((row) => row.batchId === job.batchId).length > 1 &&
        isRunMatrixJob(job)
        ? "matrix"
        : "timeline",
    );
    if (!job.steps?.length && !requestedDetails.has(job.id)) {
      requestedDetails.add(job.id);
      void server
        .loadRunDetail(job.id, Boolean(job.persisted))
        .finally(() => requestedDetails.delete(job.id));
    }
  };
  const openMatrixCapture = (job: JobInfo, frameIndex: number) => {
    setSelectedId(job.id);
    server.setSelectedJobId(job.id);
    selectRunStep(stepIndexForMatrixCapture(job, frameIndex));
    setTab("timeline");
  };
  const retryProblemMatrixRuns = async () => {
    const review = selectedMatrixReview();
    if (!review) return;
    const result = await retryProblemMatrix(review, {
      runCurrent: server.runPathAcrossVariables,
      retryFrozen: server.retrySelectedJob,
    });
    if (!result) return;
    toast(matrixRetryToast(result), "success");
  };
  const exportSelectedMatrix = async () => {
    const batchId = selectedMatrixReview()?.batchId;
    if (!batchId || matrixExporting()) return;
    setMatrixExporting(true);
    try {
      const exported = await server.exportMatrixEvidence(batchId);
      await navigator.clipboard?.writeText(exported.rootDir);
      toast("Screenshot pack exported · folder path copied", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setMatrixExporting(false);
    }
  };
  const stopMatrixRuns = async () => {
    const pending = selectedMatrixRows().filter((job) =>
      ["queued", "running", "paused"].includes(job.status),
    );
    for (const job of pending) await server.cancelJob(job.id);
  };
  const reviewCounts = createMemo(() => (selected() ? runReviewCounts(selected()!) : null));
  const selectedRecipe = createMemo(() => {
    const job = selected();
    return job?.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === job?.action);
  });
  const reviewCompletion = createMemo(() =>
    selected() ? runCompletion(selected()!, selectedRecipe()?.steps.length ?? 0) : null,
  );
  const selectedAppMapId = createMemo(() => (selected() ? appMapIdForJob(selected()!) : null));
  const selectedAppMapAvailable = createMemo(() => {
    const id = selectedAppMapId();
    return id ? server.appMaps().some((map) => map.id === id) : false;
  });
  const selectedCanvasItems = createMemo(() => {
    const job = selected();
    if (!job) return [];
    return runFrameCanvasItems({
      job,
      persistedFrameUrl: (run, frame) => server.frameUrlForPersisted(run, frame),
    });
  });
  createEffect(() => {
    const requested = server.selectedJobId();
    if (!requested || !rows().some((row) => row.id === requested)) return;
    // Background polling replaces row objects even when the selected run did
    // not change. Reapplying the external selection here reset the person's
    // evidence tab and step on every poll tick.
    if (selectedId() === requested) return;
    const requestedRun = rows().find((row) => row.id === requested)!;
    setSelectedId(requested);
    selectRunStep(initialRunReviewStep(requestedRun));
    setOpenMatrixWhenReady(
      Boolean(
        requestedRun.batchId &&
        rows().filter((row) => row.batchId === requestedRun.batchId).length > 1,
      ),
    );
    setTab(
      requestedRun.batchId &&
        rows().filter((row) => row.batchId === requestedRun.batchId).length > 1 &&
        isRunMatrixJob(requestedRun)
        ? "matrix"
        : "timeline",
    );
  });
  createEffect(() => {
    const job = selected();
    if (tab() !== "compatibility" || !job?.batchId || !job.targetProfile) {
      setMatrixReport(null);
      return;
    }
    void server.loadCompatibilityReport(job.batchId).then(setMatrixReport);
  });
  const baseline = () => {
    const current = selected();
    if (!current) return null;
    return findBaselineRun(rows(), current);
  };
  const onReportTabKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const currentTarget = event.currentTarget as HTMLButtonElement;
    const tablist = currentTarget.closest<HTMLElement>("[role='tablist']");
    const tabs = [...(tablist?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? [])];
    if (tabs.length === 0) return;
    event.preventDefault();
    const current = tabs.indexOf(currentTarget);
    const next = nextRovingIndex(event.key, current, tabs.length, "horizontal");
    if (next === null) return;
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <section class={cn(selected() ? "flex min-h-0 flex-1 flex-col overflow-hidden" : productPage)}>
      <Show when={!selected()}>
        <div class="mx-auto mb-5 flex max-w-[1080px] items-center justify-between gap-4">
          <div>
            <h2 class="m-0 text-[18px] font-semibold tracking-[-0.02em] text-text-strong">
              Run history
            </h2>
            <p class="mt-0.5 text-[11px] text-text-weak">
              Every path and matrix run, including screenshot evidence.
            </p>
          </div>
          <RunsRefreshControl
            refreshJobs={server.refreshJobs}
            refreshRuns={() => server.refreshRuns()}
            hasSavedResults={rows().length > 0}
          />
        </div>
      </Show>
      <div
        class={cn(
          selected()
            ? tab() === "matrix"
              ? "grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden"
              : "grid min-h-0 min-w-0 flex-1 grid-cols-[216px_minmax(420px,1.35fr)_minmax(390px,0.85fr)] overflow-hidden max-[1180px]:grid-cols-[minmax(360px,1.25fr)_minmax(390px,0.75fr)] max-[700px]:grid-cols-1 max-[700px]:overflow-y-auto"
            : "mx-auto grid w-full max-w-[1080px] min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5",
          !selected() && rows().length === 0 && "place-items-center px-6 py-16",
        )}
      >
        <Show when={!selected()}>
          <div
            class={cn("w-full max-w-none", rows().length === 0 && "max-w-[680px] rounded-[20px]")}
          >
            <Show when={rows().length > 0}>
              <div class="mb-2.5 flex min-h-10 items-center justify-between gap-3">
                <div
                  class="flex items-center gap-1 rounded-[10px] border border-border-weak-base bg-background-stronger p-1"
                  role="tablist"
                  aria-label="Filter runs"
                >
                  {RUN_FILTER_TABS.map(([id, label]) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={runFilter() === id}
                      class={cn(
                        "min-h-7 rounded-md px-3 text-[11.5px] font-medium text-text-weaker transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
                        runFilter() === id
                          ? "bg-surface-base-active text-text-strong"
                          : "hover:bg-surface-base-hover hover:text-text-base",
                      )}
                      onClick={() => setRunFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div class="flex items-center gap-2">
                  <Show when={runFilter() === "all" && rows().length > visibleRows().length}>
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-[10.5px] font-medium text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-base"
                      onClick={() => setHistoryExpanded((expanded) => !expanded)}
                    >
                      {historyExpanded() ? "Latest only" : `All ${rows().length}`}
                    </button>
                  </Show>
                  <span class="font-mono text-[10.5px] text-text-weaker">
                    {visibleRows().length}{" "}
                    {historyExpanded()
                      ? "runs"
                      : visibleRows().length === 1
                        ? "path run"
                        : "path runs"}
                  </span>
                </div>
              </div>
            </Show>
            <For
              each={visibleRows()}
              fallback={
                <Show
                  when={rows().length === 0}
                  fallback={
                    <EmptyState
                      size="sm"
                      icon="search"
                      title={`No ${runFilter()} runs`}
                      secondaryLabel="Show all runs"
                      onSecondary={() => setRunFilter("all")}
                      class="py-14"
                    />
                  }
                >
                  <EmptyState
                    size="lg"
                    icon="wave"
                    title="No runs yet"
                    description="Run a path or matrix from an App Map. Screenshot evidence stays attached to the run that created it."
                    actionLabel="Open maps"
                    onAction={props.onOpenTests}
                    class="py-14"
                  />
                </Show>
              }
            >
              {(job) => {
                return (
                  <RunRow
                    job={job}
                    selected={selectedId() === job.id}
                    batch={summarizeRunBatch(job, rows())}
                    onOpen={() => openRun(job)}
                  />
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={selected() && tab() !== "matrix"}>
          <RunBrowser rows={rows()} selectedId={selectedId()} onSelect={openRun} />
        </Show>
        <Show when={selected()}>
          {(job) => (
            <Show
              when={tab() === "matrix" && selectedMatrixReview()}
              fallback={
                <RunReplayStage
                  job={job()}
                  items={selectedCanvasItems()}
                  evidence={runEvidenceRunId() === job().id ? runEvidence() : null}
                  selectedIndex={selectedRunStep()}
                  onSelect={selectRunStep}
                  onOpenEvidence={(event) => {
                    setTab(evidenceTabForChannel(event.channel));
                  }}
                  onBack={() => {
                    setSelectedId(null);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("run");
                    window.history.replaceState({}, "", url);
                  }}
                />
              }
            >
              {(review) => (
                <RunMatrixReview
                  review={review()}
                  onOpen={openMatrixCapture}
                  onRetryProblems={() => void retryProblemMatrixRuns()}
                  onExport={() => void exportSelectedMatrix()}
                  onClose={() => {
                    setSelectedId(null);
                    const url = new URL(window.location.href);
                    url.searchParams.delete("run");
                    window.history.replaceState({}, "", url);
                  }}
                  exporting={matrixExporting()}
                />
              )}
            </Show>
          )}
        </Show>
        <Show when={tab() !== "matrix" ? selected() : null}>
          {(job) => (
            <aside class="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--border-weak-base)] bg-[var(--background-base)]">
              <header class="grid shrink-0 gap-2.5 px-5 pt-4 pb-3.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="grid min-w-0 gap-1">
                    <span class={eyebrow}>Execution review</span>
                    <strong class="line-clamp-2 text-[20px]/[1.15] font-semibold tracking-[-0.025em] text-text-strong">
                      {job().title ??
                        server.recipes().find((r) => r.id === job().action)?.title ??
                        job().action}
                    </strong>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      class="grid size-8 place-items-center rounded-lg text-text-weaker transition-[background-color,color,transform] duration-150 hover:bg-surface-base-hover hover:text-text-base active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-border-strong-focus"
                      aria-label="Close report"
                      data-tip="Close report"
                      onClick={() => {
                        setSelectedId(null);
                        const url = new URL(window.location.href);
                        url.searchParams.delete("run");
                        window.history.replaceState({}, "", url);
                      }}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <RunShareMenu run={job()} batchRunCount={selectedBatchRunCount()} />
                  <Button
                    variant="secondary"
                    size="sm"
                    class="text-[11px]"
                    disabled={Boolean(selectedAppMapId()) && !selectedAppMapAvailable()}
                    onClick={() => {
                      if (selectedAppMapId() && !selectedAppMapAvailable()) return;
                      server.setSelectedJobId(job().id);
                      const mapId = selectedAppMapId();
                      if (mapId && selectedAppMapAvailable()) props.onOpenMap(mapId);
                      else props.onOpenTest(job().action);
                    }}
                  >
                    <Icon name={selectedAppMapAvailable() ? "edit" : "info"} size={12} />{" "}
                    {selectedAppMapId()
                      ? selectedAppMapAvailable()
                        ? "Open map"
                        : "Map deleted"
                      : "Open test"}
                  </Button>
                  <Show when={job().status === "error" || job().status === "cancelled"}>
                    <Button
                      variant="primary"
                      size="sm"
                      class="text-[11px]"
                      onClick={() => void server.retrySelectedJob(job().id)}
                    >
                      <Icon name="refresh" size={12} /> Retry
                    </Button>
                  </Show>
                  <Show
                    when={
                      job().persisted &&
                      ["ok", "error", "healed", "cancelled"].includes(job().status)
                    }
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      class="text-[11px]"
                      data-tip="Run the exact frozen plan and saved non-private inputs again"
                      onClick={() => void server.replayRecordedRunFromHistory(job().id)}
                    >
                      <Icon name="refresh" size={12} /> Replay recorded plan
                    </Button>
                  </Show>
                  <Show when={["running", "paused"].includes(job().status)}>
                    <Button
                      variant="secondary"
                      size="sm"
                      class="text-[11px]"
                      onClick={() =>
                        void (job().status === "paused"
                          ? server.resumeJob(job().id)
                          : server.pauseJob(job().id))
                      }
                    >
                      <Icon name={job().status === "paused" ? "play" : "pause"} size={12} />
                      {job().status === "paused" ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      class="text-[11px]"
                      onClick={() => void server.cancelJob(job().id)}
                    >
                      <Icon name="square" size={11} /> Stop
                    </Button>
                  </Show>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-text-weak">
                  <StatusChip
                    tone={runOutcomeChip(job()).tone}
                    label={runOutcomeChip(job()).label}
                  />
                  <span class={cn(mono, "text-text-weaker")} data-tip="When this run finished">
                    {fmtAgo(
                      job().finishedAt ?? job().startedAt ?? job().queuedAt,
                      server.clock(),
                    ) || "just now"}
                  </span>
                  <Show when={fmtDur(job(), server.clock())}>
                    <span class={cn(mono, "text-text-weaker")} data-tip="Run duration">
                      {fmtDur(job(), server.clock())}
                    </span>
                  </Show>
                  <span class="inline-flex min-w-0 items-center gap-1.5 text-text-base">
                    <Icon name="smartphone" size={11} class="shrink-0 text-text-weaker" />
                    <span
                      class="truncate"
                      data-tip={job().serial ? `Target identifier: ${job().serial}` : undefined}
                    >
                      {runTargetLabel(job(), server.devices())}
                    </span>
                  </span>
                </div>
              </header>
              <Show when={job().review?.status === "pending"}>
                <div class="mx-4 mb-3 grid gap-3 rounded-xl border border-[color-mix(in_srgb,var(--icon-warning-base)_32%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-warning-base)_7%,transparent)] px-3 py-3">
                  <div class="flex items-start gap-2.5">
                    <span
                      class="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-warning-weak text-[14px] font-semibold text-text-warning-base"
                      aria-hidden="true"
                    >
                      ?
                    </span>
                    <div class="min-w-0">
                      <strong class="block text-[12.5px] font-semibold text-text-strong">
                        Needs your review
                      </strong>
                      <span class="mt-0.5 block text-[11px]/[1.45] text-text-weak">
                        {job().review!.reason}
                      </span>
                      <span class="mt-1 block font-mono text-[10px] text-text-weaker">
                        Capability · {job().review!.capability}
                      </span>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      class="text-[11px]"
                      onClick={() => void reviewDeferredRun("approve")}
                    >
                      <Icon name="check" size={12} /> Mark correct
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      class="text-[11px]"
                      onClick={() => void reviewDeferredRun("reject")}
                    >
                      Keep unresolved
                    </Button>
                  </div>
                </div>
              </Show>
              <Show when={job().review?.status === "approved"}>
                <div class="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-border-success-base/40 bg-surface-success-weak px-3 py-2.5 text-[11px]/[1.4] text-text-success-base">
                  <Icon name="check" size={13} class="mt-0.5 shrink-0" />
                  <span>Marked correct by a reviewer. The original evidence is unchanged.</span>
                </div>
              </Show>
              <Show when={job().review?.status === "rejected"}>
                <div class="mx-4 mb-3 flex items-start gap-2 rounded-xl border border-border-critical-base/40 bg-surface-critical-weak px-3 py-2.5 text-[11px]/[1.4] text-text-critical-base">
                  <Icon name="x" size={13} class="mt-0.5 shrink-0" />
                  <span>
                    This check was not accepted. Fix the capability or add an explicit assertion
                    before relying on it.
                  </span>
                </div>
              </Show>
              <Show when={job().status === "error" || job().status === "cancelled"}>
                <div class="mx-4 mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--icon-critical-base)_28%,var(--border-weak-base))] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)] px-3 py-2.5">
                  <span class="mt-0.5 grid size-6 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] text-[var(--icon-critical-base)]">
                    <Icon name="alert" size={13} />
                  </span>
                  <div class="min-w-0">
                    <strong class="block text-[12.5px] font-semibold text-text-strong">
                      {runStopHeadline({
                        total: reviewCompletion()?.total ?? 0,
                        selectedIndex: initialRunReviewStep(job()),
                        failureLabel: job().failureCategory
                          ? readableFailure(job().failureCategory!, job().error)
                          : "Stopped",
                      })}
                    </strong>
                    <span class="mt-0.5 block text-[11px]/[1.4] text-text-weak">
                      {job().error
                        ? friendlyError(job().error!)
                        : "The relevant evidence is selected. Review the state, then retry or fix the test."}
                    </span>
                  </div>
                </div>
              </Show>
              <nav
                class="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border-weak-base px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                role="tablist"
                aria-label="Run evidence"
              >
                {RUN_REPORT_TABS.map(([id, label]) => (
                  <button
                    type="button"
                    role="tab"
                    id={`run-report-tab-${id}`}
                    aria-controls="run-report-panel"
                    aria-selected={tab() === id}
                    tabindex={tab() === id ? 0 : -1}
                    class={cn(
                      "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-weaker transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-surface-base-hover hover:text-text-base active:scale-[0.97]",
                      tab() === id &&
                        "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base",
                    )}
                    onClick={() => setTab(id)}
                    onKeyDown={onReportTabKeyDown}
                  >
                    {label}
                    {id === "evaluation" && (reviewCounts()?.checks ?? 0) > 0 ? (
                      <span class="min-w-4 rounded-full bg-surface-interactive-weak px-1 text-center text-[11px]/4 text-text-interactive-base">
                        {reviewCounts()!.checks}
                      </span>
                    ) : null}
                    {id === "network" && (reviewCounts()?.network ?? 0) > 0 ? (
                      <span class="min-w-4 rounded-full bg-surface-interactive-weak px-1 text-center text-[11px]/4 text-text-interactive-base">
                        {reviewCounts()!.network}
                      </span>
                    ) : null}
                  </button>
                ))}
                <Show when={selectedMatrixReview() && selectedMatrixRows().length > 1}>
                  <button
                    type="button"
                    role="tab"
                    id="run-report-tab-matrix"
                    aria-controls="run-report-panel"
                    aria-selected={tab() === "matrix"}
                    tabindex={tab() === "matrix" ? 0 : -1}
                    class={cn(
                      "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-weaker transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-surface-base-hover hover:text-text-base active:scale-[0.97]",
                      tab() === "matrix" &&
                        "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base",
                    )}
                    onClick={() => setTab("matrix")}
                    onKeyDown={onReportTabKeyDown}
                  >
                    Matrix
                    <span class="min-w-4 rounded-full bg-surface-interactive-weak px-1 text-center text-[10px]/4 tabular-nums text-text-interactive-base">
                      {selectedMatrixRows().length}
                    </span>
                  </button>
                </Show>
                <Show when={job().batchId && job().targetProfile}>
                  <button
                    type="button"
                    role="tab"
                    id="run-report-tab-compatibility"
                    aria-controls="run-report-panel"
                    aria-selected={tab() === "compatibility"}
                    tabindex={tab() === "compatibility" ? 0 : -1}
                    class={cn(
                      "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-text-weaker transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-surface-base-hover hover:text-text-base active:scale-[0.97]",
                      tab() === "compatibility" &&
                        "bg-surface-raised-stronger-non-alpha text-text-strong shadow-xs-border-base",
                    )}
                    onClick={() => setTab("compatibility")}
                    onKeyDown={onReportTabKeyDown}
                  >
                    Devices
                  </button>
                </Show>
              </nav>
              <div
                id="run-report-panel"
                class="min-h-0 flex-1 overflow-auto p-4"
                role="tabpanel"
                aria-labelledby={`run-report-tab-${tab()}`}
                tabindex={0}
              >
                <Show when={tab() === "timeline"}>
                  <RunStepList
                    job={job()}
                    selectedIndex={selectedRunStep()}
                    onSelect={selectRunStep}
                  />
                </Show>
                <Show when={tab() === "summary"}>
                  <RunSummary
                    job={job()}
                    clock={server.clock()}
                    previous={baseline()}
                    targetLabel={runTargetLabel(job(), server.devices())}
                    onOpenRecipe={(id) => props.onOpenTest(id)}
                  />
                  <Show when={job().evidence}>
                    {(manifest) => (
                      <section class="mt-3 rounded-xl border border-border-weak-base p-3">
                        <strong class="text-[11px] font-semibold text-text-strong">
                          Evidence completeness
                        </strong>
                        <div class="mt-2 flex flex-wrap gap-1.5">
                          {Object.values(manifest().channels).map((channel) => (
                            <span class="rounded-full border border-border-weak-base px-2 py-1 text-[9px] text-text-weak">
                              {channel.channel} · {channel.status}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}
                  </Show>
                  <Show when={regressionSignals().some((signal) => signal.material)}>
                    <section class="mt-3 rounded-xl border border-border-weak-base p-3">
                      <strong class="text-[11px] font-semibold text-text-strong">
                        Material regressions
                      </strong>
                      <div class="mt-2 grid gap-1.5">
                        {regressionSignals()
                          .filter((signal) => signal.material)
                          .map((signal) => (
                            <span class="text-[10px] text-text-weak">
                              {signal.metric.id} · +{signal.delta?.toFixed(0)} {signal.metric.unit}{" "}
                              · baseline {signal.baseline?.median.toFixed(0)} (
                              {signal.baseline?.sampleCount})
                            </span>
                          ))}
                      </div>
                    </section>
                  </Show>
                  <details class="group col-span-2 mt-2 border-t border-border-weak-base">
                    <summary class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 text-[11px]/[1.25] text-text-weaker focus-visible:outline-1 focus-visible:outline-border-strong-focus [&::-webkit-details-marker]:hidden">
                      <span>More details</span>
                      <Icon
                        name="chevron-down"
                        size={13}
                        class="transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <dl class="m-0 grid gap-2 pb-3">
                      <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
                        <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">Run ID</dt>
                        <dd class="m-0 flex min-w-0 items-center gap-1.5">
                          <code class="truncate text-[10px]/[1.25] text-text-weak">{job().id}</code>
                          <button
                            type="button"
                            class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                            aria-label="Copy run ID"
                            onClick={() => void navigator.clipboard?.writeText(job().id)}
                          >
                            <Icon name="copy" size={12} />
                          </button>
                        </dd>
                      </div>
                      <Show when={job().serial}>
                        <div class="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2.5">
                          <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">
                            Device identifier
                          </dt>
                          <dd class="m-0 flex min-w-0 items-center gap-1.5">
                            <code class="truncate text-[10px]/[1.25] text-text-weak">
                              {job().serial}
                            </code>
                            <button
                              type="button"
                              class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                              aria-label="Copy device identifier"
                              onClick={() => void navigator.clipboard?.writeText(job().serial!)}
                            >
                              <Icon name="copy" size={12} />
                            </button>
                          </dd>
                        </div>
                      </Show>
                      <Show when={job().error}>
                        <div class="grid gap-1 border-t border-border-weak-base pt-2.5">
                          <dt class="min-w-0 text-[10px]/[1.25] text-text-weaker">
                            Technical message
                          </dt>
                          <dd class="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-[10px]/[1.45] text-text-weak">
                            {job().error}
                          </dd>
                        </div>
                      </Show>
                    </dl>
                  </details>
                </Show>
                <Show when={tab() === "visual"}>
                  <Show
                    when={job().persisted}
                    fallback={
                      <p class="m-0 rounded-lg border border-border-weak-base px-3 py-3 text-[11px]/[1.45] text-text-weak">
                        This run is still being saved. Visual review becomes available when its
                        evidence is complete.
                      </p>
                    }
                  >
                    <Show
                      when={hasVisualRunFrames(job().frames ?? [])}
                      fallback={
                        <div class="grid gap-1.5 rounded-xl border border-border-weak-base bg-surface-base px-3.5 py-3.5">
                          <strong class="text-[13px] font-semibold text-text-strong">
                            No screens to compare
                          </strong>
                          <p class="m-0 text-[11px]/[1.45] text-text-weak">
                            This run ended before Relay captured a screen. Reconnect the target and
                            retry before creating or comparing a visual baseline.
                          </p>
                        </div>
                      }
                    >
                      <VisualDiffReview
                        comparison={durableVisualComparison()}
                        current={job() as PersistedRun}
                        decision={visualDecision()}
                        loading={visualLoading()}
                        approving={approvingVisualBaseline()}
                        policyBusy={visualPolicyBusy()}
                        baselineApprovalAllowed={canApproveVisualBaseline(
                          job().status,
                          job().frames ?? [],
                        )}
                        onReview={(action) => void reviewCurrentVisual(action)}
                        onPolicyChange={(regions) => void updateVisualPolicy(regions)}
                      />
                    </Show>
                  </Show>
                </Show>
                <Show when={tab() === "network"}>
                  <RunNetworkEvidence evidence={runEvidence()} loading={runEvidenceLoading()} />
                </Show>
                <Show when={tab() === "evaluation"}>
                  <RunChecksPanel
                    job={job()}
                    frameSource={({ frame }) =>
                      frame.base64
                        ? `data:${frame.mime || "image/png"};base64,${frame.base64}`
                        : job().persisted || job().runDir
                          ? server.frameUrlForPersisted(job() as PersistedRun, frame)
                          : ""
                    }
                    onOpenFrame={(index) => {
                      selectRunStep(stepIndexForMatrixCapture(job(), index));
                      setTab("timeline");
                    }}
                  />
                </Show>
                <Show when={tab() === "logs"}>
                  <RunLogsEvidence
                    evidence={runEvidence()}
                    loading={runEvidenceLoading()}
                    orchestrationLogs={job().logs ?? []}
                  />
                </Show>
                <Show when={tab() === "performance"}>
                  <RunPerformanceEvidence evidence={runEvidence()} loading={runEvidenceLoading()} />
                </Show>
                <Show when={tab() === "matrix" && selectedMatrixReview()}>
                  {(review) => (
                    <div class="grid gap-3">
                      <div class="grid gap-1 rounded-xl border border-border-weak-base bg-surface-base px-3 py-3">
                        <strong class="text-[12px] font-semibold text-text-strong">
                          {review().complete} of {review().rows.length} runs complete
                        </strong>
                        <p class="m-0 text-[10.5px]/[1.45] text-text-weak">
                          Select any screenshot in the grid to inspect its exact steps and evidence.
                        </p>
                      </div>
                      <Show when={review().active > 0}>
                        <Button variant="danger" size="sm" onClick={() => void stopMatrixRuns()}>
                          <Icon name="square" size={11} /> Stop remaining runs
                        </Button>
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={tab() === "compatibility"}>
                  <CompatibilityReportPanel
                    report={matrixReport()}
                    selectedProfileId={job().targetProfile?.id ?? ""}
                  />
                </Show>
              </div>
            </aside>
          )}
        </Show>
      </div>
    </section>
  );
}
