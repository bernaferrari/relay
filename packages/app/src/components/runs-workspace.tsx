import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { useServer, type JobInfo, type PersistedRun, type RecipeInfo } from "../context/server";
import { RunSummary, friendlyError, readableFailure } from "./run-summary";
import { Icon, type IconName } from "./icon";
import { StatusChip, jobStatusChip } from "./status-chip";
import { ActionIconTrail } from "./action-icon-trail";
import { cn } from "../lib/cn";
import { fmtAgo, fmtDur, titleize } from "../lib/job";
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
import { sentenceForStep } from "../lib/step-sentence";
import { runFrameCanvasItems, type FrameCanvasItem } from "../lib/frame-canvas-presentation";
import {
  formatReviewTime,
  initialRunReviewStep,
  runCompletion,
  runElapsedAtStep,
  runReviewCounts,
  runTimelineWeights,
} from "../lib/run-review-model";

export function RunsWorkspace(props: {
  onOpenRecipe: (id: string) => void;
  onOpenTests: () => void;
}) {
  const server = useServer();
  const linkedRun = new URLSearchParams(window.location.search).get("run");
  const [selectedId, setSelectedId] = createSignal<string | null>(linkedRun);
  const [selectedRunStep, setSelectedRunStep] = createSignal(0);
  const [tab, setTab] = createSignal<
    "timeline" | "summary" | "evaluation" | "network" | "logs" | "compatibility"
  >("timeline");
  const [matrixReport, setMatrixReport] = createSignal<
    import("@relay/protocol").CompatibilityReport | null
  >(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runFilter, setRunFilter] = createSignal<"all" | "passed" | "attention" | "active">("all");
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
    if (filter === "passed")
      return rows().filter((row) => row.status === "ok" || row.status === "healed");
    if (filter === "attention")
      return rows().filter((row) => row.status === "error" || row.status === "cancelled");
    if (filter === "active")
      return rows().filter((row) => ["queued", "running", "paused"].includes(row.status));
    return rows();
  });
  const passedCount = createMemo(
    () => rows().filter((row) => row.status === "ok" || row.status === "healed").length,
  );
  const passRate = createMemo(() =>
    rows().length > 0 ? Math.round((passedCount() / rows().length) * 100) : 0,
  );
  const typicalDuration = createMemo(() => {
    const durations = rows()
      .map((row) =>
        row.startedAt && row.finishedAt ? Math.max(0, row.finishedAt - row.startedAt) : null,
      )
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    if (durations.length === 0) return "—";
    return formatReviewTime(durations[Math.floor(durations.length / 2)]!);
  });
  const selected = () => rows().find((row) => row.id === selectedId()) ?? null;
  const openRun = (job: JobInfo) => {
    setSelectedId(job.id);
    server.setSelectedJobId(job.id);
    setSelectedRunStep(initialRunReviewStep(job));
    setTab("timeline");
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
    setSelectedRunStep(initialRunReviewStep(requestedRun));
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
      <Show when={rows().length > 0 && !selected()}>
        <div class="mx-auto mb-5 grid w-full max-w-[1080px] grid-cols-4 gap-2 max-[760px]:grid-cols-2">
          <Metric
            label="Pass rate"
            value={`${passRate()}%`}
            detail="across saved runs"
            tone={passRate() > 0 ? "success" : undefined}
          />
          <Metric label="Passed" value={passedCount()} detail="including healed" tone="success" />
          <Metric
            label="Needs attention"
            value={rows().filter((row) => row.status === "error").length}
            detail="failed runs"
            tone="danger"
          />
          <Metric label="Typical time" value={typicalDuration()} detail="median duration" />
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
                      ["all", "All"],
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
                <span class="font-mono text-[10.5px] text-text-weaker">
                  {visibleRows().length} run{visibleRows().length === 1 ? "" : "s"}
                </span>
              </div>
            </Show>
            <For
              each={visibleRows()}
              fallback={
                <Show
                  when={rows().length === 0}
                  fallback={
                    <div class="grid place-items-center gap-2 px-8 py-14 text-center">
                      <span class="grid size-10 place-items-center rounded-xl bg-surface-base-active text-text-weaker">
                        <Icon name="search" size={17} />
                      </span>
                      <strong class="text-[13px] font-medium text-text-base">
                        No {runFilter()} runs
                      </strong>
                      <button
                        type="button"
                        class="text-[11.5px] font-medium text-text-interactive-base hover:underline"
                        onClick={() => setRunFilter("all")}
                      >
                        Show all runs
                      </button>
                    </div>
                  }
                >
                  <div class="grid place-items-center gap-3 px-8 py-14 text-center">
                    <span class="grid size-10 place-items-center rounded-xl bg-surface-base-active text-text-weaker">
                      <Icon name="wave" size={17} />
                    </span>
                    <p class="m-0 max-w-[32ch] text-[12.5px]/[1.5] text-text-weak">
                      Run a test to keep its result, replay, and diagnostics together.
                    </p>
                    <button type="button" class={productPrimary} onClick={props.onOpenTests}>
                      Run your first test
                    </button>
                  </div>
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
              onSelect={setSelectedRunStep}
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
            <aside class="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--relay-line)] bg-[var(--relay-panel)]">
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
                    <span class="shrink-0 text-text-weaker">Target</span>
                    <span class="truncate text-text-base">
                      {job().targetProfile?.name ?? job().serial ?? "Not recorded"}
                    </span>
                  </span>
                </div>
              </header>
              <Show when={job().status === "error" || job().status === "cancelled"}>
                <div class="mx-4 mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--relay-red)_28%,var(--relay-line))] bg-[color-mix(in_srgb,var(--relay-red)_7%,transparent)] px-3 py-2.5">
                  <span class="mt-0.5 grid size-6 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--relay-red)_14%,transparent)] text-[var(--relay-red)]">
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
                    ["timeline", "Steps"],
                    ["summary", "Summary"],
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
                    onSelect={setSelectedRunStep}
                  />
                </Show>
                <Show when={tab() === "summary"}>
                  <RunSummary
                    job={job()}
                    clock={server.clock()}
                    previous={baseline()}
                    onOpenRecipe={props.onOpenRecipe}
                  />
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
                            Target identifier
                          </dt>
                          <dd class="m-0 flex min-w-0 items-center gap-1.5">
                            <code class="truncate text-[10px]/[1.25] text-text-weak">
                              {job().serial}
                            </code>
                            <button
                              type="button"
                              class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker hover:bg-surface-base-hover hover:text-text-base"
                              aria-label="Copy target identifier"
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
                  <pre class="m-0 max-h-64 overflow-auto rounded-lg border border-[var(--relay-line)] bg-[var(--relay-bg)] p-3 font-mono text-[10px]/[1.45] text-[var(--relay-text-secondary)]">
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
      class="flex min-h-0 flex-col border-r border-[var(--relay-line)] bg-[var(--relay-panel)] max-[1180px]:hidden"
      aria-label="Run browser"
    >
      <header class="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--relay-line)] px-3.5">
        <div>
          <strong class="block text-[12.5px] font-semibold text-[var(--relay-text)]">Runs</strong>
          <small class="text-[10px] text-[var(--relay-text-tertiary)]">
            {props.rows.length} saved
          </small>
        </div>
        <span class="grid size-7 place-items-center rounded-lg bg-[var(--relay-surface-raised)] text-[var(--relay-text-tertiary)]">
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
                  "mb-0.5 grid min-h-[58px] w-full grid-cols-[8px_minmax(0,1fr)] items-center gap-2 rounded-[9px] px-2.5 text-left outline-none transition-[background-color,transform] duration-150 active:scale-[0.99] focus-visible:ring-1 focus-visible:ring-white/60",
                  props.selectedId === job.id
                    ? "bg-[var(--relay-surface-strong)]"
                    : "hover:bg-[var(--relay-surface-raised)]",
                )}
                aria-current={props.selectedId === job.id ? "page" : undefined}
                onClick={() => props.onSelect(job)}
              >
                <span
                  class={cn(
                    "size-1.5 rounded-full",
                    status().tone === "pass"
                      ? "bg-[var(--relay-green)]"
                      : status().tone === "fail"
                        ? "bg-[var(--relay-red)]"
                        : "bg-[var(--relay-accent)]",
                  )}
                  aria-hidden="true"
                />
                <span class="min-w-0">
                  <strong class="block truncate text-[11.5px] font-medium text-[var(--relay-text)]">
                    {recipe()?.title ?? job.title ?? job.action}
                  </strong>
                  <small class="mt-1 flex items-center gap-1.5 text-[9.5px] text-[var(--relay-text-tertiary)]">
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

