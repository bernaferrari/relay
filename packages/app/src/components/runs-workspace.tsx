import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import {
  useServer,
  type JobInfo,
  type PersistedRun,
  type VisualComparison,
} from "../context/server";
import { useWorkbench } from "../context/workbench";
import { RunSummary, friendlyError, readableFailure } from "./run-summary";
import { Icon, type IconName } from "./icon";
import { StatusChip, jobStatusChip } from "./status-chip";
import { ActionIconTrail } from "./action-icon-trail";
import { EmptyState } from "./empty-state";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
import { persistedAsJob } from "../lib/persisted-run";
import { toast } from "../context/toast";
import { presentTarget } from "../lib/target-presentation";
import { nextRovingIndex } from "../lib/roving-focus";
import {
  eyebrow,
  mono,
  productPrimary,
  productSecondary,
  productPage,
  productStatus,
  tabUnderline,
  tabUnderlineActive,
} from "../lib/ui";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import { kindIcon, kindLabel } from "./step-list-metadata";
import { runFrameCanvasItems, type FrameCanvasItem } from "../lib/frame-canvas-presentation";
import {
  executionMoments,
  executionStateLabel,
  stepGlyph,
  type ExecutionMomentState,
} from "../lib/execution-moments";
import { ExecutionTimeline } from "./execution-timeline";
import { RunGraph } from "./run-graph";
import { VisualDiffReview } from "./visual-diff-review";
import {
  initialRunReviewStep,
  runCompletion,
  runElapsedAtStep,
  runReviewCounts,
} from "../lib/run-review-model";
import {
  deriveReviewCut,
  nextReviewSourceMs,
  reviewTimeToSourceMs,
  sourceTimeToReviewMs,
} from "../lib/review-cut";
import { seg, segBtn, segBtnOn } from "../lib/ui";

