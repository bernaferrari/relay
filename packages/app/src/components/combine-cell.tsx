import { For, Show, createEffect, createSignal, on } from "solid-js";
import { cn } from "../lib/cn";
import {
  type CombineCellAnalysis,
  type CombineCellVerdict,
  type CombineVerdictTally,
  combineCellDefectCount,
  combineFindingHeadline,
  combineVerdictPresentation,
} from "../lib/combine-verdict";
import { Icon } from "./icon";

/**
 * One cell of the Combine review: the screenshot, what Relay thinks of it, and
 * where the defect is. The verdict is part of the cell rather than a separate
 * report, because the point of the grid is to see forty answers at once.
 */
export function CombineCell(props: {
  label: string;
  secondaryLabel?: string;
  screenLabel: string;
  source: string;
  verdict: CombineCellVerdict;
  analysis?: CombineCellAnalysis | undefined;
  onOpen: () => void;
  onCompare?: () => void;
  /** Lets the grid adopt one frame shape for every cell in it, from the first
   * capture that reports its size. Every cell in a locale grid is the same
   * screen in a different language, so they all want the same frame. */
  onNaturalSize?: (size: { width: number; height: number }) => void;
}) {
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    on(
      () => props.source,
      () => setImageFailed(false),
    ),
  );
  const visible = () => Boolean(props.source) && !imageFailed();
  const presentation = () => combineVerdictPresentation(props.verdict);
  const findings = () => props.analysis?.findings ?? [];
  const leadFinding = () => findings()[0];
  // The observed string is the evidence. Showing it beats any generic sentence
  // about clipping, because it is the thing a person will go and fix.
  const detail = () => {
    const finding = leadFinding();
    if (!finding) return presentation().hint;
    return finding.observed?.trim() || finding.detail;
  };
  const headline = () => {
    const finding = leadFinding();
    return finding ? combineFindingHeadline(finding) : presentation().label;
  };
  const extraFindings = () => Math.max(0, findings().length - 1);

  return (
    <article
      class="group/cell relative grid min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface-raised-stronger-non-alpha)] shadow-[inset_0_0_0_1px_var(--border-weak-base)] transition-shadow duration-[var(--duration-hover)] hover:shadow-[inset_0_0_0_1px_var(--border-strong-base),0_6px_18px_rgb(0_0_0/8%)] data-[tone=defect]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--icon-critical-base)_52%,transparent)] motion-reduce:transition-none"
      data-tone={presentation().tone}
      data-locale-cell={props.verdict}
    >
      <button
        type="button"
        class="grid min-h-0 w-full text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--border-focus)]"
        aria-label={`${props.screenLabel} in ${props.label} — ${headline()}. ${detail()}`}
        onClick={props.onOpen}
      >
        {/* A phone capture in a 4/3 frame sat in a third of the cell with grey
            either side, which on a defect-review grid read as a broken image.
            The frame takes the capture's own shape instead — set once for the
            whole grid, so forty cells stay on one baseline. */}
        <span class="relative block aspect-[var(--locale-cell-aspect,0.5)] w-full overflow-hidden bg-[var(--background-deep)]">
          <Show when={visible()} fallback={<CellPlaceholder verdict={props.verdict} />}>
            <img
              src={props.source}
              alt={`${props.screenLabel} in ${props.label}`}
              class="size-full object-contain"
              loading="lazy"
              decoding="async"
              onLoad={(event) =>
                props.onNaturalSize?.({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setImageFailed(true)}
            />
          </Show>

          <span class="pointer-events-none absolute top-1.5 left-1.5">
            <VerdictChip verdict={props.verdict} />
          </span>
          <Show when={extraFindings()}>
            <span class="pointer-events-none absolute top-1.5 right-1.5 inline-flex min-h-5 items-center rounded-full bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-1.5 text-micro font-semibold tabular-nums text-[var(--text-base)] backdrop-blur-[6px]">
              +{extraFindings()}
            </span>
          </Show>
        </span>
      </button>

      <div class="grid gap-1 border-t border-[var(--border-weak-base)] px-2.5 py-2">
        <div class="flex min-w-0 items-baseline gap-2">
          <strong class="min-w-0 flex-1 truncate text-caption font-medium text-[var(--text-strong)]">
            {props.label}
          </strong>
          <Show when={props.secondaryLabel}>
            <span class="shrink-0 font-mono text-micro text-[var(--text-weak)]">
              {props.secondaryLabel}
            </span>
          </Show>
        </div>
        {/* The offending string, quoted. A verdict a person cannot check is a
            verdict they will not trust. */}
        <Show when={leadFinding()}>
          <p
            class="m-0 line-clamp-2 text-micro/[1.45] text-[var(--text-weak)]"
            title={leadFinding()!.detail}
          >
            {leadFinding()!.observed?.trim() ? `“${leadFinding()!.observed!.trim()}”` : detail()}
          </p>
        </Show>
        <Show when={props.analysis?.baselineLabel || props.onCompare}>
          <div class="flex min-w-0 items-center justify-between gap-2">
            <Show when={props.analysis?.baselineLabel}>
              {(baseline) => (
                <span class="min-w-0 truncate text-micro text-[var(--text-weak)]">
                  vs {baseline()}
                </span>
              )}
            </Show>
            <Show when={props.onCompare}>
              <button
                type="button"
                class="ml-auto shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-micro font-medium text-[var(--text-interactive-base)] opacity-0 transition-opacity duration-[var(--duration-hover)] group-hover/cell:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] motion-reduce:transition-none"
                onClick={props.onCompare}
              >
                Compare
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </article>
  );
}

/**
 * Verdict legend and filter in one control, shared by every locale grid.
 *
 * On a forty-language sweep the first question is always "what is broken", so
 * defects lead and one click reduces the grid to them. It lives beside the cell
 * because a legend that drifts from the cells it explains is worse than none.
 */
export function CombineVerdictLegend(props: {
  tallies: readonly CombineVerdictTally[];
  active: CombineCellVerdict | null;
  onSelect: (verdict: CombineCellVerdict | null) => void;
}) {
  const defects = () => combineCellDefectCount(props.tallies);
  return (
    <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--border-weak-base)] px-5 py-2">
      <span class="mr-1 shrink-0 text-micro font-semibold tracking-[0.06em] text-[var(--text-weak)] uppercase">
        {defects() ? `${defects()} ${defects() === 1 ? "defect" : "defects"}` : "Verdicts"}
      </span>
      <For each={props.tallies}>
        {(tally) => {
          const active = () => props.active === tally.verdict;
          const presentation = () => combineVerdictPresentation(tally.verdict);
          return (
            <button
              type="button"
              class={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-micro font-medium outline-none transition-[background-color,box-shadow] duration-[var(--duration-hover)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] motion-reduce:transition-none",
                active()
                  ? "bg-[var(--surface-base-hover)] text-[var(--text-strong)] shadow-[inset_0_0_0_1px_var(--border-strong-base)]"
                  : "text-[var(--text-base)] hover:bg-[var(--surface-base)]",
              )}
              aria-pressed={active()}
              title={presentation().hint}
              onClick={() => props.onSelect(active() ? null : tally.verdict)}
            >
              <VerdictChip verdict={tally.verdict} showLabel={false} />
              {presentation().label}
              <span class="tabular-nums text-[var(--text-weak)]">{tally.count}</span>
            </button>
          );
        }}
      </For>
      <Show when={props.active}>
        <button
          type="button"
          class="ml-1 min-h-7 rounded-full px-2 text-micro font-medium text-[var(--text-interactive-base)] hover:bg-[var(--surface-base)]"
          onClick={() => props.onSelect(null)}
        >
          Show all
        </button>
      </Show>
    </div>
  );
}

