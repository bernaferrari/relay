import { For, Show } from "solid-js";
import type { DurableRepeatTestDecision, RepeatTestSnapshot } from "@relay/workflows";
import { Button } from "@relay/ui/button";
import { cn } from "../lib/cn";
import { repeatStatusLabel } from "../lib/app-map-test-repeat-presentation";
import { testEditorHint } from "../lib/app-map-test-editor-styles";

export function AppMapTestRepeatStatus(props: {
  snapshot: RepeatTestSnapshot;
  busy: boolean;
  reviewed: boolean;
  caseLabel: (values: Readonly<Record<string, string>>) => string;
  onReviewedChange: (reviewed: boolean) => void;
  onOpenRun?: (runId: string) => void;
  onRefresh: () => void;
  onAdvance: (action: DurableRepeatTestDecision["action"]) => void;
  onRepeatAgain: () => void;
}) {
  return (
    <div class="grid gap-2 rounded-lg bg-surface-base p-2.5" data-test-repeat-status>
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="grid gap-px">
          <strong class="text-caption font-medium text-text-strong">
            {props.snapshot.progress.label}
          </strong>
          <span class="text-caption tabular-nums text-text-weak">
            {props.snapshot.outcomes.passed} passed · {props.snapshot.outcomes.untouched} untouched
            · {props.snapshot.outcomes.failed + props.snapshot.outcomes.needsReview} problems
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          <Show when={props.snapshot.evidenceRefs[0]}>
            {(evidence) => (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => props.onOpenRun?.(evidence().id)}
              >
                View pilot evidence
              </Button>
            )}
          </Show>
          <Button variant="ghost" size="sm" disabled={props.busy} onClick={props.onRefresh}>
            Refresh
          </Button>
        </div>
      </div>
      <Show when={props.snapshot.problems[0]}>
        {(problem) => (
          <p class={cn(testEditorHint, "m-0")} role="status">
            {problem().recovery}
          </p>
        )}
      </Show>
      <Show when={props.snapshot.results.length > 0}>
        <ul
          class="m-0 grid list-none gap-1 p-0"
          aria-label="Repeat results"
          data-test-repeat-results
        >
          <For each={props.snapshot.results}>
            {(result) => (
              <li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border-weak-base bg-background-base px-2.5 py-2 text-caption">
                <span class="min-w-0 truncate font-medium text-text-strong">
                  {props.caseLabel(result.values)}
                </span>
                <span class="text-text-weak">
                  {result.phase === "pilot" ? "Pilot · " : ""}
                  {repeatStatusLabel(result.status)}
                </span>
                <Show when={result.runId} fallback={<span aria-hidden="true" />}>
                  {(runId) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Open ${props.caseLabel(result.values)} result`}
                      onClick={() => props.onOpenRun?.(runId())}
                    >
                      View
                    </Button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.snapshot.allowedNextActions.includes("confirm-and-continue")}>
        <label class="flex min-h-11 items-center gap-2 rounded-md border border-border-weak-base px-2.5 text-caption text-text-base">
          <input
            type="checkbox"
            checked={props.reviewed}
            onChange={(event) => props.onReviewedChange(event.currentTarget.checked)}
          />
          I reviewed the representative result
        </label>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Show when={props.snapshot.allowedNextActions.includes("continue")}>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy}
            onClick={() => props.onAdvance("continue")}
          >
            Continue remaining {props.snapshot.outcomes.untouched}
          </Button>
        </Show>
        <Show when={props.snapshot.allowedNextActions.includes("confirm-and-continue")}>
          <Button
            variant="primary"
            size="sm"
            disabled={props.busy || !props.reviewed}
            onClick={() => props.onAdvance("confirm-and-continue")}
          >
            Continue remaining {props.snapshot.outcomes.untouched}
          </Button>
        </Show>
        <Show when={props.snapshot.allowedNextActions.includes("cancel")}>
          <Button
            variant="ghost"
            size="sm"
            disabled={props.busy}
            onClick={() => props.onAdvance("cancel")}
          >
            Stop Repeat
          </Button>
        </Show>
        <Show when={props.snapshot.stage === "complete"}>
          <Button variant="secondary" size="sm" onClick={props.onRepeatAgain}>
            Repeat again
          </Button>
        </Show>
      </div>
    </div>
  );
}