export function RunsWorkspace(props: {
  onOpenRecipe: (id: string) => void;
  onOpenTests: () => void;
}) {
  const server = useServer();
  const workbench = useWorkbench();
  const linkedRun = new URLSearchParams(window.location.search).get("run");
  const [selectedId, setSelectedId] = createSignal<string | null>(linkedRun);
  const [selectedRunStep, setSelectedRunStep] = createSignal(0);
  const [tab, setTab] = createSignal<
    "timeline" | "summary" | "visual" | "evaluation" | "network" | "logs" | "compatibility"
  >("timeline");
  const [visualComparison, setVisualComparison] = createSignal<VisualComparison | null>(null);
  const [visualLoading, setVisualLoading] = createSignal(false);
  const [approvingVisualBaseline, setApprovingVisualBaseline] = createSignal(false);
  const [matrixReport, setMatrixReport] = createSignal<
    import("@relay/protocol").CompatibilityReport | null
  >(null);
  const [regressionSignals, setRegressionSignals] = createSignal<
    import("@relay/protocol").RegressionSignal[]
  >([]);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runFilter, setRunFilter] = createSignal<"all" | "passed" | "attention" | "active">("all");
  const [historyExpanded, setHistoryExpanded] = createSignal(false);
  const requestedDetails = new Set<string>();
  async function refreshRuns(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      await withRefreshFeedback(async () => {
        await server.refreshJobs();
        await server.refreshRuns();
      });
    } finally {
      setRefreshing(false);
    }
  }
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
    const filtered =
      filter === "passed"
        ? rows().filter((row) => row.status === "ok" || row.status === "healed")
        : filter === "attention"
          ? rows().filter((row) => row.status === "error" || row.status === "cancelled")
          : filter === "active"
            ? rows().filter((row) => ["queued", "running", "paused"].includes(row.status))
            : rows();
    // The default should answer “what needs review?” rather than repeat the
    // same journey forty times. Full chronology remains one deliberate click
    // away for audit work.
    if (filter !== "all" || historyExpanded()) return filtered;
    const seenJourneys = new Set<string>();
    return filtered.filter((row) => {
      const key = row.action || row.title || row.id;
      if (seenJourneys.has(key)) return false;
      seenJourneys.add(key);
      return true;
    });
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
    equals: (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.id === b.id &&
        a.status === b.status &&
        (a.finishedAt ?? 0) === (b.finishedAt ?? 0) &&
        ((a as { writtenAt?: number }).writtenAt ?? 0) ===
          ((b as { writtenAt?: number }).writtenAt ?? 0) &&
        (a.artifacts?.length ?? 0) === (b.artifacts?.length ?? 0) &&
        (a.frames?.length ?? 0) === (b.frames?.length ?? 0)),
  });
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
      void server.loadRunDetail(run.id).finally(() => requestedDetails.delete(run.id));
    }
    if (run?.evidence) void server.loadRunSignals(run.id).then(setRegressionSignals);
    else setRegressionSignals([]);
  });
  createEffect(() => {
    const job = selected();
    if (tab() !== "visual" || !job?.persisted) {
      setVisualComparison(null);
      return;
    }
    setVisualLoading(true);
    void server
      .loadVisualComparison(job.id)
      .then(setVisualComparison)
      .finally(() => setVisualLoading(false));
  });
  async function approveCurrentVisualBaseline(): Promise<void> {
    const job = selected();
    if (!job?.persisted || approvingVisualBaseline()) return;
    setApprovingVisualBaseline(true);
    try {
      const comparison = await server.approveVisualBaseline(job.id);
      if (comparison) {
        setVisualComparison(comparison);
        toast("Visual baseline approved", "success");
      }
    } finally {
      setApprovingVisualBaseline(false);
    }
  }
  const openRun = (job: JobInfo) => {
    setSelectedId(job.id);
    server.setSelectedJobId(job.id);
    selectRunStep(initialRunReviewStep(job));
    setTab("timeline");
    if (!job.steps?.length && !requestedDetails.has(job.id)) {
      requestedDetails.add(job.id);
      void server.loadRunDetail(job.id).finally(() => requestedDetails.delete(job.id));
    }
  };
  const reviewCounts = createMemo(() => (selected() ? runReviewCounts(selected()!) : null));
  const selectedRecipe = createMemo(() => {
    const job = selected();
    return job?.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === job?.action);
  });
  const reviewCompletion = createMemo(() =>
    selected() ? runCompletion(selected()!, selectedRecipe()?.steps.length ?? 0) : null,
  );
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
    const requestedRun = rows().find((row) => row.id === requested)!;
    setSelectedId(requested);
    selectRunStep(initialRunReviewStep(requestedRun));
    setTab("timeline");
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
    return (
      rows().find(
        (row) =>
          row.id !== current.id &&
          row.action === current.action &&
          (row.finishedAt ?? row.startedAt ?? row.queuedAt) <
            (current.finishedAt ?? current.startedAt ?? current.queuedAt),
      ) ?? null
    );
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
          <h2 class="m-0 text-[18px] font-semibold tracking-[-0.02em] text-text-strong">
            Run history
          </h2>
          <Show when={rows().length > 0}>
            <button
              type="button"
              class={productSecondary}
              disabled={refreshing()}
              aria-busy={refreshing()}
              onClick={() => void refreshRuns()}
            >
              <Icon
                name="refresh"
                size={15}
                class={cn(
                  refreshing() &&
                    "origin-center animate-spin motion-reduce:animate-none motion-reduce:opacity-70",
                )}
              />{" "}
              Refresh
            </button>
          </Show>
        </div>
      </Show>
      <div
        class={cn(
          selected()
            ? "grid min-h-0 min-w-0 flex-1 grid-cols-[238px_minmax(300px,1.08fr)_minmax(370px,0.92fr)] overflow-hidden max-[1180px]:grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.1fr)] max-[700px]:grid-cols-1 max-[700px]:overflow-y-auto"
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
                  {(
                    [
                      ["all", "Latest"],
                      ["passed", "Passed"],
                      ["attention", "Attention"],
                      ["active", "Active"],
                    ] as const
                  ).map(([id, label]) => (
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
                        ? "journey"
                        : "journeys"}
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
                    description="Run a test to keep its result, replay, and diagnostics together."
                    actionLabel="Run a test"
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
                    onOpen={() => openRun(job)}
                  />
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={selected()}>
          <RunBrowser rows={rows()} selectedId={selectedId()} onSelect={openRun} />
        </Show>
        <Show when={selected()}>
          {(job) => (
            <RunReplayStage
              job={job()}
              items={selectedCanvasItems()}
              selectedIndex={selectedRunStep()}
              onSelect={selectRunStep}
              onBack={() => {
                setSelectedId(null);
                const url = new URL(window.location.href);
                url.searchParams.delete("run");
                window.history.replaceState({}, "", url);
              }}
            />
          )}
        </Show>
        <Show when={selected()}>
          {(job) => (
            <aside class="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]">
              <header class="grid shrink-0 gap-2.5 px-5 pt-4 pb-3.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="grid min-w-0 gap-1">
                    <span class={eyebrow}>Execution review</span>
                    <strong class="truncate text-[20px]/[1.15] font-semibold tracking-[-0.025em] text-text-strong">
                      {server.recipes().find((r) => r.id === job().action)?.title ??
                        job().title ??
                        job().action}
                    </strong>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      class={cn(productSecondary, "mr-1 min-h-8 px-2.5 text-[11px]")}
                      onClick={() => {
                        server.setSelectedJobId(job().id);
                        props.onOpenRecipe(job().action);
                      }}
                    >
                      <Icon name="edit" size={12} /> Open test
                    </button>
                    <Show when={job().status === "error" || job().status === "cancelled"}>
                      <button
                        type="button"
                        class={cn(productPrimary, "min-h-8 px-2.5 text-[11px]")}
                        onClick={() => void server.retrySelectedJob(job().id)}
                      >
                        <Icon name="refresh" size={12} /> Retry
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="grid size-8 place-items-center rounded-lg text-text-weaker transition-[background-color,color,transform] duration-150 hover:bg-surface-base-hover hover:text-text-base active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-border-strong-focus"
                      aria-label="Copy report link"
                      data-tip="Copy report link"
                      onClick={() => {
                        const url = new URL(window.location.href);
                        url.searchParams.set("run", job().id);
                        void navigator.clipboard?.writeText(url.toString());
                        window.history.replaceState({}, "", url);
                        toast("Report link copied", "success");
                      }}
                    >
                      <Icon name="copy" size={13} />
                    </button>
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
                <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-text-weak">
                  <StatusChip
                    tone={jobStatusChip(job().status).tone}
                    label={jobStatusChip(job().status).label}
                  />
                  <span class="inline-flex items-baseline gap-2">
                    <span class="text-text-weaker">Ran</span>
                    <span class={cn(mono, "text-text-base")}>
                      {fmtAgo(
                        job().finishedAt ?? job().startedAt ?? job().queuedAt,
                        server.clock(),
                      ) || "just now"}
                    </span>
                  </span>
                  <Show when={fmtDur(job(), server.clock())}>
                    <span class="inline-flex items-baseline gap-2">
                      <span class="text-text-weaker">Duration</span>
                      <span class={cn(mono, "text-text-base")}>
                        {fmtDur(job(), server.clock())}
                      </span>
                    </span>
                  </Show>
                  <span class="inline-flex min-w-0 items-baseline gap-2">
                    <span class="shrink-0 text-text-weaker">Device</span>
                    <span class="truncate text-text-base">
                      {job().targetProfile?.name ?? job().serial ?? "Not recorded"}
                    </span>
                  </span>
                </div>
              </header>
              <Show when={job().status === "error" || job().status === "cancelled"}>
                <div class="mx-4 mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--icon-critical-base)_28%,var(--v2-border-border-muted))] bg-[color-mix(in_srgb,var(--icon-critical-base)_7%,transparent)] px-3 py-2.5">
                  <span class="mt-0.5 grid size-6 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--icon-critical-base)_14%,transparent)] text-[var(--icon-critical-base)]">
                    <Icon name="alert" size={13} />
                  </span>
                  <div class="min-w-0">
                    <strong class="block text-[12.5px] font-semibold text-text-strong">
                      {job().failureCategory ? readableFailure(job().failureCategory!) : "Stopped"}{" "}
                      at step {initialRunReviewStep(job()) + 1} of {reviewCompletion()?.total ?? 1}
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
                class="flex shrink-0 overflow-x-auto border-b border-border-weak-base px-3.5"
                role="tablist"
                aria-label="Run evidence"
              >
                {(
                  [
                    ["timeline", "Playback"],
                    ["summary", "Overview"],
                    ["visual", "Changes"],
                    ["evaluation", "Checks"],
                    ["network", "Network"],
                    ["logs", "Logs"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    type="button"
                    role="tab"
                    id={`run-report-tab-${id}`}
                    aria-controls="run-report-panel"
                    aria-selected={tab() === id}
                    tabindex={tab() === id ? 0 : -1}
                    class={cn(tabUnderline, tab() === id && tabUnderlineActive)}
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
                <Show when={job().batchId && job().targetProfile}>
                  <button
                    type="button"
                    role="tab"
                    id="run-report-tab-compatibility"
                    aria-controls="run-report-panel"
                    aria-selected={tab() === "compatibility"}
                    tabindex={tab() === "compatibility" ? 0 : -1}
                    class={cn(tabUnderline, tab() === "compatibility" && tabUnderlineActive)}
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
                    onOpenRecipe={props.onOpenRecipe}
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
                    <VisualDiffReview
                      comparison={visualComparison()}
                      loading={visualLoading()}
                      approving={approvingVisualBaseline()}
                      onApprove={() => void approveCurrentVisualBaseline()}
                    />
                  </Show>
                </Show>
                <Show when={tab() === "network"}>
                  <EvidenceList
                    items={job().artifacts?.filter((item) => item.kind === "network") ?? []}
                    empty="No network evidence in this run. Add a Capture network step where the traffic matters."
                  />
                </Show>
                <Show when={tab() === "evaluation"}>
                  <EvidenceList
                    items={
                      job().artifacts?.filter((item) =>
                        [
                          "response-completion",
                          "conversation-turn",
                          "content-assertion",
                          "semantic-evaluation",
                          "judge-consensus",
                          "frozen-inputs",
                          "app-build",
                        ].includes(item.kind),
                      ) ?? []
                    }
                    empty="No conversational evidence yet. Add Extract, Check content, or Evaluate response steps."
                  />
                </Show>
                <Show when={tab() === "logs"}>
                  <pre class="m-0 max-h-64 overflow-auto rounded-lg border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] p-3 font-mono text-[10px]/[1.45] text-[var(--text-base)]">
                    {job().logs?.join("\n") || "No logs were captured for this run."}
                  </pre>
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

function RunBrowser(props: {
  rows: JobInfo[];
  selectedId: string | null;
  onSelect: (job: JobInfo) => void;
}) {
  const server = useServer();
  return (
    <aside
      class="flex min-h-0 flex-col border-r border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)] max-[1180px]:hidden"
      aria-label="Run browser"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--v2-border-border-muted)] px-3.5">
        <div>
          <strong class="block text-[12.5px] font-semibold text-[var(--text-strong)]">Runs</strong>
          <small class="text-[10px] text-[var(--text-weak)]">{props.rows.length} saved</small>
        </div>
        <span class="grid size-7 place-items-center rounded-lg bg-[var(--v2-background-bg-layer-01)] text-[var(--text-weak)]">
          <Icon name="wave" size={14} />
        </span>
      </header>
      <nav class="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Saved runs">
        <For each={props.rows}>
          {(job) => {
            const recipe = () => server.recipes().find((item) => item.id === job.action);
            const status = () => jobStatusChip(job.status);
            return (
              <button
                type="button"
                class={cn(
                  "mb-0.5 grid min-h-[58px] w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-[9px] px-2.5 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-white/60",
                  props.selectedId === job.id
                    ? "bg-[var(--v2-background-bg-layer-02)]"
                    : "hover:bg-[var(--v2-background-bg-layer-01)]",
                )}
                aria-current={props.selectedId === job.id ? "page" : undefined}
                onClick={() => props.onSelect(job)}
              >
                <span
                  class={cn(
                    "size-1.5 rounded-full",
                    status().tone === "pass"
                      ? "bg-[var(--icon-success-base)]"
                      : status().tone === "fail"
                        ? "bg-[var(--icon-critical-base)]"
                        : "bg-[var(--v2-background-bg-accent)]",
                  )}
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <strong class="block truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                    {recipe()?.title ?? job.title ?? titleize(job.action)}
                  </strong>
                  <small class="mt-1 flex items-center gap-1.5 text-[9.5px] text-[var(--text-weak)]">
                    <span>{status().label}</span>
                    <span aria-hidden="true">·</span>
                    <span class="font-mono tabular-nums">{fmtDur(job, server.clock()) || "—"}</span>
                    <span aria-hidden="true">·</span>
                    <span class="truncate">
                      {fmtAgo(job.finishedAt ?? job.startedAt ?? job.queuedAt, server.clock()) ||
                        "now"}
                    </span>
                  </small>
                </span>
              </button>
            );
          }}
        </For>
      </nav>
    </aside>
  );
}

function CompatibilityReportPanel(props: {
  report: import("@relay/protocol").CompatibilityReport | null;
  selectedProfileId: string;
}) {
  return (
    <Show
      when={props.report}
      fallback={
        <div class="rounded-[10px] border border-dashed border-[var(--v2-border-border-muted)] px-3 py-4 text-center text-[11px] text-[var(--text-weak)]">
          Preparing the comparison…
        </div>
      }
    >
      {(report) => (
        <div class="grid gap-3">
          <header class="flex items-start justify-between gap-3">
            <div>
              <span class={eyebrow}>Compatibility matrix</span>
              <strong class="mt-0.5 block text-[13px] text-[var(--text-strong)]">
                {report().matrixName ?? "Target comparison"}
              </strong>
              <small class="mt-0.5 block text-[10px] text-[var(--text-weak)]">
                {report().profiles.length} target{report().profiles.length === 1 ? "" : "s"} ·{" "}
                {report().total} evidence run{report().total === 1 ? "" : "s"}
              </small>
            </div>
            <span class="shrink-0 rounded-full border border-[var(--v2-border-border-muted)] px-[7px] py-1 text-[9px] tracking-[0.08em] text-[var(--text-weak)] uppercase">
              Same test setup
            </span>
          </header>
          <div class="grid gap-2">
            <For each={report().profiles}>
              {(profile) => (
                <article
                  class={cn(
                    "grid gap-2.5 rounded-[10px] border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-01)_55%,transparent)] p-3",
                    profile.profile.id === props.selectedProfileId &&
                      "border-border-interactive-base bg-surface-interactive-weak",
                  )}
                >
                  <header class="flex items-start justify-between gap-3">
                    <div>
                      <strong class="block text-[13px] text-[var(--text-strong)]">
                        {profile.profile.name}
                      </strong>
                      <small class="mt-0.5 block text-[10px] text-[var(--text-weak)]">
                        {profile.profile.platform}
                        {profile.profile.osVersion ? ` · ${profile.profile.osVersion}` : ""}
                      </small>
                    </div>
                    <span class={productStatus(profile.passRate === 1 ? "ok" : "error")}>
                      {profile.passRate == null
                        ? "Pending"
                        : `${Math.round(profile.passRate * 100)}%`}
                    </span>
                  </header>
                  <div class="grid grid-cols-2 gap-2">
                    <span class="grid gap-0.5 rounded-[7px] bg-[var(--v2-background-bg-base)] p-2">
                      <b class="text-[9px] font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase">
                        Pass rate
                      </b>
                      <strong class="text-[12px] text-[var(--text-strong)]">
                        {profile.passRate == null
                          ? "No product verdict yet"
                          : `${Math.round(profile.passRate * 100)}%`}
                      </strong>
                    </span>
                    <span class="grid gap-0.5 rounded-[7px] bg-[var(--v2-background-bg-base)] p-2">
                      <b class="text-[9px] font-medium tracking-[0.08em] text-[var(--text-weak)] uppercase">
                        Median duration
                      </b>
                      <strong class="text-[12px] text-[var(--text-strong)]">
                        {profile.medianDurationMs == null
                          ? "—"
                          : `${(profile.medianDurationMs / 1000).toFixed(1)}s`}
                      </strong>
                    </span>
                  </div>
                  <p class="m-0 text-[10px]/[1.45] text-[var(--text-base)]">
                    {profile.passed} passed · {profile.productFailures} product ·{" "}
                    {profile.harnessFailures} harness
                    {profile.uncertain ? ` · ${profile.uncertain} uncertain` : ""}
                    {profile.pending ? ` · ${profile.pending} pending` : ""}
                  </p>
                  <Show when={profile.baseline}>
                    {(baseline) => (
                      <footer class="border-t border-[var(--v2-border-border-muted)] pt-2 text-[10px]/[1.4] text-[var(--text-weak)]">
                        Versus {baseline().total} earlier run{baseline().total === 1 ? "" : "s"}:{" "}
                        {formatPassDelta(baseline().passRateDelta)} ·{" "}
                        {formatDurationDelta(baseline().durationDeltaMs)}
                      </footer>
                    )}
                  </Show>
                </article>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}

function formatPassDelta(value: number | null): string {
  if (value == null) return "no pass-rate baseline";
  const points = Math.round(value * 100);
  return `${points > 0 ? "+" : ""}${points} pts`;
}

function formatDurationDelta(value: number | null): string {
  if (value == null) return "no duration baseline";
  const seconds = value / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(1)}s`;
}

function formatStepDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function runStateDot(state: ExecutionMomentState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--icon-critical-base)]";
  if (state === "planned") return "bg-[var(--v2-border-border-strong)]";
  if (state === "running")
    return "bg-[var(--v2-background-bg-accent)] shadow-[0_0_8px_var(--v2-background-bg-accent)]";
  return "bg-[var(--icon-success-base)]";
}

type VideoArtifactData = {
  startedAt?: number;
  stoppedAt?: number;
  durationMs?: number;
  files?: { path: string; bytes?: number }[];
  result?: unknown;
};

/** The primary run-review surface: captured playback with a concise scrubber.
 * The optional screen view remains secondary to the evidence people can see. */
function RunReplayStage(props: {
  job: JobInfo;
  items: FrameCanvasItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onBack: () => void;
}) {
  const server = useServer();
  const [stageMode, setStageMode] = createSignal<"replay" | "map">("replay");
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(1);
  const cycleSpeed = () => setSpeed((current) => (current >= 8 ? 1 : current * 2));
  const snapshot = () =>
    props.job.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === props.job.action);
  const nodes = createMemo(() =>
    executionMoments({ recipe: snapshot(), job: props.job, recipes: server.recipes() }),
  );
  const count = () => Math.max(nodes().length, 1);
  const index = () => Math.max(0, Math.min(props.selectedIndex, count() - 1));
  const node = () => nodes()[index()];
  const elapsed = () => runElapsedAtStep(props.job.steps ?? [], index());
  const totalDuration = () =>
    (props.job.steps ?? []).reduce(
      (duration, step) => duration + Math.max(0, step.durationMs ?? 0),
      0,
    );
  const frameSrc = () => {
    const item = props.items[index()];
    if (item?.src) return item.src;
    const frame = node()?.frame;
    if (!frame) return null;
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    if (props.job.persisted || props.job.runDir) {
      return server.frameUrlForPersisted(props.job as unknown as PersistedRun, frame);
    }
    return null;
  };
  const glyphFor = (stepIndex: number) => {
    const kind = snapshot()?.steps[stepIndex]?.kind;
    return kind ? kindIcon(kind) : "bolt";
  };
  const move = (delta: number) =>
    props.onSelect(Math.max(0, Math.min(index() + delta, count() - 1)));
  const togglePlayback = () => {
    if (playing()) {
      setPlaying(false);
      return;
    }
    if (index() === count() - 1) props.onSelect(0);
    setPlaying(true);
  };

  // Leaving replay for the graph shouldn't leave a video/frame-stepper
  // running invisibly behind it.
  createEffect(() => {
    if (stageMode() !== "replay") setPlaying(false);
  });

  /* Video replay — when the run persisted a captured video, it becomes the
   * time source (step selection derives from currentTime instead of the
   * setTimeout-paced frame stepper below). */
  let videoRef: HTMLVideoElement | undefined;
  const [videoElapsedMs, setVideoElapsedMs] = createSignal(0);
  const [videoDurationMs, setVideoDurationMs] = createSignal<number | null>(null);
  const [reviewCutEnabled, setReviewCutEnabled] = createSignal(true);
  const [reviewCutSkipped, setReviewCutSkipped] = createSignal<number | null>(null);
  // Distinguishes a timeupdate-driven step change (don't re-seek, it would
  // fight the currently-playing video) from a user/keyboard-driven one.
  let seekingFromVideo = false;
  // `props.job` gets a fresh object reference on every background poll tick
  // (rows() re-spreads persisted runs each refresh) even though the run's
  // own data hasn't changed. Deriving these from raw `props.job` reads would
  // let a poll land mid-render and transiently null out the video fields —
  // unmounting the <video> element via the Show gate below and silently
  // killing playback. Keying on job.id (stable for the run being viewed)
  // makes these compute once per run, immune to that churn.
  const videoData = createMemo(
    on(
      () => props.job.id,
      () =>
        props.job.artifacts?.find((item) => item.kind === "video")?.data as
          | VideoArtifactData
          | undefined,
    ),
  );
  const videoFilePath = createMemo(() => videoData()?.files?.[0]?.path);
  // Disk runs arrive as PersistedRun (`dir`), live jobs as JobInfo (`runDir`) —
  // either proves the file exists on disk for the /runs/:id/video route.
  const hasVideo = createMemo(
    on(
      () => props.job.id,
      () =>
        Boolean(videoFilePath()) &&
        Boolean(props.job.persisted || props.job.runDir || (props.job as { dir?: string }).dir),
    ),
  );
  const videoSrc = createMemo(() =>
    hasVideo() ? server.videoUrlForRun(props.job.id, videoFilePath()!) : null,
  );
  const videoStart = createMemo(() => videoData()?.startedAt ?? props.job.startedAt ?? 0);
  const stepOffsetsMs = createMemo(() => {
    const steps = props.job.steps ?? [];
    const start = videoStart();
    let cumulative = 0;
    return steps.map((step) => {
      const offset = step.startedAt != null ? Math.max(0, step.startedAt - start) : cumulative;
      cumulative += Math.max(0, step.durationMs ?? 0);
      return offset;
    });
  });
  const deriveStepIndex = (elapsedMs: number): number => {
    const offsets = stepOffsetsMs();
    let best = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i]! <= elapsedMs) best = i;
    }
    return best;
  };
  const videoTotalDurationMs = createMemo(
    () => videoData()?.durationMs ?? videoDurationMs() ?? totalDuration(),
  );
  const reviewCut = createMemo(() =>
    deriveReviewCut({
      sourceDurationMs: videoTotalDurationMs(),
      sourceStartedAt: videoStart(),
      steps: props.job.steps ?? [],
      evidenceEvents: props.job.evidence?.events,
    }),
  );
  const cutActive = () => reviewCutEnabled() && reviewCut() != null;
  const reviewMarkerFractions = createMemo(() => {
    const cut = reviewCut();
    if (!cutActive() || !cut || cut.reviewDurationMs <= 0) return undefined;
    return stepOffsetsMs().map((offset) =>
      Math.max(0, Math.min(1, sourceTimeToReviewMs(cut, offset) / cut.reviewDurationMs)),
    );
  });
  const reviewGapFractions = createMemo(() => {
    const cut = reviewCut();
    if (!cutActive() || !cut || cut.reviewDurationMs <= 0) return undefined;
    let elapsed = 0;
    return cut.segments.slice(0, -1).map((segment) => {
      elapsed += segment.endMs - segment.startMs;
      return elapsed / cut.reviewDurationMs;
    });
  });
  const seekVideoTo = (idx: number) => {
    const video = videoRef;
    if (!video) return;
    const target = (stepOffsetsMs()[idx] ?? 0) / 1000;
    if (!Number.isFinite(target)) return;
    if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
    setVideoElapsedMs(target * 1000);
  };
  const onVideoTimeUpdate = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;
    const elapsedMs = video.currentTime * 1000;
    const cut = reviewCut();
    if (playing() && cutActive() && cut) {
      const next = nextReviewSourceMs(cut, elapsedMs + 20);
      if (next != null && next > elapsedMs + 20) {
        const skipped = Math.max(0, next - elapsedMs);
        video.currentTime = next / 1000;
        setVideoElapsedMs(next);
        setReviewCutSkipped(skipped);
        window.setTimeout(() => setReviewCutSkipped(null), 1_400);
        return;
      }
    }
    setVideoElapsedMs(elapsedMs);
    const derived = deriveStepIndex(elapsedMs);
    if (derived !== index()) {
      seekingFromVideo = true;
      props.onSelect(derived);
    }
  };
  const onVideoLoadedMetadata = (event: Event) => {
    const video = event.currentTarget as HTMLVideoElement;
    if (Number.isFinite(video.duration)) setVideoDurationMs(video.duration * 1000);
    seekVideoTo(index());
  };
  const timelineElapsedMs = () => {
    const cut = reviewCut();
    return hasVideo() && cutActive() && cut
      ? sourceTimeToReviewMs(cut, videoElapsedMs())
      : hasVideo()
        ? videoElapsedMs()
        : elapsed();
  };
  const timelineTotalMs = () => {
    const cut = reviewCut();
    return hasVideo() && cutActive() && cut
      ? cut.reviewDurationMs
      : hasVideo()
        ? videoTotalDurationMs()
        : totalDuration();
  };
  // Seeking effect: fires whenever the selected step changes from anywhere
  // (timeline chip, step list, arrow keys) except when the change originated
  // from the video's own timeupdate — that direction is already in sync.
  createEffect(() => {
    if (!hasVideo()) return;
    const idx = index();
    if (seekingFromVideo) {
      seekingFromVideo = false;
      return;
    }
    seekVideoTo(idx);
  });
  createEffect(() => {
    if (!hasVideo()) return;
    const video = videoRef;
    if (!video) return;
    if (playing()) {
      if (video.ended) video.currentTime = 0;
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
  createEffect(() => {
    if (!hasVideo()) return;
    if (videoRef) videoRef.playbackRate = speed();
  });
  createEffect(() => {
    // Frame-per-step fallback pacing — only drives playback when there is no
    // video to scrub against.
    if (hasVideo()) return;
    if (!playing()) return;
    const current = index();
    if (current >= count() - 1) {
      setPlaying(false);
      return;
    }
    const rawDuration = props.job.steps?.[current]?.durationMs ?? 700;
    const baseDelay = Math.max(650, Math.min(rawDuration, 2_200));
    const timer = window.setTimeout(
      () => props.onSelect(Math.min(current + 1, count() - 1)),
      Math.max(80, Math.round(baseDelay / speed())),
    );
    onCleanup(() => window.clearTimeout(timer));
  });
  return (
    <section
      class="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--v2-background-bg-deep)_94%,black)]"
      aria-label="Run replay"
      tabindex={-1}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          setPlaying(false);
          move(-1);
        }
        if (event.key === "ArrowRight") {
          setPlaying(false);
          move(1);
        }
        if (event.key === " ") {
          event.preventDefault();
          togglePlayback();
        }
      }}
    >
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,color-mix(in_srgb,var(--v2-background-bg-accent)_7%,transparent),transparent_52%),radial-gradient(circle,color-mix(in_srgb,var(--v2-border-border-strong)_42%,transparent)_1px,transparent_1px)] [background-size:auto,20px_20px]"
        aria-hidden="true"
      />
      <header class="relative z-[1] flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5">
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-[var(--text-base)] transition-colors hover:bg-surface-base-hover hover:text-[var(--text-strong)]"
          onClick={props.onBack}
        >
          <Icon name="chevron-left" size={14} /> All runs
        </button>
        <Show when={nodes().length > 0}>
          <div class={seg} role="group" aria-label="Run report view">
            <button
              type="button"
              class={cn(segBtn, stageMode() === "replay" && segBtnOn)}
              aria-pressed={stageMode() === "replay"}
              onClick={() => setStageMode("replay")}
            >
              <Icon name="play" size={12} /> Replay
            </button>
            <button
              type="button"
              class={cn(segBtn, stageMode() === "map" && segBtnOn)}
              aria-pressed={stageMode() === "map"}
              onClick={() => setStageMode("map")}
            >
              <Icon name="move" size={12} /> Screens
            </button>
          </div>
        </Show>
      </header>
      <Show when={nodes().length === 0}>
        <div class="relative z-[1] grid min-h-0 flex-1 place-items-center px-8 py-5">
          <EmptyState
            icon="camera"
            title="Nothing to replay"
            description="This run recorded no steps, so there is no evidence to walk through."
          />
        </div>
      </Show>
      <Show when={nodes().length > 0 && stageMode() === "map"}>
        <div class="relative z-[1] min-h-0 flex-1 overflow-hidden">
          <RunGraph
            moments={nodes()}
            items={props.items}
            selectedIndex={index()}
            onSelect={props.onSelect}
          />
        </div>
      </Show>
      <Show when={nodes().length > 0 && stageMode() === "replay"}>
        <div class="relative z-[1] grid min-h-0 flex-1 place-items-center px-8 py-5">
          {/* Phone bezel — always renders; only the interior swaps between the
            captured frame and a calm inline note when evidence is missing. */}
          <div class="relative flex h-full max-h-[560px] w-full max-w-[300px] items-center justify-center">
            <span class="absolute top-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-base)_90%,transparent)] px-2.5 py-1 font-mono text-[9.5px] tracking-[0.05em] text-[var(--text-weak)] uppercase shadow-[0_6px_16px_rgb(0_0_0/30%)] backdrop-blur">
              <i class={cn("size-1.5 rounded-full", runStateDot(node()?.state ?? "planned"))} />
              Step {String(index() + 1).padStart(2, "0")} ·{" "}
              {executionStateLabel(node()?.state ?? "planned", "step")}
            </span>
            {/* Bezel border stays neutral regardless of run state — the floating
              step badge's dot is the accent that carries pass/fail, per the
              rule that alarm colors never tint a large chrome surface. */}
            <div class="relative flex aspect-[9/19] h-full max-h-full w-full items-center justify-center overflow-hidden rounded-[32px] border-[6px] border-[var(--v2-background-bg-layer-02)] bg-[var(--v2-background-bg-base)] shadow-[0_36px_90px_rgb(0_0_0/50%),0_0_0_1px_rgb(255_255_255/5%)]">
              <span
                class="absolute top-0 left-1/2 z-[1] h-4 w-24 -translate-x-1/2 rounded-b-xl bg-[var(--v2-background-bg-layer-02)]"
                aria-hidden="true"
              />
              <Show
                when={hasVideo()}
                fallback={
                  <Show
                    when={frameSrc()}
                    fallback={
                      <div class="grid justify-items-center gap-1.5 px-6 text-center">
                        <Icon
                          name={node()?.state === "failed" ? "alert" : "camera"}
                          size={16}
                          class="text-text-weaker"
                        />
                        <span class="text-[11px]/[1.4] text-text-weaker">
                          {node()?.observed ? "No screenshot captured here" : "Step not reached"}
                        </span>
                      </div>
                    }
                  >
                    {(src) => (
                      <img
                        src={src()}
                        alt={`Step ${index() + 1} evidence`}
                        class="h-full w-full object-contain"
                      />
                    )}
                  </Show>
                }
              >
                <video
                  ref={(element) => {
                    videoRef = element;
                  }}
                  src={videoSrc() ?? undefined}
                  muted
                  playsinline
                  preload="metadata"
                  class="h-full w-full object-contain"
                  onTimeUpdate={onVideoTimeUpdate}
                  onLoadedMetadata={onVideoLoadedMetadata}
                  onEnded={() => setPlaying(false)}
                />
              </Show>
            </div>
          </div>
        </div>
        <div class="relative z-[1] mx-auto mb-2 flex max-w-[78%] items-center justify-center gap-2 px-4 text-center">
          <Icon
            name={glyphFor(index())}
            size={12}
            class={node()?.state === "failed" ? "text-icon-critical-base" : "text-text-weaker"}
          />
          <p class="m-0 truncate text-[12.5px] font-medium text-text-base">{node()?.title}</p>
        </div>
        <Show when={hasVideo() && reviewCut()}>
          {(cut) => (
            <div class="relative z-[2] mx-auto flex w-full max-w-[560px] items-center justify-between gap-3 px-4 pb-1">
              <div class="min-w-0">
                <p class="m-0 text-[11px] font-medium text-text-base">Focused review</p>
                <p class="m-0.5 text-[10px] text-text-weaker">
                  Skips {formatStepDuration(cut().skippedDurationMs)} of unchanged time. Original
                  video stays intact.
                </p>
              </div>
              <div class={seg} role="group" aria-label="Replay timeline">
                <button
                  type="button"
                  class={cn(segBtn, !reviewCutEnabled() && segBtnOn)}
                  aria-pressed={!reviewCutEnabled()}
                  onClick={() => setReviewCutEnabled(false)}
                >
                  Original
                </button>
                <button
                  type="button"
                  class={cn(segBtn, reviewCutEnabled() && segBtnOn)}
                  aria-pressed={reviewCutEnabled()}
                  onClick={() => setReviewCutEnabled(true)}
                >
                  Review cut
                </button>
              </div>
            </div>
          )}
        </Show>
        <Show when={reviewCutSkipped()}>
          {(skipped) => (
            <div class="pointer-events-none absolute right-4 bottom-[72px] z-[4] rounded-full border border-[var(--v2-border-border-muted)] bg-[color-mix(in_srgb,var(--v2-background-bg-layer-02)_94%,transparent)] px-2.5 py-1 text-[10px] font-medium text-text-base shadow-[0_8px_24px_rgb(0_0_0/28%)] backdrop-blur">
              Skipped {formatStepDuration(skipped())} unchanged
            </div>
          )}
        </Show>
        <ExecutionTimeline
          moments={nodes()}
          selectedIndex={index()}
          onSelect={(nextIndex) => {
            setPlaying(false);
            props.onSelect(nextIndex);
          }}
          mode="replay"
          playing={playing()}
          onTogglePlayback={togglePlayback}
          onPrevious={() => {
            setPlaying(false);
            move(-1);
          }}
          onNext={() => {
            setPlaying(false);
            move(1);
          }}
          elapsedMs={timelineElapsedMs()}
          totalDurationMs={timelineTotalMs()}
          markerFractions={reviewMarkerFractions()}
          skippedFractions={reviewGapFractions()}
          speed={speed()}
          onCycleSpeed={cycleSpeed}
          onScrub={(fraction) => {
            const video = videoRef;
            if (!hasVideo() || !video) return;
            const cut = reviewCut();
            const target =
              cutActive() && cut
                ? reviewTimeToSourceMs(cut, fraction * cut.reviewDurationMs) / 1000
                : fraction * (videoTotalDurationMs() / 1000);
            video.currentTime = Math.max(0, Math.min(target, video.duration || target));
            setVideoElapsedMs(target * 1000);
          }}
        />
      </Show>
    </section>
  );
}

/** The supporting action list for a run report. Playback remains the primary
 * review surface; this list exists to explain and jump to a moment. */
function RunStepList(props: {
  job: JobInfo;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const server = useServer();
  const snapshot = () =>
    props.job.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === props.job.action);
  const nodes = createMemo(() =>
    executionMoments({ recipe: snapshot(), job: props.job, recipes: server.recipes() }),
  );
  return (
    <div class="grid content-start">
      <div class="relative grid content-start before:absolute before:top-8 before:bottom-8 before:left-6 before:w-px before:bg-[var(--v2-border-border-strong)]">
        <For
          each={nodes()}
          fallback={
            <div class="rounded-[10px] border border-dashed border-[var(--v2-border-border-muted)] px-3 py-5 text-center text-[12px] text-[var(--text-weak)]">
              No steps were recorded for this run.
            </div>
          }
        >
          {(node) => {
            const active = () => props.selectedIndex === node.index;
            const kind = () => snapshot()?.steps[node.index]?.kind;
            return (
              <button
                type="button"
                class={cn(
                  "relative grid min-h-16 w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-3 text-left transition-[background-color,transform] duration-150 active:scale-[0.99]",
                  active()
                    ? "bg-[color-mix(in_srgb,var(--v2-background-bg-accent)_11%,var(--v2-background-bg-base))]"
                    : "hover:bg-[var(--v2-background-bg-layer-01)]",
                  node.state === "planned" && !active() && "opacity-55",
                )}
                aria-current={active() ? "step" : undefined}
                onClick={() => props.onSelect(node.index)}
              >
                {/* Square number badge — outlined in accent when this is the
                    selected step, matching the "raised row + outlined badge"
                    selection language used across the run report. */}
                <span
                  class={cn(
                    "relative z-[1] grid size-8 place-items-center rounded-[9px] border bg-[var(--v2-background-bg-base)] font-mono text-[11px] font-semibold tabular-nums",
                    active()
                      ? "border-[var(--v2-background-bg-accent)] text-[var(--text-interactive-base)]"
                      : node.state === "failed"
                        ? "border-[var(--icon-critical-base)] text-[var(--icon-critical-base)]"
                        : "border-[var(--v2-border-border-strong)] text-[var(--text-weak)]",
                  )}
                >
                  {node.index + 1}
                </span>
                <span class="min-w-0 pr-2">
                  <span class="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-text-weaker">
                    <Icon name={kind() ? kindIcon(kind()!) : "bolt"} size={11} class="shrink-0" />
                    <span class="shrink-0 tracking-[0.02em]">
                      {kind() ? kindLabel(kind()!) : "Step"}
                    </span>
                    <Show when={node.durationMs}>
                      <span class="shrink-0 text-text-weaker/70">·</span>
                      <span class={cn(mono, "shrink-0 text-[10px]")}>
                        {formatStepDuration(node.durationMs!)}
                      </span>
                    </Show>
                    <Show when={node.actions.length > 0 ? node.actions : undefined}>
                      {(actions) => (
                        <>
                          <span class="shrink-0 text-text-weaker/70">·</span>
                          <ActionIconTrail glyphs={actions()} max={8} />
                        </>
                      )}
                    </Show>
                  </span>
                  <strong class="mt-1 block truncate text-[13.5px]/[1.35] font-medium tracking-[-0.005em] text-text-strong">
                    {node.title}
                  </strong>
                </span>
                <span class="grid shrink-0 justify-items-end gap-1 text-text-weaker">
                  <i class={cn("size-1.5 rounded-full", runStateDot(node.state))} />
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function EvidenceList(props: {
  items: { kind: string; capturedAt: number; data: unknown }[];
  empty: string;
}) {
  return (
    <div class="grid gap-2.5">
      <For
        each={props.items}
        fallback={
          <div class="rounded-[10px] border border-dashed border-[var(--v2-border-border-muted)] px-3 py-4 text-center text-[11px] text-[var(--text-weak)]">
            {props.empty}
          </div>
        }
      >
        {(item) => {
          const summary = () => evidenceSummary(item.data);
          return (
            <article class="overflow-hidden rounded-xl border border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-layer-01)]">
              <header class="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5">
                <span class="grid size-[30px] place-items-center rounded-lg bg-surface-base-active text-text-weak">
                  <Icon name={evidenceIcon(item.kind)} size={14} />
                </span>
                <div class="min-w-0">
                  <strong class="block truncate text-[12.5px] font-medium text-text-strong">
                    {evidenceTitle(item.kind)}
                  </strong>
                  <Show when={summary()}>
                    <span class="mt-0.5 block truncate text-[10.5px] text-text-weaker">
                      {summary()}
                    </span>
                  </Show>
                </div>
                <time class="font-mono text-[9.5px] tabular-nums text-text-weaker">
                  {new Date(item.capturedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </header>
              <details class="group border-t border-[var(--v2-border-border-muted)]">
                <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-3 text-[10px] font-medium text-text-weaker hover:text-text-base [&::-webkit-details-marker]:hidden">
                  View payload
                  <Icon
                    name="chevron-down"
                    size={11}
                    class="transition-transform duration-150 group-open:rotate-180"
                  />
                </summary>
                <pre class="m-0 max-h-64 overflow-auto border-t border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-deep)] p-3 font-mono text-[10px]/[1.5] text-[var(--text-base)]">
                  {JSON.stringify(item.data, null, 2)}
                </pre>
              </details>
            </article>
          );
        }}
      </For>
    </div>
  );
}

function evidenceTitle(kind: string): string {
  const labels: Record<string, string> = {
    network: "Network exchange",
    "response-completion": "Response completed",
    "conversation-turn": "Conversation turn",
    "content-assertion": "Content check",
    "semantic-evaluation": "Quality evaluation",
    "judge-consensus": "Evaluation consensus",
    "frozen-inputs": "Run inputs",
    "app-build": "App build",
  };
  return labels[kind] ?? titleize(kind);
}

function evidenceIcon(kind: string): IconName {
  if (kind === "network") return "wave";
  if (["content-assertion", "semantic-evaluation", "judge-consensus"].includes(kind)) {
    return "check";
  }
  if (kind === "app-build") return "bag";
  return "info";
}

function evidenceSummary(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return typeof data === "string" ? data : null;
  const value = data as Record<string, unknown>;
  const method = typeof value.method === "string" ? value.method.toUpperCase() : null;
  const url = typeof value.url === "string" ? value.url : null;
  const status = typeof value.status === "number" ? String(value.status) : null;
  if (method || url || status) return [method, status, url].filter(Boolean).join(" · ");
  const verdict = [value.verdict, value.result, value.outcome].find(
    (candidate) => typeof candidate === "string",
  );
  const score = typeof value.score === "number" ? `${Math.round(value.score * 100)}%` : null;
  if (verdict || score) return [verdict, score].filter(Boolean).join(" · ");
  const message = [value.message, value.summary, value.text, value.label].find(
    (candidate) => typeof candidate === "string",
  );
  return typeof message === "string" ? message : null;
}

function RunRow(props: { job: JobInfo; selected: boolean; onOpen: () => void }) {
  const server = useServer();
  const recipe = () => server.recipes().find((item) => item.id === props.job.action);
  const targetName = () => {
    if (props.job.targetProfile?.name) return props.job.targetProfile.name;
    const target = server.devices().find((device) => device.serial === props.job.serial);
    // A finished run's device may no longer be connected — that's not a
    // problem to report, so fall back to the recorded identifier as-is.
    return target ? presentTarget(target).displayName : (props.job.serial ?? null);
  };
  const status = () =>
    props.job.outcome === "passed"
      ? "Passed"
      : props.job.outcome === "product-failure"
        ? "App issue"
        : props.job.outcome === "harness-failure"
          ? "Could not run"
          : props.job.outcome === "uncertain"
            ? "Needs review"
            : props.job.status === "ok"
              ? "Passed"
              : props.job.status === "error"
                ? "Needs attention"
                : titleize(props.job.status);
  const glyphSteps = () => (props.job.recipeSnapshot ?? recipe())?.steps ?? [];
  const passed = () => props.job.status === "ok" || props.job.status === "healed";
  const active = () => ["queued", "running", "paused"].includes(props.job.status);
  /** Cheap frame-thumbnail strip: reuses whatever frame refs the row already
   * carries (persisted runs resolve to static file URLs, live jobs may embed
   * base64 directly) — no extra request per row. */
  const frameThumbs = createMemo(() => {
    const job = props.job;
    const raw = [...(job.frames ?? []), ...(job.steps?.flatMap((step) => step.frames ?? []) ?? [])];
    if (raw.length === 0) return [];
    const seen = new Set<string>();
    const persisted = Boolean(job.persisted || job.runDir);
    const urls: string[] = [];
    for (const frame of raw) {
      const key = `${frame.path}|${frame.capturedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const src = frame.base64
        ? `data:${frame.mime || "image/png"};base64,${frame.base64}`
        : persisted
          ? server.frameUrlForPersisted(job as unknown as PersistedRun, frame)
          : null;
      if (src) urls.push(src);
      if (urls.length >= 3) break;
    }
    return urls;
  });
  const rowLabel = () =>
    [
      recipe()?.title ?? titleize(props.job.action),
      status(),
      fmtDur(props.job, server.clock()),
      fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "just now",
    ]
      .filter(Boolean)
      .join(", ");
  return (
    <button
      type="button"
      class={cn(
        "group mb-2 grid min-h-[76px] w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border-weak-base bg-background-stronger px-3.5 text-left text-[12px]/[1.35] text-text-weak shadow-[0_5px_16px_rgb(0_0_0/6%)] transition-[background-color,border-color] duration-150 last:mb-0 hover:border-[var(--v2-border-border-strong)] hover:bg-[var(--v2-background-bg-layer-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
        props.selected && "border-border-interactive-base bg-surface-base-active",
      )}
      aria-current={props.selected ? "true" : undefined}
      aria-label={rowLabel()}
      onClick={props.onOpen}
    >
      <span
        class={cn(
          "grid size-9 place-items-center rounded-[10px]",
          passed() && "bg-surface-success-weak text-icon-success-base",
          active() && "bg-surface-info-weak text-icon-info-base",
          !passed() && !active() && "bg-surface-critical-weak text-icon-critical-base",
        )}
        aria-hidden="true"
      >
        <Icon name={passed() ? "check" : active() ? "play" : "alert"} size={16} />
      </span>
      <span class="min-w-0">
        <strong class="block truncate text-[13px]/[1.3] font-[550] text-text-base">
          {recipe()?.title ?? titleize(props.job.action)}
        </strong>
        <span class="mt-1.5 flex min-w-0 items-center gap-1.5 text-text-weaker">
          <span
            class={cn(
              "font-medium",
              passed() && "text-text-success-base",
              !passed() && !active() && "text-text-critical-base",
            )}
          >
            {status()}
          </span>
          <Show when={glyphSteps().length > 0}>
            <span class="opacity-50">·</span>
            <span class="text-[11px]">
              {glyphSteps().length} step{glyphSteps().length === 1 ? "" : "s"}
            </span>
            <span class="opacity-50">·</span>
            <ActionIconTrail glyphs={glyphSteps().map((step) => stepGlyph(step.kind))} max={8} />
          </Show>
          <Show when={targetName()}>
            <span class="opacity-50">·</span>
            <span class="max-w-[220px] truncate">{targetName()}</span>
          </Show>
          <Show when={props.job.appVersion}>
            <i class="font-mono text-[11px] not-italic">· build {props.job.appVersion}</i>
          </Show>
          <Show when={props.job.failureCategory}>
            <i class="truncate text-[11px] not-italic text-icon-critical-base">
              · {titleize(props.job.failureCategory!)}
            </i>
          </Show>
        </span>
        <Show when={frameThumbs().length > 0}>
          <span class="mt-1.5 flex items-center gap-1" aria-hidden="true">
            <For each={frameThumbs()}>
              {(src) => (
                <img
                  src={src}
                  alt=""
                  class="h-8 w-[18px] shrink-0 rounded-[3px] border border-border-weak-base object-cover opacity-90"
                />
              )}
            </For>
          </span>
        </Show>
      </span>
      <span class="grid justify-items-end gap-1.5">
        <span class="font-mono text-[11px] tabular-nums text-text-base">
          {fmtDur(props.job, server.clock()) || "—"}
        </span>
        <span class="inline-flex items-center gap-1.5 text-[10.5px] text-text-weaker">
          <span class={cn(mono, "text-[10.5px]")}>
            {fmtAgo(props.job.startedAt ?? props.job.queuedAt, server.clock()) || "now"}
          </span>
          <Icon name="chevron-right" size={13} />
        </span>
      </span>
    </button>
  );
}

/** Inputs make a recorded recipe an attachable reusable flow. The UI keeps the
 * declaration deliberately small: names are Git-visible, defaults are safe
 * data, and callers bind actual frozen values at the attachment point. */