function persistedAsJob(run: PersistedRun): JobInfo {
  const status = ["queued", "running", "paused", "ok", "error", "healed", "cancelled"].includes(
    run.status,
  )
    ? (run.status as JobInfo["status"])
    : "error";
  return {
    ...run,
    status,
    queuedAt: run.queuedAt ?? run.startedAt ?? run.writtenAt,
    logs: run.logs ?? [],
    attempts: run.attempts ?? 1,
  };
}

function CompatibilityReportPanel(props: {
  report: import("@relay/protocol").CompatibilityReport | null;
  selectedProfileId: string;
}) {
  return (
    <Show
      when={props.report}
      fallback={
        <div class="rounded-[10px] border border-dashed border-[var(--relay-line)] px-3 py-4 text-center text-[11px] text-[var(--relay-text-tertiary)]">
          Preparing the comparison…
        </div>
      }
    >
      {(report) => (
        <div class="grid gap-3">
          <header class="flex items-start justify-between gap-3">
            <div>
              <span class={eyebrow}>Compatibility matrix</span>
              <strong class="mt-0.5 block text-[13px] text-[var(--relay-text)]">
                {report().matrixName ?? "Target comparison"}
              </strong>
              <small class="mt-0.5 block text-[10px] text-[var(--relay-text-tertiary)]">
                {report().profiles.length} target{report().profiles.length === 1 ? "" : "s"} ·{" "}
                {report().total} evidence run{report().total === 1 ? "" : "s"}
              </small>
            </div>
            <span class="shrink-0 rounded-full border border-[var(--relay-line)] px-[7px] py-1 text-[9px] tracking-[0.08em] text-[var(--relay-text-tertiary)] uppercase">
              Same test setup
            </span>
          </header>
          <div class="grid gap-2">
            <For each={report().profiles}>
              {(profile) => (
                <article
                  class={cn(
                    "grid gap-2.5 rounded-[10px] border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-surface-raised)_55%,transparent)] p-3",
                    profile.profile.id === props.selectedProfileId &&
                      "border-[color-mix(in_srgb,var(--text-interactive-base)_58%,var(--relay-line))] shadow-[inset_2px_0_var(--text-interactive-base)]",
                  )}
                >
                  <header class="flex items-start justify-between gap-3">
                    <div>
                      <strong class="block text-[13px] text-[var(--relay-text)]">
                        {profile.profile.name}
                      </strong>
                      <small class="mt-0.5 block text-[10px] text-[var(--relay-text-tertiary)]">
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
                    <span class="grid gap-0.5 rounded-[7px] bg-[var(--relay-panel)] p-2">
                      <b class="text-[9px] font-medium tracking-[0.08em] text-[var(--relay-text-tertiary)] uppercase">
                        Pass rate
                      </b>
                      <strong class="text-[12px] text-[var(--relay-text)]">
                        {profile.passRate == null
                          ? "No product verdict yet"
                          : `${Math.round(profile.passRate * 100)}%`}
                      </strong>
                    </span>
                    <span class="grid gap-0.5 rounded-[7px] bg-[var(--relay-panel)] p-2">
                      <b class="text-[9px] font-medium tracking-[0.08em] text-[var(--relay-text-tertiary)] uppercase">
                        Median duration
                      </b>
                      <strong class="text-[12px] text-[var(--relay-text)]">
                        {profile.medianDurationMs == null
                          ? "—"
                          : `${(profile.medianDurationMs / 1000).toFixed(1)}s`}
                      </strong>
                    </span>
                  </div>
                  <p class="m-0 text-[10px]/[1.45] text-[var(--relay-text-secondary)]">
                    {profile.passed} passed · {profile.productFailures} product ·{" "}
                    {profile.harnessFailures} harness
                    {profile.uncertain ? ` · ${profile.uncertain} uncertain` : ""}
                    {profile.pending ? ` · ${profile.pending} pending` : ""}
                  </p>
                  <Show when={profile.baseline}>
                    {(baseline) => (
                      <footer class="border-t border-[var(--relay-line)] pt-2 text-[10px]/[1.4] text-[var(--relay-text-tertiary)]">
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

type RunCanvasState = "passed" | "failed" | "running" | "planned" | "cancelled";

type RunCanvasNode = {
  index: number;
  title: string;
  state: RunCanvasState;
  durationMs?: number;
  frame?: NonNullable<JobInfo["steps"]>[number]["frames"][number];
  observed: boolean;
  /** Low-level actions the step performed (tap, wait, type, ...), when traced. */
  glyphs?: string[];
};

function runCanvasNodes(job: JobInfo, recipes: RecipeInfo[]): RunCanvasNode[] {
  const recipe = job.recipeSnapshot ?? recipes.find((item) => item.id === job.action);
  const observed = job.steps ?? [];
  const count = Math.max(observed.length, recipe?.steps.length ?? 0, 1);

  return Array.from({ length: count }, (_, index) => {
    const trace = observed[index];
    const planned = recipe?.steps[index];
    let state: RunCanvasState = "planned";
    if (trace) {
      if (trace.status === "error" || trace.tone === "danger") state = "failed";
      else if (job.status === "running" && index === observed.length - 1) state = "running";
      else if (job.status === "cancelled" && index === observed.length - 1) state = "cancelled";
      else state = "passed";
    }
    return {
      index,
      title: trace?.title ?? (planned ? sentenceForStep(planned, recipes) : "Run started"),
      state,
      durationMs: trace?.durationMs,
      frame: trace?.frames?.at(-1),
      observed: Boolean(trace),
      glyphs: trace?.glyphs && trace.glyphs.length > 0 ? trace.glyphs : undefined,
    };
  });
}

function formatStepDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function runStateLabel(state: RunCanvasState): string {
  switch (state) {
    case "passed":
      return "Passed";
    case "failed":
      return "Stopped here";
    case "running":
      return "Running";
    case "cancelled":
      return "Cancelled";
    default:
      return "Not reached";
  }
}

function runStateDot(state: RunCanvasState): string {
  if (state === "failed" || state === "cancelled") return "bg-[var(--relay-red)]";
  if (state === "planned") return "bg-[var(--relay-line-strong)]";
  if (state === "running") return "bg-[var(--relay-accent)] shadow-[0_0_8px_var(--relay-accent)]";
  return "bg-[var(--relay-green)]";
}

/** Timeline scrubber segment fill — deliberately calmer than `runStateDot`'s
 * small status dots. Passed steps stay a neutral surface tone rather than a
 * saturated green field; color is reserved as a muted tint for the segment
 * that is currently failed or in progress, never an opaque alarm fill. */
function runTimelineSegmentFill(state: RunCanvasState): string {
  if (state === "failed" || state === "cancelled")
    return "bg-[color-mix(in_srgb,var(--relay-red)_20%,var(--relay-surface-raised))]";
  if (state === "running")
    return "bg-[color-mix(in_srgb,var(--relay-accent)_20%,var(--relay-surface-raised))]";
  if (state === "planned") return "bg-[var(--relay-line-strong)]";
  return "bg-[var(--relay-surface-raised)]";
}

/** Left half of a run report: the captured evidence, framed like a device,
 * with a step timeline scrubber underneath. */
function RunReplayStage(props: {
  job: JobInfo;
  items: FrameCanvasItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onBack: () => void;
}) {
  const server = useServer();
  const [playing, setPlaying] = createSignal(false);
  const nodes = createMemo(() => runCanvasNodes(props.job, server.recipes()));
  const count = () => Math.max(nodes().length, 1);
  const index = () => Math.max(0, Math.min(props.selectedIndex, count() - 1));
  const node = () => nodes()[index()];
  const timelineWeights = createMemo(() => runTimelineWeights(props.job.steps ?? [], count()));
  const elapsed = () => runElapsedAtStep(props.job.steps ?? [], index());
  const totalDuration = () =>
    (props.job.steps ?? []).reduce(
      (duration, step) => duration + Math.max(0, step.durationMs ?? 0),
      0,
    );
  const snapshot = () =>
    props.job.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === props.job.action);
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
  /** Marker position for the scrubber handle — center of the active segment. */
  const progressPct = createMemo(() => {
    const weights = timelineWeights();
    const i = index();
    let before = 0;
    for (let k = 0; k < i; k++) before += weights[k] ?? 0;
    return Math.min(100, Math.max(0, (before + (weights[i] ?? 0) * 0.5) * 100));
  });
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
  createEffect(() => {
    if (!playing()) return;
    const current = index();
    if (current >= count() - 1) {
      setPlaying(false);
      return;
    }
    const rawDuration = props.job.steps?.[current]?.durationMs ?? 700;
    const timer = window.setTimeout(
      () => props.onSelect(Math.min(current + 1, count() - 1)),
      Math.max(650, Math.min(rawDuration, 2_200)),
    );
    onCleanup(() => window.clearTimeout(timer));
  });
  return (
    <section
      class="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--relay-bg)_94%,black)]"
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
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,color-mix(in_srgb,var(--relay-accent)_7%,transparent),transparent_52%),radial-gradient(circle,color-mix(in_srgb,var(--relay-line-strong)_42%,transparent)_1px,transparent_1px)] [background-size:auto,20px_20px]"
        aria-hidden="true"
      />
      <header class="relative z-[1] flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5">
        <button
          type="button"
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-[var(--relay-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--relay-text)]"
          onClick={props.onBack}
        >
          <Icon name="chevron-left" size={14} /> All runs
        </button>
      </header>
      <div class="relative z-[1] grid min-h-0 flex-1 place-items-center px-8 py-5">
        {/* Phone bezel — always renders; only the interior swaps between the
            captured frame and a calm inline note when evidence is missing. */}
        <div class="relative flex h-full max-h-[560px] w-full max-w-[300px] items-center justify-center">
          <span class="absolute top-2 left-2 z-10 inline-flex items-center gap-1.5 rounded-full border border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_90%,transparent)] px-2.5 py-1 font-mono text-[9.5px] tracking-[0.05em] text-[var(--relay-text-tertiary)] uppercase shadow-[0_6px_16px_rgb(0_0_0/30%)] backdrop-blur">
            <i class={cn("size-1.5 rounded-full", runStateDot(node()?.state ?? "planned"))} />
            Step {String(index() + 1).padStart(2, "0")} ·{" "}
            {runStateLabel(node()?.state ?? "planned")}
          </span>
          {/* Bezel border stays neutral regardless of run state — the floating
              step badge's dot is the accent that carries pass/fail, per the
              rule that alarm colors never tint a large chrome surface. */}
          <div class="relative flex aspect-[9/19] h-full max-h-full w-full items-center justify-center overflow-hidden rounded-[32px] border-[6px] border-[var(--relay-surface-strong)] bg-[var(--relay-panel)] shadow-[0_36px_90px_rgb(0_0_0/50%),0_0_0_1px_rgb(255_255_255/5%)]">
            <span
              class="absolute top-0 left-1/2 z-[1] h-4 w-24 -translate-x-1/2 rounded-b-xl bg-[var(--relay-surface-strong)]"
              aria-hidden="true"
            />
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
      <footer class="relative z-[1] shrink-0 border-t border-[var(--relay-line)] bg-[color-mix(in_srgb,var(--relay-panel)_86%,transparent)] px-4 py-3 backdrop-blur">
        <div class="flex items-center gap-3">
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="grid size-8 place-items-center rounded-lg bg-[var(--relay-surface-strong)] text-[var(--relay-text)] transition-[background-color,transform] duration-150 hover:bg-white/[0.1] active:scale-[0.96]"
              aria-label={playing() ? "Pause run playback" : "Play run playback"}
              aria-pressed={playing()}
              onClick={togglePlayback}
            >
              <Icon name={playing() ? "pause" : "play"} size={12} />
            </button>
            <button
              type="button"
              class="grid size-8 place-items-center rounded-lg text-[var(--relay-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--relay-text)] disabled:opacity-30"
              aria-label="Previous step"
              disabled={index() === 0}
              onClick={() => {
                setPlaying(false);
                move(-1);
              }}
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <button
              type="button"
              class="grid size-8 place-items-center rounded-lg text-[var(--relay-text-secondary)] transition-colors hover:bg-white/[0.06] hover:text-[var(--relay-text)] disabled:opacity-30"
              aria-label="Next step"
              disabled={index() === count() - 1}
              onClick={() => {
                setPlaying(false);
                move(1);
              }}
            >
              <Icon name="chevron-right" size={15} />
            </button>
          </div>
          <span class={cn(mono, "shrink-0 text-[11px] text-text-weaker")}>
            {formatReviewTime(elapsed())} <span class="text-text-weaker">/</span>{" "}
            {formatReviewTime(totalDuration())}
          </span>
          {/* Segmented scrubber: one bar per step, width proportional to its
              duration (clamped so short steps stay targetable), step number
              underneath. Passed steps stay a neutral surface tone; only the
              failed or in-progress segment gets a muted color tint. No
              per-action ticks — the trace only records one timestamp per
              step, not per glyph. */}
          <div class="relative min-w-0 flex-1 py-1">
            <div class="flex items-end gap-[3px]" role="tablist" aria-label="Run timeline">
              <For each={nodes()}>
                {(item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={item.index === index()}
                    aria-label={`Step ${item.index + 1}: ${item.title} — ${runStateLabel(item.state)}`}
                    data-tip={item.title}
                    class="group flex min-w-[14px] flex-1 flex-col items-center gap-1"
                    style={{
                      "flex-grow": String(timelineWeights()[item.index] ?? 1),
                      "flex-basis": "0",
                    }}
                    onClick={() => {
                      setPlaying(false);
                      props.onSelect(item.index);
                    }}
                  >
                    <span
                      class={cn(
                        "h-6 w-full rounded-[3px] transition-[background-color,box-shadow]",
                        runTimelineSegmentFill(item.state),
                        "group-hover:opacity-90",
                        item.index === index() &&
                          "shadow-[0_0_0_2px_color-mix(in_srgb,var(--relay-accent)_40%,transparent)]",
                      )}
                    />
                    <i
                      class={cn(
                        "font-mono text-[11px] tabular-nums not-italic",
                        item.index === index()
                          ? "font-semibold text-text-interactive-base"
                          : "text-text-weaker",
                      )}
                    >
                      {item.index + 1}
                    </i>
                  </button>
                )}
              </For>
            </div>
            <span
              class="pointer-events-none absolute -top-1 h-6 w-0.5 -translate-x-1/2 rounded-full bg-[var(--relay-accent)] shadow-[0_0_6px_var(--relay-accent)]"
              style={{ left: `${progressPct()}%` }}
              aria-hidden="true"
            />
          </div>
        </div>
      </footer>
    </section>
  );
}

/** The Steps tab of a run report — the reference reading surface. */
function RunStepList(props: {
  job: JobInfo;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const server = useServer();
  const nodes = createMemo(() => runCanvasNodes(props.job, server.recipes()));
  const snapshot = () =>
    props.job.recipeSnapshot ?? server.recipes().find((recipe) => recipe.id === props.job.action);
  return (
    <div class="grid content-start">
      <div class="relative grid content-start before:absolute before:top-8 before:bottom-8 before:left-6 before:w-px before:bg-[var(--relay-line-strong)]">
        <For
          each={nodes()}
          fallback={
            <div class="rounded-[10px] border border-dashed border-[var(--relay-line)] px-3 py-5 text-center text-[12px] text-[var(--relay-text-tertiary)]">
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
                    ? "bg-[color-mix(in_srgb,var(--relay-accent)_11%,var(--relay-panel))]"
                    : "hover:bg-[var(--relay-surface-raised)]",
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
                    "relative z-[1] grid size-8 place-items-center rounded-[9px] border bg-[var(--relay-panel)] font-mono text-[11px] font-semibold tabular-nums",
                    active()
                      ? "border-[var(--relay-accent)] text-[var(--text-interactive-base)]"
                      : node.state === "failed"
                        ? "border-[var(--relay-red)] text-[var(--relay-red)]"
                        : "border-[var(--relay-line-strong)] text-[var(--relay-text-tertiary)]",
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
                    <Show when={node.glyphs}>
                      {(glyphs) => (
                        <>
                          <span class="shrink-0 text-text-weaker/70">·</span>
                          <ActionIconTrail glyphs={glyphs()} max={6} />
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
          <div class="rounded-[10px] border border-dashed border-[var(--relay-line)] px-3 py-4 text-center text-[11px] text-[var(--relay-text-tertiary)]">
            {props.empty}
          </div>
        }
      >
        {(item) => {
          const summary = () => evidenceSummary(item.data);
          return (
            <article class="overflow-hidden rounded-xl border border-[var(--relay-line)] bg-[var(--relay-surface-raised)]">
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
              <details class="group border-t border-[var(--relay-line)]">
                <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-3 text-[10px] font-medium text-text-weaker hover:text-text-base [&::-webkit-details-marker]:hidden">
                  View payload
                  <Icon
                    name="chevron-down"
                    size={11}
                    class="transition-transform duration-150 group-open:rotate-180"
                  />
                </summary>
                <pre class="m-0 max-h-64 overflow-auto border-t border-[var(--relay-line)] bg-[var(--relay-bg)] p-3 font-mono text-[10px]/[1.5] text-[var(--relay-text-secondary)]">
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
    return target
      ? presentTarget(target).displayName
      : props.job.serial
        ? "Unavailable target"
        : "—";
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
      recipe()?.title ?? props.job.action,
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
        "group mb-2 grid min-h-[76px] w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border-weak-base bg-background-stronger px-3.5 text-left text-[12px]/[1.35] text-text-weak shadow-[0_7px_20px_rgb(0_0_0/7%)] transition-[background-color,border-color,transform,box-shadow] duration-150 last:mb-0 hover:-translate-y-px hover:border-[var(--relay-line-strong)] hover:bg-[var(--relay-surface-raised)] hover:shadow-[0_11px_28px_rgb(0_0_0/13%)] active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus",
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
          {recipe()?.title ?? props.job.action}
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
          <span class="opacity-50">·</span>
          <span class="text-[11px]">
            {glyphSteps().length} step{glyphSteps().length === 1 ? "" : "s"}
          </span>
          <span class="opacity-50">·</span>
          <span class="max-w-[220px] truncate">{targetName()}</span>
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
          <Icon
            name="chevron-right"
            size={13}
            class="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </span>
    </button>
  );
}

function Metric(props: {
  label: string;
  value: number | string;
  detail: string;
  tone?: "success" | "danger";
}) {
  return (
    <div class="grid min-w-0 gap-1 rounded-xl border border-border-weak-base bg-background-stronger px-3.5 py-3 shadow-[0_6px_18px_rgb(0_0_0/6%)]">
      <strong
        class={cn(
          "font-mono text-[22px]/none font-semibold tracking-[-0.04em] tabular-nums text-text-strong",
          props.tone === "success" && "text-text-success-base",
          props.tone === "danger" && "text-text-critical-base",
        )}
      >
        {props.value}
      </strong>
      <span class="text-[11.5px]/[1.25] font-medium text-text-base">{props.label}</span>
      <small class="text-[10px]/[1.25] text-text-weaker">{props.detail}</small>
    </div>
  );
}

/** Inputs make a recorded recipe an attachable reusable flow. The UI keeps the
 * declaration deliberately small: names are Git-visible, defaults are safe
 * data, and callers bind actual frozen values at the attachment point. */
