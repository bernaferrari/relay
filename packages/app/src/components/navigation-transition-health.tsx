import { For, Show } from "solid-js";
import { cn } from "../lib/cn";
import type {
  NavigationTransitionHealthModel,
  NavigationTransitionHealthRow,
  NavigationTransitionRepairEntry,
  NavigationTransitionStatus,
} from "../lib/navigation-transition-health";
import { Icon, type IconName } from "./icon";

const presentation: Record<
  NavigationTransitionStatus,
  { label: string; icon: IconName; tone: string; surface: string }
> = {
  ready: {
    label: "Ready",
    icon: "clock",
    tone: "text-text-weak",
    surface: "bg-surface-base-active",
  },
  proven: {
    label: "Proven",
    icon: "check",
    tone: "text-text-success-base",
    surface: "bg-surface-success-weak",
  },
  drifted: {
    label: "Drifted",
    icon: "alert",
    tone: "text-text-critical-base",
    surface: "bg-surface-critical-weak",
  },
  blocked: {
    label: "Blocked",
    icon: "slash",
    tone: "text-text-warning-base",
    surface: "bg-surface-warning-weak",
  },
};

export function NavigationTransitionHealth(props: {
  model: NavigationTransitionHealthModel;
  onReviewRepair?: (repair: NavigationTransitionRepairEntry) => void;
}) {
  const needsDetail = () =>
    props.model.counts.ready + props.model.counts.drifted + props.model.counts.blocked > 0;
  return (
    <section class="grid gap-2.5" aria-labelledby="navigation-health-heading">
      <header class="flex flex-wrap items-center justify-between gap-2">
        <strong id="navigation-health-heading" class="block text-body font-semibold">
          Navigation
        </strong>
        <span class="text-micro tabular-nums text-text-weaker">
          {needsDetail()
            ? `${props.model.counts.drifted + props.model.counts.blocked} need attention`
            : `${props.model.counts.proven} shared ${props.model.counts.proven === 1 ? "path" : "paths"} verified`}
        </span>
      </header>
      <Show when={needsDetail()}>
        <ol class="m-0 grid list-none gap-1.5 p-0" aria-label="Navigation transition health">
          <For each={props.model.rows}>{(row) => <TransitionRow row={row} />}</For>
        </ol>
      </Show>
      <Show when={props.model.repair}>
        {(repair) => (
          <div class="flex items-center justify-between gap-3 rounded-lg border border-border-weak-base bg-surface-warning-weak px-3 py-2.5">
            <span class="min-w-0">
              <strong class="block truncate text-caption font-semibold text-text-strong">
                {repair().title}
              </strong>
              <span class="mt-0.5 block line-clamp-2 text-micro/[1.4] text-text-weak">
                {repair().summary}
              </span>
            </span>
            <button
              type="button"
              class="min-h-11 shrink-0 touch-manipulation rounded-lg px-3 text-caption font-semibold text-text-strong hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
              disabled={!props.onReviewRepair}
              onClick={() => props.onReviewRepair?.(repair())}
            >
              Review repair
            </button>
          </div>
        )}
      </Show>
    </section>
  );
}

function TransitionRow(props: { row: NavigationTransitionHealthRow }) {
  const state = () => presentation[props.row.status];
  return (
    <li class="grid min-h-12 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border-weak-base bg-surface-base px-2.5 py-2">
      <span
        class={cn("grid size-7 place-items-center rounded-lg", state().surface, state().tone)}
        aria-hidden="true"
      >
        <Icon name={state().icon} size={12} />
      </span>
      <span class="min-w-0">
        <strong class="block truncate text-caption font-medium text-text-strong">
          {props.row.source.title} <span aria-hidden="true">→</span> {props.row.destination.title}
        </strong>
        <span class="mt-0.5 block truncate text-micro text-text-weaker">
          {props.row.lastVerifiedDestination
            ? `Last verified at ${props.row.lastVerifiedDestination}`
            : "Not verified in this lineage"}
          {` · ${props.row.dependentCount} ${props.row.dependentCount === 1 ? "dependent" : "dependents"}`}
        </span>
      </span>
      <span class={cn("text-micro font-semibold", state().tone)}>{state().label}</span>
    </li>
  );
}
