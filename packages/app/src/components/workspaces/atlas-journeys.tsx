import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useServer, type PersistedRun, type TraceFrameRef } from "../../context/server";
import { persistedAsJob } from "../../lib/persisted-run";
import { EmptyState } from "../empty-state";
import { StatusChip, jobStatusChip } from "../status-chip";
import { Icon } from "../icon";
import { cn } from "../../lib/cn";
import { fmtAgo, titleize } from "../../lib/job";
import { eyebrow, mono, stepIndex, stepIndexOn } from "../../lib/ui";
import { executionMoments, type ExecutionMoment } from "../../lib/execution-moments";
import { kindIcon, kindLabel } from "../step-list-metadata";

/**
 * A run's frame count lives on the wire (protocol RunSummary.frameCount) but
 * the app's PersistedRun type strips it since catalog rows are summaries
 * without full frames/steps arrays — this is the cheap "has evidence" signal
 * that doesn't require loading every run's detail up front.
 */
function runFrameCount(run: PersistedRun): number {
  return (run as unknown as { frameCount?: number }).frameCount ?? run.frames?.length ?? 0;
}

/** Most recent run with captured evidence, one per recipe/action — the raw
 * material for a journey walkthrough. Exported so the tab container can
 * decide its default tab without duplicating the grouping rule. */
export function deriveJourneys(runs: PersistedRun[]): PersistedRun[] {
  const byAction = new Map<string, PersistedRun>();
  for (const run of runs) {
    if (runFrameCount(run) === 0) continue;
    const existing = byAction.get(run.action);
    const runTime = run.finishedAt ?? run.startedAt ?? run.writtenAt ?? 0;
    if (!existing) {
      byAction.set(run.action, run);
      continue;
    }
    const existingTime = existing.finishedAt ?? existing.startedAt ?? existing.writtenAt ?? 0;
    if (runTime > existingTime) byAction.set(run.action, run);
  }
  return [...byAction.values()].sort(
    (a, b) => (b.finishedAt ?? b.startedAt ?? 0) - (a.finishedAt ?? a.startedAt ?? 0),
  );
}

/**
 * Atlas' journey walkthrough — populated purely as a side effect of running
 * tests. Every recipe with at least one persisted run that captured frames
 * becomes a browsable step-by-step reference, the same shape as the
 * competitor's journey view: numbered steps left/right, one big screenshot
 * center, PREV/NEXT to move through it.
 */
