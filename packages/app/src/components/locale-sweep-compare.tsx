import { For, Show, onCleanup, onMount } from "solid-js";
import { Button } from "@relay/ui/button";
import type { CorpusFinding } from "@relay/protocol";
import {
  type LocaleCellVerdict,
  localeFindingHeadline,
  localeVerdictPresentation,
} from "../lib/locale-matrix-verdict";
import { trapFocus } from "../lib/modal";
import { modalPanel, modalScrim } from "../lib/ui";
import { Icon } from "./icon";
import { VerdictChip } from "./locale-matrix-cell";

/**
 * The two screenshots behind a verdict, side by side.
 *
 * Every locale finding is a claim about a difference, so the baseline is not
 * optional context — it is the other half of the evidence. A person who cannot
 * see what the screen looked like before the language changed has to take the
 * heuristic's word for it, and these heuristics only ever report possibilities.
 */
export function LocaleSweepCompare(props: {
  screenLabel: string;
  baselineLocale: string;
  baselineSource: string;
  locale: string;
  localeLabel: string;
  source: string;
  verdict: LocaleCellVerdict;
  findings: readonly CorpusFinding[];
  /** Findings already accepted on this cell, kept visible so they can be undone. */
  known: readonly CorpusFinding[];
  onMarkKnown: (finding: CorpusFinding) => void;
  onRestoreKnown: (finding: CorpusFinding) => void;
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  let dialog: HTMLDivElement | undefined;
  onMount(() => {
    if (dialog) onCleanup(trapFocus(dialog));
  });

  return (
    <div
      class={`${modalScrim} z-[140] flex items-center justify-center p-4`}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
        if (event.key === "ArrowLeft" && props.onPrevious) {
          event.preventDefault();
          props.onPrevious();
        }
        if (event.key === "ArrowRight" && props.onNext) {
          event.preventDefault();
          props.onNext();
        }
      }}
    >
      <div
        ref={(element) => {
          dialog = element;
        }}
        class={`${modalPanel} grid h-[min(92vh,980px)] w-[min(1180px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="locale-sweep-compare-title"
        tabIndex={-1}
      >
        <header class="flex items-start justify-between gap-4 border-b border-[var(--border-weak-base)] px-4 py-3">
          <div class="min-w-0">
            <h2
              id="locale-sweep-compare-title"
              class="flex min-w-0 items-center gap-2 text-body font-semibold text-[var(--text-strong)]"
            >
              <span class="truncate">{props.screenLabel}</span>
              <VerdictChip verdict={props.verdict} />
            </h2>
            <p class="mt-0.5 truncate text-caption text-[var(--text-weak)]">
              {props.localeLabel} compared against {props.baselineLocale} · {props.position} of{" "}
              {props.total}
            </p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Close compare" onClick={props.onClose}>
            <Icon name="x" size={14} />
          </Button>
        </header>

        {/* An explicit row, because an implicit `auto` one would size to the
            tallest screenshot and let the pane grow past the panel. */}
        <div class="grid min-h-0 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-px overflow-hidden bg-[var(--border-weak-base)] max-[720px]:grid-cols-1 max-[720px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
          <ComparePane
            caption={`${props.baselineLocale} · baseline`}
            source={props.baselineSource}
            alt={`${props.screenLabel} in ${props.baselineLocale}`}
            missing="The baseline never captured this screen."
          />
          <ComparePane
            caption={props.localeLabel}
            source={props.source}
            alt={`${props.screenLabel} in ${props.localeLabel}`}
            missing={localeVerdictPresentation(props.verdict).hint}
          />
        </div>

        <footer class="grid gap-3 border-t border-[var(--border-weak-base)] px-4 py-3">
          <Show
            when={props.findings.length || props.known.length}
            fallback={
              <p class="m-0 text-caption text-[var(--text-weak)]">
                {localeVerdictPresentation(props.verdict).hint}
              </p>
            }
          >
            {/* Twenty untranslated labels on one screen is a real answer, so the
                list scrolls rather than pushing the screenshots off the panel.
                Accepted findings sit under the live ones: out of the way, but
                still auditable and still undoable. */}
            <ul class="m-0 grid max-h-40 list-none gap-1.5 overflow-y-auto overscroll-contain p-0">
              <For each={props.findings}>
                {(finding) => (
                  <FindingRow
                    finding={finding}
                    actionLabel="Mark as known"
                    onAction={() => props.onMarkKnown(finding)}
                  />
                )}
              </For>
              <For each={props.known}>
                {(finding) => (
                  <FindingRow
                    finding={finding}
                    known
                    actionLabel="Undo"
                    onAction={() => props.onRestoreKnown(finding)}
                  />
                )}
              </For>
            </ul>
          </Show>
          <div class="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onPrevious}
              aria-label="Previous language"
              title="Previous language (Left arrow)"
              onClick={() => props.onPrevious?.()}
            >
              <Icon name="chevron-left" size={14} />
            </Button>
            <span class="min-w-16 text-center text-caption tabular-nums text-[var(--text-weak)]">
              {props.position} / {props.total}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.onNext}
              aria-label="Next language"
              title="Next language (Right arrow)"
              onClick={() => props.onNext?.()}
            >
              <Icon name="chevron-right" size={14} />
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * One finding, and the one thing a person can do about it here.
 *
 * The heuristics only ever report possibilities, so the row leads with the
 * quoted string rather than the verdict: accepting a finding is a judgement
 * about a specific label, and it should be made while looking at that label.
 */
function FindingRow(props: {
  finding: CorpusFinding;
  known?: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <li
      class={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 ${
        props.known
          ? "bg-transparent shadow-[inset_0_0_0_1px_var(--border-weak-base)]"
          : "bg-[var(--surface-base)]"
      }`}
    >
      <div class="grid min-w-0 gap-0.5">
        <span class="flex items-baseline gap-2 text-caption font-medium text-[var(--text-strong)]">
          {localeFindingHeadline(props.finding)}
          <Show when={props.known}>
            <span class="text-micro font-normal text-[var(--text-weak)]">known</span>
          </Show>
          <Show when={!props.known && props.finding.confidence === "medium"}>
            <span class="text-micro font-normal text-[var(--text-weak)]">heuristic, not proof</span>
          </Show>
        </span>
        <span class="text-micro/[1.45] text-[var(--text-weak)]">{props.finding.detail}</span>
        {/* The observed string is what a person will go and fix, so it is
            quoted rather than described. */}
        <Show when={props.finding.observed?.trim()}>
          <span class="font-mono text-micro text-[var(--text-base)]">
            “{props.finding.observed!.trim()}”
            <Show when={props.finding.expected?.trim()}>
              <span class="text-[var(--text-weak)]"> vs “{props.finding.expected!.trim()}”</span>
            </Show>
          </span>
        </Show>
      </div>
      <Button variant="ghost" size="sm" onClick={props.onAction}>
        {props.actionLabel}
      </Button>
    </li>
  );
}

function ComparePane(props: { caption: string; source: string; alt: string; missing: string }) {
  return (
    <figure class="m-0 grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-[var(--background-deep)]">
      <div class="flex min-h-0 items-center justify-center overflow-hidden p-4">
        <Show
          when={props.source}
          fallback={
            <p class="m-0 max-w-[28ch] text-center text-caption text-[var(--text-weak)]">
              {props.missing}
            </p>
          }
        >
          <img src={props.source} alt={props.alt} class="max-h-full max-w-full object-contain" />
        </Show>
      </div>
      <figcaption class="border-t border-[var(--border-weak-base)] bg-[var(--background-base)] px-3 py-1.5 text-center text-micro font-medium text-[var(--text-weak)]">
        {props.caption}
      </figcaption>
    </figure>
  );
}
