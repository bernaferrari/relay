import { Show, type JSX } from "solid-js";
import { Icon } from "./icon";

export function StudioReturnToRun(props: {
  runId: string | null;
  onBack: (runId: string) => void;
}): JSX.Element {
  return (
    <Show when={props.runId}>
      {(runId) => (
        <div class="flex min-h-11 shrink-0 items-center gap-3 border-b border-border-weak-base bg-background-base px-4">
          <button
            type="button"
            class="inline-flex min-h-9 touch-manipulation items-center gap-1.5 rounded-lg px-2 text-body font-medium text-text-strong hover:bg-surface-base-hover focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-border-strong-focus"
            onClick={() => props.onBack(runId())}
          >
            <Icon name="chevron-left" size={14} /> Back to Run
          </button>
          <span class="truncate text-caption text-text-weaker">
            Viewing the map used by this Run
          </span>
        </div>
      )}
    </Show>
  );
}