export function AtlasJourneys(props: { onOpenTests?: () => void }) {
  const server = useServer();
  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
  const [selectedStep, setSelectedStep] = createSignal(0);
  const requestedDetails = new Set<string>();

  // The global bootstrap already loads persisted runs, but a user who lands
  // directly on Atlas (never visiting Runs) still needs a fresh fetch.
  let requestedRuns = false;
  createEffect(() => {
    if (requestedRuns) return;
    requestedRuns = true;
    void server.refreshRuns();
  });

  const journeys = createMemo(() => deriveJourneys(server.persistedRuns()));
  const activeRunId = createMemo(() => selectedRunId() ?? journeys()[0]?.id ?? null);
  const activeRun = createMemo(
    () => server.persistedRuns().find((run) => run.id === activeRunId()) ?? null,
  );
  const activeJob = createMemo(() => {
    const run = activeRun();
    return run ? persistedAsJob(run) : null;
  });
  const recipeTitle = (run: PersistedRun) =>
    server.recipes().find((recipe) => recipe.id === run.action)?.title ??
    run.title ??
    titleize(run.action);

  // Catalog rows carry no steps/frames — load the full run once it's opened.
  createEffect(() => {
    const run = activeRun();
    if (run && !run.steps?.length && !requestedDetails.has(run.id)) {
      requestedDetails.add(run.id);
      void server.loadRunDetail(run.id);
    }
  });

  const moments = createMemo<ExecutionMoment[]>(() => {
    const job = activeJob();
    if (!job) return [];
    return executionMoments({ recipe: job.recipeSnapshot, job, recipes: server.recipes() });
  });
  const stepCount = () => Math.max(moments().length, 1);
  const stepIdx = () => Math.max(0, Math.min(selectedStep(), stepCount() - 1));
  const moment = () => moments()[stepIdx()];
  const kindFor = (index: number) =>
    (activeJob()?.recipeSnapshot ?? activeRun()?.recipeSnapshot)?.steps[index]?.kind;

  const openJourney = (run: PersistedRun) => {
    setSelectedRunId(run.id);
    setSelectedStep(0);
  };
  const move = (delta: number) =>
    setSelectedStep((current) => Math.max(0, Math.min(current + delta, stepCount() - 1)));

  const frameSrc = createMemo(() => {
    const run = activeRun();
    const step = moment();
    if (!run || !step) return null;
    const frame: TraceFrameRef | undefined = step.frame ?? run.frames?.[step.index];
    if (!frame) return null;
    if (frame.base64) return `data:${frame.mime || "image/png"};base64,${frame.base64}`;
    return server.frameUrlForPersisted(run, frame);
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show
        when={journeys().length > 0}
        fallback={
          <div class="grid min-h-0 flex-1 place-items-center px-6 py-10">
            <EmptyState
              size="lg"
              icon="move"
              title="Journeys appear as you run tests"
              description="Every run's evidence builds the map — run or record a test and its walkthrough shows up here automatically."
              actionLabel={props.onOpenTests ? "Open tests" : undefined}
              onAction={props.onOpenTests}
            />
          </div>
        }
      >
        <div class="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_280px] overflow-hidden max-[980px]:grid-cols-1 max-[980px]:overflow-y-auto">
          <aside
            class="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-[var(--v2-border-border-muted)] p-2 max-[980px]:border-r-0 max-[980px]:border-b"
            aria-label="Journeys"
          >
            <For each={journeys()}>
              {(run) => {
                const job = () => persistedAsJob(run);
                const chip = () => jobStatusChip(job().status);
                const frameCount = () => runFrameCount(run);
                const active = () => activeRunId() === run.id;
                return (
                  <button
                    type="button"
                    class={cn(
                      "grid w-full gap-1.5 rounded-lg px-2.5 py-2.5 text-left transition-colors duration-150",
                      active() ? "bg-surface-base-active" : "hover:bg-surface-base-hover",
                    )}
                    aria-current={active() ? "true" : undefined}
                    onClick={() => openJourney(run)}
                  >
                    <strong class="truncate text-[12.5px] font-medium text-text-strong">
                      {recipeTitle(run)}
                    </strong>
                    <span class="flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-weaker">
                      <StatusChip tone={chip().tone} label={chip().label} />
                      <span>
                        {frameCount()} step{frameCount() === 1 ? "" : "s"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span class={mono}>
                        {fmtAgo(run.finishedAt ?? run.startedAt, server.clock()) || "now"}
                      </span>
                    </span>
                  </button>
                );
              }}
            </For>
          </aside>

          <section
            class="relative flex min-h-0 flex-col overflow-hidden"
            tabindex={-1}
            aria-label="Journey walkthrough"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") move(-1);
              if (event.key === "ArrowRight") move(1);
            }}
          >
            <header class="flex shrink-0 items-center justify-between gap-3 px-5 pt-4">
              <div class="min-w-0">
                <span class={eyebrow}>Journey</span>
                <strong class="mt-0.5 block truncate text-[16px] font-semibold tracking-[-0.02em] text-text-strong">
                  <Show when={activeRun()} fallback="Select a journey">
                    {(run) => recipeTitle(run())}
                  </Show>
                </strong>
              </div>
              <span class={cn(mono, "shrink-0 text-[11px] text-text-weaker")}>
                Step {moments().length ? stepIdx() + 1 : 0} of {moments().length}
              </span>
            </header>

            <div class="flex shrink-0 gap-1 px-5 pt-3" aria-hidden="true">
              <For each={moments()}>
                {(m) => (
                  <span
                    class={cn(
                      "h-1.5 flex-1 rounded-full",
                      m.index <= stepIdx()
                        ? "bg-[var(--v2-background-bg-accent)]"
                        : "bg-[var(--v2-background-bg-layer-02)]",
                    )}
                  />
                )}
              </For>
            </div>

            <div class="grid min-h-0 flex-1 place-items-center px-8 py-5">
              <div class="relative flex h-full max-h-[520px] w-full max-w-[280px] items-center justify-center overflow-hidden rounded-[28px] border-[6px] border-[var(--v2-background-bg-layer-02)] bg-[var(--v2-background-bg-base)] shadow-[0_28px_70px_rgb(0_0_0/35%)]">
                <Show
                  when={frameSrc()}
                  fallback={
                    <div class="grid justify-items-center gap-1.5 px-6 text-center">
                      <Icon name="camera" size={16} class="text-text-weaker" />
                      <span class="text-[11px]/[1.4] text-text-weaker">
                        Not captured in this run
                      </span>
                    </div>
                  }
                >
                  {(src) => (
                    <img
                      src={src()}
                      alt={`Step ${stepIdx() + 1} evidence`}
                      class="h-full w-full object-contain"
                    />
                  )}
                </Show>
              </div>
            </div>

            <div class="mx-auto mb-4 flex max-w-[80%] items-center justify-center gap-2 px-4 text-center">
              <Icon
                name={kindFor(stepIdx()) ? kindIcon(kindFor(stepIdx())!) : "bolt"}
                size={12}
                class="text-text-weaker"
              />
              <p class="m-0 truncate text-[12.5px] font-medium text-text-base">{moment()?.title}</p>
            </div>

            <footer class="flex shrink-0 items-center justify-center gap-2 border-t border-[var(--v2-border-border-muted)] px-5 py-3">
              <button
                type="button"
                class="inline-flex min-h-8 items-center gap-1 rounded-lg px-3 text-[12px] font-medium text-text-base transition-colors hover:bg-surface-base-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-35"
                disabled={stepIdx() === 0}
                onClick={() => move(-1)}
              >
                <Icon name="chevron-left" size={13} /> Prev
              </button>
              <button
                type="button"
                class="inline-flex min-h-8 items-center gap-1 rounded-lg px-3 text-[12px] font-medium text-text-base transition-colors hover:bg-surface-base-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-35"
                disabled={stepIdx() >= stepCount() - 1}
                onClick={() => move(1)}
              >
                Next <Icon name="chevron-right" size={13} />
              </button>
            </footer>
          </section>

          <aside
            class="min-h-0 overflow-y-auto border-l border-[var(--v2-border-border-muted)] p-2 max-[980px]:border-l-0 max-[980px]:border-t"
            aria-label="Journey steps"
          >
            <For
              each={moments()}
              fallback={
                <div class="rounded-[10px] border border-dashed border-[var(--v2-border-border-muted)] px-3 py-5 text-center text-[11px] text-text-weaker">
                  No steps recorded for this run.
                </div>
              }
            >
              {(m) => {
                const active = () => stepIdx() === m.index;
                const kind = () => kindFor(m.index);
                return (
                  <button
                    type="button"
                    class={cn(
                      "grid w-full grid-cols-[26px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150",
                      active() ? "bg-surface-base-active" : "hover:bg-surface-base-hover",
                    )}
                    aria-current={active() ? "step" : undefined}
                    onClick={() => setSelectedStep(m.index)}
                  >
                    <span class={active() ? stepIndexOn : stepIndex}>
                      {String(m.index + 1).padStart(2, "0")}
                    </span>
                    <span class="min-w-0">
                      <span class="flex items-center gap-1 text-[9.5px] font-medium text-text-weaker">
                        <Icon name={kind() ? kindIcon(kind()!) : "bolt"} size={10} />
                        {kind() ? kindLabel(kind()!) : "Step"}
                      </span>
                      <strong class="mt-0.5 block truncate text-[11.5px] font-medium text-text-strong">
                        {m.title}
                      </strong>
                    </span>
                  </button>
                );
              }}
            </For>
          </aside>
        </div>
      </Show>
    </div>
  );
}
