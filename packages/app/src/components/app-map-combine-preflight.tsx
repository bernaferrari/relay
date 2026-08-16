import { For, Show } from "solid-js";
import type { AppMapCombinePreflight } from "@relay/protocol";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

function durationLabel(value: number | undefined): string {
  if (value === undefined) return "Duration confirmed at run time";
  const minutes = Math.max(1, Math.round(value / 60_000));
  return minutes === 1 ? "About 1 minute" : `About ${minutes} minutes`;
}

export function AppMapCombinePreflightSummary(props: { preflight: AppMapCombinePreflight }) {
  const metrics = () => [
    { label: "Device runs", value: props.preflight.deviceRuns },
    { label: "Checks", value: props.preflight.checks },
    { label: "Screenshots", value: props.preflight.expectedScreenshots ?? "Live" },
  ];
  return (
    <section
      class="grid gap-2 rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-3"
      aria-label="Run preflight"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="m-0 text-caption font-semibold text-[var(--text-strong)]">Before you run</h3>
          <p class="m-0 mt-0.5 text-micro text-[var(--text-weak)]">
            {durationLabel(props.preflight.estimatedDurationMs)}
          </p>
        </div>
        <span
          class={cn(
            "inline-flex items-center gap-1 text-micro font-medium",
            props.preflight.ok
              ? "text-[var(--icon-success-base)]"
              : "text-[var(--icon-critical-base)]",
          )}
        >
          <Icon name={props.preflight.ok ? "check" : "alert"} size={11} />
          {props.preflight.ok ? "Ready" : "Needs attention"}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        <For each={metrics()}>
          {(metric) => (
            <div class="rounded-lg bg-[var(--background-base)] px-2 py-2">
              <strong class="block text-caption font-semibold tabular-nums text-[var(--text-strong)]">
                {metric.value}
              </strong>
              <span class="block text-micro text-[var(--text-weak)]">{metric.label}</span>
            </div>
          )}
        </For>
      </div>
      <Show when={props.preflight.blockers.length || props.preflight.warnings.length}>
        <ul class="m-0 grid list-none gap-1 p-0">
          <For each={[...props.preflight.blockers, ...props.preflight.warnings]}>
            {(item) => (
              <li class="flex items-start gap-1.5 text-micro/[1.4] text-[var(--text-base)]">
                <Icon
                  name={props.preflight.blockers.includes(item) ? "alert" : "info"}
                  size={11}
                  class="mt-0.5 shrink-0 text-[var(--text-weak)]"
                />
                {item.message}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
