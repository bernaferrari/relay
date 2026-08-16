import { Show, createSignal } from "solid-js";
import { Button } from "@relay/ui/button";
import { Icon } from "./icon";
import { cn } from "../lib/cn";
import { withRefreshFeedback } from "../lib/refresh-feedback";
import {
  runCatalogRefreshState,
  type RefreshOutcome,
  type RunCatalogRefreshState,
} from "../lib/refresh-outcome";

export function RunsRefreshControl(props: {
  refreshJobs: () => Promise<RefreshOutcome>;
  refreshRuns: () => Promise<RefreshOutcome>;
  hasSavedResults: boolean;
}) {
  const [refreshing, setRefreshing] = createSignal(false);
  const [state, setState] = createSignal<RunCatalogRefreshState>({
    error: null,
    lastSuccessAt: null,
  });

  async function refresh(): Promise<void> {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const [jobs, runs] = await withRefreshFeedback(() =>
        Promise.all([props.refreshJobs(), props.refreshRuns()]),
      );
      setState((current) =>
        runCatalogRefreshState(current, jobs, runs, Date.now(), props.hasSavedResults),
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div class="flex max-w-[520px] flex-col items-end gap-1.5">
      <div class="flex items-center gap-2">
        <Show when={state().lastSuccessAt}>
          {(timestamp) => (
            <span class="text-caption tabular-nums text-text-weak" aria-live="polite">
              Updated {new Date(timestamp()).toLocaleTimeString([], { timeStyle: "medium" })}
            </span>
          )}
        </Show>
        <Button
          variant="secondary"
          size="lg"
          disabled={refreshing()}
          aria-busy={refreshing()}
          onClick={() => void refresh()}
        >
          <Icon
            name="refresh"
            size={15}
            class={cn(
              refreshing() &&
                "origin-center animate-spin motion-reduce:animate-none motion-reduce:opacity-70",
            )}
          />
          {state().error ? "Retry refresh" : "Refresh"}
        </Button>
      </div>
      <Show when={state().error}>
        {(message) => (
          <div
            class="flex items-center gap-2 text-right text-caption text-text-critical-base"
            role="alert"
          >
            <span>{message()}</span>
            <button
              type="button"
              class="min-h-11 shrink-0 rounded-md px-2 text-text-base underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border-focus)]"
              onClick={() => setState((current) => ({ ...current, error: null }))}
            >
              Dismiss
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
