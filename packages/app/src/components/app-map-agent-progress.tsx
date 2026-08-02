import { For, Show } from "solid-js";
import { cn } from "../lib/cn";
import { Icon } from "./icon";
import type { AgentState, AgentWorker } from "./app-map-agent-types";

function initials(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AppMapAgentProgress(props: {
  state: AgentState;
  stage: string;
  workers: AgentWorker[];
}) {
  const complete = () => props.workers.filter((worker) => worker.status === "complete").length;
  const proposals = () => props.workers.filter((worker) => worker.proposalId).length;
  const screens = () => props.workers.reduce((sum, worker) => sum + worker.screens, 0);
  const interactions = () => props.workers.reduce((sum, worker) => sum + worker.interactions, 0);

  return (
    <div class="grid gap-5">
      <section class="grid gap-3 rounded-[12px] bg-[var(--v2-background-bg-layer-01)] p-4">
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
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
          <span class="text-[9.5px] text-[var(--text-weak)] tabular-nums">
            {complete()}/{props.workers.length} agents
          </span>
        </div>
        <div>
          <h2 class="text-[18px]/[1.25] font-semibold tracking-[-0.025em] text-[var(--text-strong)]">
            {props.stage}
          </h2>
          <p class="mt-1 text-[10.5px] text-[var(--text-weak)] tabular-nums">
            {screens()} screens · {interactions()} interactions · {proposals()} proposals
          </p>
        </div>
      </section>

      <section>
        <h3 class="mb-2 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
          Agents
        </h3>
        <ul class="grid gap-1.5">
          <For each={props.workers}>
            {(worker) => (
              <li class="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] bg-[var(--v2-background-bg-layer-01)] px-2.5 py-2.5">
                <span
                  class={cn(
                    "grid size-8 place-items-center rounded-full text-[9px] font-semibold",
                    worker.status === "error"
                      ? "bg-[color-mix(in_srgb,var(--icon-critical-base)_11%,transparent)] text-[var(--icon-critical-base)]"
                      : worker.status === "complete"
                        ? "bg-[color-mix(in_srgb,var(--icon-success-base)_12%,transparent)] text-[var(--icon-success-base)]"
                        : "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]",
                  )}
                  aria-hidden="true"
                >
                  {initials(worker.model.shortLabel)}
                </span>
                <span class="min-w-0">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <strong class="truncate text-[11.5px] font-medium text-[var(--text-strong)]">
                      {worker.model.label}
                    </strong>
                    <Show when={worker.planner === "semantic"}>
                      <small class="shrink-0 rounded-full bg-[var(--v2-background-bg-base)] px-1.5 py-0.5 text-[8.5px] text-[var(--text-weak)]">
                        local fallback
                      </small>
                    </Show>
                  </span>
                  <small class="mt-0.5 block truncate text-[9.5px] text-[var(--text-weak)]">
                    {worker.targetName} · {worker.stage}
                  </small>
                  <Show when={worker.error}>
                    <small class="mt-1 block text-[9.5px]/[1.35] text-[var(--icon-critical-base)]">
                      {worker.error}
                    </small>
                  </Show>
                </span>
                <span class="text-right text-[9px] text-[var(--text-weak)] tabular-nums">
                  {worker.screens}
                  <br />
                  screens
                </span>
              </li>
            )}
          </For>
        </ul>
      </section>

      <p class="flex items-start gap-2 px-1 text-[10px]/[1.45] text-[var(--text-weak)]">
        <Icon name="info" size={13} class="mt-0.5 shrink-0" />
        You can keep working on the canvas. Relay only controls the targets assigned above, and all
        map edits wait for review.
      </p>
    </div>
  );
}