export function VerdictChip(props: { verdict: CombineCellVerdict; showLabel?: boolean }) {
  const presentation = () => combineVerdictPresentation(props.verdict);
  return (
    <span
      class={cn(
        "inline-flex min-h-5 items-center gap-1 rounded-full px-1.5 text-micro font-semibold shadow-[0_1px_4px_rgb(0_0_0/14%)] backdrop-blur-[6px]",
        verdictChipTone(presentation().tone),
      )}
      title={presentation().hint}
    >
      <Icon name={presentation().icon} size={9} />
      <Show when={props.showLabel !== false}>{presentation().label}</Show>
    </span>
  );
}

function verdictChipTone(tone: ReturnType<typeof combineVerdictPresentation>["tone"]): string {
  if (tone === "defect") {
    return "bg-[var(--icon-critical-base)] text-[var(--text-on-critical,white)]";
  }
  if (tone === "warn") {
    return "bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] text-[var(--icon-warning-base)]";
  }
  if (tone === "pass") {
    return "bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] text-[var(--icon-success-base)]";
  }
  if (tone === "progress") {
    return "bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] text-[var(--text-interactive-base)]";
  }
  return "bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] text-[var(--text-weak)]";
}

function CellPlaceholder(props: { verdict: CombineCellVerdict }) {
  const presentation = () => combineVerdictPresentation(props.verdict);
  return (
    <span class="grid size-full place-items-center px-3 text-center">
      <span class="grid justify-items-center gap-1.5">
        <Icon
          name={presentation().icon}
          size={15}
          class={
            presentation().tone === "defect"
              ? "text-[var(--icon-critical-base)]"
              : "text-[var(--text-weaker)]"
          }
        />
        <span class="text-micro font-medium text-[var(--text-weak)]">{presentation().label}</span>
      </span>
    </span>
  );
}

/** Reserves the real grid while a large matrix streams in, so the page does not
 * reflow once per arriving locale. */
export function CombineCellSkeleton() {
  return (
    <div
      class="grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface-raised-stronger-non-alpha)] shadow-[inset_0_0_0_1px_var(--border-weak-base)]"
      aria-hidden="true"
    >
      <span class="block aspect-[4/3] w-full bg-[var(--surface-base)] motion-safe:animate-pulse" />
      <span class="flex items-center gap-2 border-t border-[var(--border-weak-base)] px-2.5 py-2">
        <span class="h-2.5 w-24 rounded-full bg-[var(--surface-base)] motion-safe:animate-pulse" />
      </span>
    </div>
  );
}
