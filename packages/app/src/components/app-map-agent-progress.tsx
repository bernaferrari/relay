import { For, Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import type { AgentState, AgentWorker } from "./app-map-agent-types";

export function AppMapAgentProgress(props: {
  state: AgentState;
  stage: string;
  workers: AgentWorker[];
  onRetry: (workerId: string) => void;
}) {
  const complete = () => props.workers.filter((worker) => worker.status === "complete").length;
  const proposals = () => props.workers.filter((worker) => worker.proposalId).length;
  const screens = () => props.workers.reduce((sum, worker) => sum + worker.screens, 0);
  const interactions = () => props.workers.reduce((sum, worker) => sum + worker.interactions, 0);

  return (
    <div class="grid gap-5">
      <section class="grid gap-3 rounded-xl bg-[var(--surface-base)] p-4">
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 text-micro font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
            <i
              class={cn(
                "size-2 rounded-full",
                props.state === "error"
                  ? "bg-[var(--icon-critical-base)]"
                  : props.state === "complete"
                    ? "bg-[var(--icon-success-base)]"
                    : "bg-[var(--text-interactive-base)] motion-safe:animate-pulse",
              )}
            />
            {props.state === "complete"
              ? "Complete"
              : props.state === "error"
                ? "Needs attention"
                : "Exploring"}
          </span>
          <span class="text-micro text-[var(--text-weak)] tabular-nums">
            {complete()}/{props.workers.length} targets
          </span>
        </div>
        <div>
          <h2 class="text-title/[1.25] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            {props.stage}
          </h2>
          <p class="mt-1 text-micro text-[var(--text-weak)] tabular-nums">
            {screens()} screens · {interactions()} steps · {proposals()} suggestions
          </p>
        </div>
      </section>

      <section>
        <h3 class="mb-2 text-micro font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
          Targets
        </h3>
        <ul class="grid gap-1.5">
          <For each={props.workers}>
            {(worker) => (
              <li class="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl bg-[var(--surface-base)] px-2.5 py-2.5">
                <span
                  class={cn(
                    "grid size-8 place-items-center rounded-full text-micro font-semibold",
                    worker.status === "error"
                      ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_11%,transparent)] text-[var(--icon-critical-base)]"
                      : worker.status === "complete"
                        ? "bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]"
                        : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                  )}
                  aria-hidden="true"
                >
                  R
                </span>
                <span class="min-w-0">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <strong class="truncate text-caption font-medium text-[var(--text-strong)]">
                      Relay
                    </strong>
                  </span>
                  <small class="mt-0.5 block truncate text-micro text-[var(--text-weak)]">
                    {worker.targetName}
                    {worker.focus ? ` · ${worker.focus}` : ""} · {worker.stage}
                  </small>
                  <Show when={worker.error}>
                    <small class="mt-1 block text-micro/[1.35] text-[var(--icon-critical-base)]">
                      {worker.error}
                    </small>
                  </Show>
                </span>
                <span class="grid justify-items-end gap-1 text-right text-micro text-[var(--text-weak)] tabular-nums">
                  <span>
                    {worker.screens} screens
                    <br />
                    {worker.interactions}/{worker.actionBudget} actions
                  </span>
                  <Show when={worker.status === "error" || worker.status === "stopped"}>
                    <button
                      type="button"
                      class="min-h-11 rounded-lg px-2 text-micro font-semibold text-[var(--text-interactive-base)] hover:bg-[var(--product-accent-soft)]"
                      onClick={() => props.onRetry(worker.id)}
                    >
                      Retry
                    </button>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <p class="flex items-start gap-2 px-1 text-micro/[1.45] text-[var(--text-weak)]">
        <Icon name="info" size={13} class="mt-0.5 shrink-0" />
        You can keep working on the canvas. Relay only controls the targets assigned above, and all
        map edits wait for review.
      </p>
    </div>
  );
}
