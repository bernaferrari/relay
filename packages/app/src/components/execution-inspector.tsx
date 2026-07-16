import { Show, createEffect, createMemo } from "solid-js";
import { useServer, type JobInfo } from "../context/server";
import { useWorkbench } from "../context/workbench";
import { cn } from "../lib/cn";
import { fmtDur } from "../lib/job";
import { sentenceForStep } from "../lib/step-sentence";
import { eyebrow, productPrimary, productSecondary } from "../lib/ui";
import { friendlyError } from "./run-summary";
import { Icon } from "./icon";

type ExecutionState = "queued" | "running" | "paused" | "passed" | "failed";

function stateFor(job: JobInfo): ExecutionState {
  if (job.status === "queued") return "queued";
  if (job.status === "running") return "running";
  if (job.status === "paused") return "paused";
  if (job.status === "ok" || job.status === "healed") return "passed";
  return "failed";
}

function stateCopy(state: ExecutionState): { label: string; detail: string } {
  switch (state) {
    case "queued":
      return { label: "Waiting to run", detail: "Relay will start when the target is free." };
    case "running":
      return { label: "Running now", detail: "Watch the device and steps move together." };
    case "paused":
      return { label: "Your turn", detail: "Complete the action on the device, then continue." };
    case "passed":
      return { label: "Test passed", detail: "Every required step completed." };
    case "failed":
      return { label: "Needs attention", detail: "Relay stopped where the result changed." };
  }
}

function stateTone(state: ExecutionState): string {
  if (state === "passed") return "text-[var(--relay-green)]";
  if (state === "failed") return "text-[var(--relay-red)]";
  if (state === "paused") return "text-[var(--relay-orange)]";
  return "text-[var(--text-interactive-base)]";
}

function stepState(job: JobInfo, index: number): "passed" | "failed" | "running" | "waiting" {
  const trace = job.steps?.[index];
  if (!trace) return "waiting";
  if (trace.status === "error" || trace.tone === "danger") return "failed";
  if (job.status === "running" && index === (job.steps?.length ?? 1) - 1) return "running";
  return "passed";
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
  const state = createMemo(() => stateFor(props.job));
  const copy = createMemo(() => stateCopy(state()));
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
  const focusedTitle = createMemo(
    () =>
      focusedTrace()?.title ??
      (focusedRecipeStep()
        ? sentenceForStep(focusedRecipeStep()!, server.recipes())
        : `Step ${focusedIndex() + 1}`),
  );

  createEffect(() => {
    const index = currentIndex();
    server.selectedRecipeId();
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
      class="flex min-h-0 min-w-0 flex-col border-l border-[var(--relay-line)] bg-[var(--relay-panel)]"
      aria-label="Execution progress"
      aria-live="polite"
    >
      <header class="border-b border-[var(--relay-line)] px-5 pt-5 pb-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <span class={eyebrow}>Execution</span>
            <h2
              class={cn("mt-1.5 text-[19px] font-semibold tracking-[-0.025em]", stateTone(state()))}
            >
              {copy().label}
            </h2>
            <p class="mt-1 text-[12px]/[1.45] text-[var(--relay-text-secondary)]">
              {copy().detail}
            </p>
          </div>
          <span
            class={cn(
              "mt-1 size-2.5 shrink-0 rounded-full",
              state() === "passed"
                ? "bg-[var(--relay-green)]"
                : state() === "failed"
                  ? "bg-[var(--relay-red)]"
                  : state() === "paused"
                    ? "bg-[var(--relay-orange)]"
                    : "bg-[var(--relay-accent)] shadow-[0_0_10px_var(--relay-accent)]",
            )}
            aria-hidden="true"
          />
        </div>

        <div class="mt-4 flex items-end justify-between gap-3">
          <div>
            <strong class="font-mono text-[13px] tabular-nums text-[var(--relay-text)]">
              Step {Math.min(currentIndex() + 1, total())} of {total()}
            </strong>
            <Show when={fmtDur(props.job, server.clock())}>
              {(duration) => (
                <small class="ml-2 font-mono text-[10.5px] tabular-nums text-[var(--relay-text-tertiary)]">
                  {duration()}
                </small>
              )}
            </Show>
          </div>
          <span class="font-mono text-[10.5px] tabular-nums text-[var(--relay-text-tertiary)]">
            {Math.min(observed(), total())} reached
          </span>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <section class="rounded-xl bg-[var(--relay-surface-raised)] p-4 shadow-[inset_0_0_0_1px_var(--relay-line)]">
          <div class="flex items-center justify-between gap-3">
            <span class={eyebrow}>Selected step</span>
            <span class="font-mono text-[10px] tabular-nums text-[var(--relay-text-tertiary)]">
              {focusedTrace()?.durationMs
                ? focusedTrace()!.durationMs! < 1000
                  ? `${Math.round(focusedTrace()!.durationMs!)}ms`
                  : `${(focusedTrace()!.durationMs! / 1000).toFixed(1)}s`
                : "—"}
            </span>
          </div>
          <strong class="mt-2 block text-[14px]/[1.4] font-medium text-[var(--relay-text)]">
            {focusedTitle()}
          </strong>
          <div class="mt-3 flex items-center gap-2 text-[11px] text-[var(--relay-text-secondary)]">
            <span
              class={cn(
                "size-1.5 rounded-full",
                stepState(props.job, focusedIndex()) === "passed"
                  ? "bg-[var(--relay-green)]"
                  : stepState(props.job, focusedIndex()) === "failed"
                    ? "bg-[var(--relay-red)]"
                    : stepState(props.job, focusedIndex()) === "running"
                      ? "bg-[var(--relay-accent)]"
                      : "bg-[var(--relay-text-tertiary)]",
              )}
            />
            {stepState(props.job, focusedIndex()) === "passed"
              ? "Completed"
              : stepState(props.job, focusedIndex()) === "failed"
                ? "Stopped here"
                : stepState(props.job, focusedIndex()) === "running"
                  ? "Running now"
                  : "Not reached yet"}
          </div>
          <Show when={stepState(props.job, focusedIndex()) === "failed" && props.job.error}>
            <p class="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--relay-red)_9%,transparent)] px-3 py-2.5 text-[11.5px]/[1.45] text-[var(--relay-text-secondary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-red)_24%,transparent)]">
              {friendlyError(props.job.error!)}
            </p>
          </Show>
        </section>

        <Show when={props.job.waitingFor}>
          {(checkpoint) => (
            <section class="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--relay-orange)_8%,var(--relay-surface-raised))] p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--relay-orange)_28%,var(--relay-line))]">
              <span class={eyebrow}>Do this on the device</span>
              <strong class="mt-2 block text-[13px]/[1.4] text-[var(--relay-text)]">
                {checkpoint().message}
              </strong>
            </section>
          )}
        </Show>
      </div>

      <footer class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-[var(--relay-line)] p-3">
        <button
          type="button"
          class={productSecondary}
          onClick={() => props.onOpenReport(props.job.id)}
        >
          View report
        </button>
        <button type="button" class={productPrimary} onClick={action}>
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
        </button>
        <Show when={state() === "running" || state() === "paused"}>
          <button
            type="button"
            class="col-span-2 min-h-9 rounded-lg text-[11.5px] font-medium text-[var(--relay-text-tertiary)] hover:bg-[var(--relay-surface-raised)] hover:text-[var(--relay-red)]"
            onClick={() => void server.cancelJob(props.job.id)}
          >
            Stop run
          </button>
        </Show>
      </footer>
    </aside>
  );
}
