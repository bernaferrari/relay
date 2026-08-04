import { Show, createEffect, createMemo } from "solid-js";
import { Button } from "@relay/ui/button";
import { useServer, type JobInfo } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { shellAsideDrawer } from "../lib/shell-layout";
import { fmtDur } from "../lib/job";
import { sentenceForStep } from "../lib/step-sentence";
import {
  executionMoments,
  executionStateDetail,
  executionStateForJob,
  executionStateLabel,
  type ExecutionMomentState,
} from "../lib/execution-moments";
import { eyebrow } from "../lib/ui";
import { friendlyError } from "../lib/run-failure-presentation";
import { Icon } from "./icon";

function stateTone(state: ExecutionMomentState): string {
  if (state === "passed") return "text-[var(--icon-success-base)]";
  if (state === "failed") return "text-[var(--icon-critical-base)]";
  if (state === "paused") return "text-[var(--icon-warning-base)]";
  return "text-[var(--text-interactive-base)]";
}

/**
 * The execution half of the test workbench. It deliberately occupies the same
 * inspector as editing: the step list and device never move when a run starts.
 */
export function ExecutionInspector(props: { job: JobInfo; onOpenReport: (id: string) => void }) {
  const server = useServer();
  const workbench = useWorkbench();
  const recipe = createMemo(
    () =>
      props.job.recipeSnapshot ??
      server.recipes().find((item) => item.id === props.job.action) ??
      null,
  );
  const moments = createMemo(() =>
    executionMoments({ recipe: recipe(), job: props.job, recipes: server.recipes() }),
  );
  const state = createMemo(() => executionStateForJob(props.job.status));
  const total = createMemo(() =>
    Math.max(recipe()?.steps.length ?? 0, props.job.steps?.length ?? 0, 1),
  );
  const observed = createMemo(() => props.job.steps?.length ?? 0);
  const currentIndex = createMemo(() => {
    if (observed() === 0) return 0;
    return Math.min(observed() - 1, total() - 1);
  });
  const focusedIndex = createMemo(() =>
    Math.max(0, Math.min(workbench.focusedIndex() ?? currentIndex(), total() - 1)),
  );
  const focusedTrace = createMemo(() => props.job.steps?.[focusedIndex()]);
  const focusedRecipeStep = createMemo(() => recipe()?.steps[focusedIndex()]);
  const focusedMoment = createMemo(() => moments()[focusedIndex()]);
  const focusedTitle = createMemo(
    () =>
      focusedTrace()?.title ??
      (focusedRecipeStep()
        ? sentenceForStep(focusedRecipeStep()!, server.recipes())
        : `Step ${focusedIndex() + 1}`),
  );

  createEffect(() => {
    const index = currentIndex();
    server.selectedAppMapId();
    // Recipe selection seeds the draft and initially focuses its first step in
    // a microtask. Follow it so opening a completed run lands on the observed
    // (usually failed) moment across the list, device, and inspector.
    queueMicrotask(() => workbench.focusStep(index));
  });

  const action = () => {
    if (state() === "queued") return void server.cancelJob(props.job.id);
    if (state() === "paused") return void server.resumeJob(props.job.id);
    if (state() === "failed") return void server.retrySelectedJob(props.job.id);
    if (state() === "passed") return props.onOpenReport(props.job.id);
    return void server.pauseJob(props.job.id);
  };

  return (
    <aside
      class={cn(
        "flex min-h-0 min-w-0 flex-col border-l border-[var(--v2-border-border-muted)] bg-[var(--v2-background-bg-base)]",
        shellAsideDrawer,
      )}
      aria-label="Execution progress"
      aria-live="polite"
    >
      <header class="border-b border-[var(--v2-border-border-muted)] px-5 pt-5 pb-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <span class={eyebrow}>Execution</span>
            <h2
              class={cn("mt-1.5 text-[19px] font-semibold tracking-[-0.025em]", stateTone(state()))}
            >
              {executionStateLabel(state())}
            </h2>
            <p class="mt-1 text-[12px]/[1.45] text-[var(--text-base)]">
              {executionStateDetail(state())}
            </p>
          </div>
          <span
            class={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              state() === "passed"
                ? "bg-[var(--icon-success-base)]"
                : state() === "failed"
                  ? "bg-[var(--icon-critical-base)]"
                  : state() === "paused"
                    ? "bg-[var(--icon-warning-base)]"
                    : "bg-[var(--v2-background-bg-accent)] shadow-[0_0_10px_var(--v2-background-bg-accent)]",
            )}
            aria-hidden="true"
          />
        </div>

        <div class="mt-4 flex items-end justify-between gap-3">
          <div>
            <strong class="font-mono text-[13px] tabular-nums text-[var(--text-strong)]">
              Step {Math.min(currentIndex() + 1, total())} of {total()}
            </strong>
            <Show when={fmtDur(props.job, server.clock())}>
              {(duration) => (
                <small class="ml-2 font-mono text-[10.5px] tabular-nums text-[var(--text-weak)]">
                  {duration()}
                </small>
              )}
            </Show>
          </div>
          <span class="font-mono text-[10.5px] tabular-nums text-[var(--text-weak)]">
            {Math.min(observed(), total())} reached
          </span>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <section class="rounded-xl bg-[var(--v2-background-bg-layer-01)] p-4 shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]">
          <div class="flex items-center justify-between gap-3">
            <span class={eyebrow}>Selected step</span>
            <span class="font-mono text-[10px] tabular-nums text-[var(--text-weak)]">
              {focusedTrace()?.durationMs
                ? focusedTrace()!.durationMs! < 1000
                  ? `${Math.round(focusedTrace()!.durationMs!)}ms`
                  : `${(focusedTrace()!.durationMs! / 1000).toFixed(1)}s`
                : "—"}
            </span>
          </div>
          <strong class="mt-2 block text-[14px]/[1.4] font-medium text-[var(--text-strong)]">
            {focusedTitle()}
          </strong>
          <div class="mt-3 flex items-center gap-2 text-[11px] text-[var(--text-base)]">
            <span
              class={cn(
                "size-1.5 rounded-full",
                focusedMoment()?.state === "passed"
                  ? "bg-[var(--icon-success-base)]"
                  : focusedMoment()?.state === "failed"
                    ? "bg-[var(--icon-critical-base)]"
                    : focusedMoment()?.state === "running"
                      ? "bg-[var(--v2-background-bg-accent)]"
                      : "bg-[var(--text-weak)]",
              )}
            />
            {executionStateLabel(focusedMoment()?.state ?? "planned", "step")}
          </div>
          <Show when={focusedMoment()?.state === "failed" && props.job.error}>
            <p class="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--icon-critical-base)_9%,transparent)] px-3 py-2.5 text-[11.5px]/[1.45] text-[var(--text-base)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--icon-critical-base)_24%,transparent)]">
              {friendlyError(props.job.error!)}
            </p>
          </Show>
        </section>

        <Show when={props.job.waitingFor}>
          {(checkpoint) => (
            <section class="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--icon-warning-base)_8%,var(--v2-background-bg-layer-01))] p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--icon-warning-base)_28%,var(--v2-border-border-muted))]">
              <span class={eyebrow}>Do this on the device</span>
              <strong class="mt-2 block text-[13px]/[1.4] text-[var(--text-strong)]">
                {checkpoint().message}
              </strong>
            </section>
          )}
        </Show>
      </div>

      <footer class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-[var(--v2-border-border-muted)] p-3">
        <Button variant="secondary" size="lg" onClick={() => props.onOpenReport(props.job.id)}>
          View report
        </Button>
        <Button variant="primary" size="lg" onClick={action}>
          <Icon
            name={
              state() === "paused"
                ? "play"
                : state() === "queued"
                  ? "x"
                  : state() === "failed"
                    ? "refresh"
                    : state() === "passed"
                      ? "chevron-right"
                      : "pause"
            }
            size={13}
          />
          {state() === "paused"
            ? props.job.waitingFor?.resumeLabel || "Continue"
            : state() === "queued"
              ? "Cancel"
              : state() === "failed"
                ? "Retry"
                : state() === "passed"
                  ? "Review"
                  : "Pause"}
        </Button>
        <Show when={state() === "running" || state() === "paused"}>
          <button
            type="button"
            class="col-span-2 min-h-9 rounded-lg text-[11.5px] font-medium text-[var(--text-weak)] hover:bg-[var(--v2-background-bg-layer-01)] hover:text-[var(--icon-critical-base)]"
            onClick={() => void server.cancelJob(props.job.id)}
          >
            Stop run
          </button>
        </Show>
      </footer>
    </aside>
  );
}
