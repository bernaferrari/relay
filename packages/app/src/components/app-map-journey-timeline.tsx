import { For, Show } from "solid-js";
import type { DiscoveryExploreRun, DiscoveryJourney } from "@relay/protocol";
import {
  journeyHeadline,
  journeyOutcomeSummary,
  journeyRows,
  type JourneyRowTone,
} from "../lib/discovery-journey-presentation";
import { cn } from "../lib/cn";
import { Icon } from "./icon";

const TONE_ICON: Record<JourneyRowTone, "arrow-right" | "undo" | "slash"> = {
  opened: "arrow-right",
  back: "undo",
  stayed: "slash",
};

function toneClass(tone: JourneyRowTone): string {
  if (tone === "stayed")
    return "bg-[var(--background-base)] text-[var(--text-weak)] border border-[var(--border-weak-base)]";
  if (tone === "back") return "bg-[var(--surface-base)] text-[var(--text-base)]";
  return "bg-[var(--product-accent-soft)] text-[var(--text-interactive-base)]";
}

/** The ordered path a crawl actually walked, newest step last. */
export function AppMapJourneyTimeline(props: {
  journey: DiscoveryJourney | undefined;
  run: DiscoveryExploreRun | undefined;
  label?: string;
}) {
  const rows = () => journeyRows(props.journey);
  const headline = () => journeyHeadline(props.journey);
  const outcome = () => journeyOutcomeSummary(props.run);

  return (
    <Show when={rows().length > 0}>
      <section class="grid gap-2.5">
        <div class="flex items-baseline justify-between gap-3">
          <h3 class="text-micro font-semibold tracking-[0.08em] text-[var(--text-weak)] uppercase">
            Journey{props.label ? ` · ${props.label}` : ""}
          </h3>
          <span class="text-micro text-[var(--text-weak)] tabular-nums">{headline()}</span>
        </div>

        <Show when={outcome()}>
          {(summary) => (
            <p class="flex items-start gap-2 rounded-xl bg-[var(--surface-base)] px-3 py-2.5 text-micro/[1.45] text-[var(--text-weak)]">
              <Icon name="info" size={13} class="mt-0.5 shrink-0" />
              {summary()}
            </p>
          )}
        </Show>

        <ol class="grid gap-1">
          <For each={rows()}>
            {(row) => (
              <li class="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-2.5 rounded-xl bg-[var(--surface-base)] px-2.5 py-2">
                <span
                  class={cn(
                    "mt-0.5 grid size-[22px] place-items-center rounded-full",
                    toneClass(row.tone),
                  )}
                  aria-hidden="true"
                >
                  <Icon name={TONE_ICON[row.tone]} size={11} />
                </span>
                <span class="min-w-0">
                  <span class="flex min-w-0 items-baseline gap-1.5">
                    <strong class="truncate text-caption font-medium text-[var(--text-strong)]">
                      {row.action}
                    </strong>
                    <small class="shrink-0 text-micro text-[var(--text-weak)] tabular-nums">
                      {row.index + 1}
                    </small>
                  </span>
                  <small class="mt-0.5 block truncate text-micro text-[var(--text-weak)]">
                    {row.tone === "stayed" ? "Nothing changed on " : ""}
                    {row.destination}
                  </small>
                </span>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}
